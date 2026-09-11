/**
 * Records and replays a real hazard-analysis run.
 *
 * Replay (free, default): if a cassette exists for a fixture it is replayed and
 * scored. No network, no spend.
 *
 * Record (costs money, opt-in): set XHANDLE_EVAL_LIVE=1 and supply a provider
 * key. Every model call is made for real against the running xHandle backend
 * and written to a cassette so later runs are free.
 *
 *   XHANDLE_EVAL_LIVE=1 \
 *   XHANDLE_EVAL_API_KEY=sk-ant-... \
 *   XHANDLE_EVAL_MODEL=claude-sonnet-5 \
 *   CI=true npx react-scripts test --testPathPattern hazardEvalLive --watchAll=false
 *
 * The key is read from the environment and never written to the cassette.
 */

import fs from "fs";
import path from "path";
import { generateStandardCodeHazardAnalysisSheets } from "../../components/aiAnalysisCodeHazardStandard";
import { fetchLLMResponse } from "../../components/aiAnalysisSTPA";
import { getApprovedHazardEvalFixtures } from "./fixtures";
import { createCassetteTransport, createEmptyCassette } from "./hazardEvalCassette";
import { formatHazardEvalSummary, runHazardEvalSuite } from "./hazardEvalRunner";

jest.mock("../../components/aiAnalysisSTPA", () => ({
  fetchLLMResponse: jest.fn(),
  getHazardAnalysisRequestTimeoutMs: jest.fn(() => 290_000),
}));

const LIVE = process.env.XHANDLE_EVAL_LIVE === "1";
const API_KEY = process.env.XHANDLE_EVAL_API_KEY || "";
const PROVIDER = process.env.XHANDLE_EVAL_PROVIDER || "claude";
const MODEL = process.env.XHANDLE_EVAL_MODEL || "claude-sonnet-5";
const BACKEND = process.env.XHANDLE_EVAL_BACKEND || "http://localhost:5001";
const CASSETTE_DIR = path.join(__dirname, "cassettes");

// "anthropic" drives the pipeline's own chunk sizing; the backend header wants
// the "claude" spelling. Keep both explicit rather than guessing at the seam.
const CHUNKING_PROVIDER = PROVIDER === "claude" ? "anthropic" : PROVIDER;

const cassettePath = (fixtureId) => path.join(CASSETTE_DIR, `${fixtureId}.json`);

function readCassette(fixtureId) {
  const file = cassettePath(fixtureId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeCassette(fixtureId, cassette) {
  fs.mkdirSync(CASSETTE_DIR, { recursive: true });
  fs.writeFileSync(cassettePath(fixtureId), `${JSON.stringify(cassette, null, 2)}\n`);
}

async function backendTransport(prompt, sysmlData, contexts, extraText, requestOptions = {}) {
  const response = await fetch(`${BACKEND}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ai-provider": PROVIDER,
      "x-ai-api-key": API_KEY,
      "x-ai-model": MODEL,
      ...(process.env.XHANDLE_EVAL_EFFORT ? { "x-ai-effort": process.env.XHANDLE_EVAL_EFFORT } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: extraText || "" },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      xhandleWorkflow: requestOptions.workflow || "hazard-analysis",
      ...(Number(requestOptions.maxTokens) > 0 ? { max_tokens: Number(requestOptions.maxTokens) } : {}),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Backend returned ${response.status} for ${requestOptions.workflow}: ${detail.slice(0, 300)}`);
  }
  const json = await response.json();
  return json?.choices?.[0]?.message?.content?.trim() || "(empty)";
}

const fixtures = getApprovedHazardEvalFixtures();

describe("live hazard analysis run", () => {
  if (!fixtures.length) {
    test.skip("no approved fixtures registered", () => {});
    return;
  }

  fixtures.forEach((fixture) => {
    const existing = readCassette(fixture.fixtureId);
    const canRun = LIVE ? Boolean(API_KEY) : Boolean(existing);
    const runTest = canRun ? test : test.skip;

    runTest(
      `${LIVE ? "records" : "replays"} ${fixture.fixtureId}`,
      async () => {
        const cassette = existing || createEmptyCassette(fixture.fixtureId);
        const transport = createCassetteTransport({
          cassette,
          // "refresh" reuses anything already recorded and only pays for the
          // calls that are genuinely new.
          mode: LIVE ? "refresh" : "replay",
          liveTransport: LIVE ? backendTransport : null,
        });
        fetchLLMResponse.mockImplementation(transport);

        const suite = await runHazardEvalSuite({
          fixtures: [fixture],
          method: "STPA",
          generate: generateStandardCodeHazardAnalysisSheets,
          provider: CHUNKING_PROVIDER,
        });

        if (LIVE) writeCassette(fixture.fixtureId, cassette);

        const stats = transport.stats();
        // eslint-disable-next-line no-console
        console.log(
          `\n${"=".repeat(72)}\n`
          + `${fixture.fixtureId} — ${LIVE ? `LIVE via ${PROVIDER}/${MODEL}` : "replayed from cassette"}\n`
          + `calls: ${stats.total} (live ${stats.fromLive}, cassette ${stats.fromCassette})\n`
          + `${JSON.stringify(stats.byWorkflow)}\n`
          + `${"=".repeat(72)}\n`
          + `${formatHazardEvalSummary(suite)}\n`,
        );

        expect(suite.totals.itemCount).toBe(fixture.items.length);
        // A run where the pipeline returned nothing usable is a failed run, not
        // a score of zero.
        expect(suite.totals.missingRows).toBe(0);
      },
      600_000,
    );
  });
});
