// Replay transport for the hazard-analysis eval.
//
// Every model call in the pipeline goes through one function —
// `fetchLLMResponse(prompt, sysmlData, contexts, extraText, requestOptions)` —
// and each call site tags itself with `requestOptions.workflow`. That makes the
// whole five-stage pipeline replayable from recorded responses: score a change
// to scoring, matching, or a downstream stage without spending a token.
//
// Live recording costs real money, so it is never the default. The caller must
// pass an explicit live transport; `createCassetteTransport` alone can only
// replay, and a cassette miss throws instead of silently reaching the network.

const text = (value) => String(value ?? "");

// FNV-1a over the prompt. Stable across runs and short enough to read in a diff.
export function hashPrompt(value) {
  let hash = 2166136261;
  const input = text(value);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function cassetteKey(prompt, requestOptions = {}) {
  const workflow = text(requestOptions.workflow) || "unknown-workflow";
  return `${workflow}:${hashPrompt(prompt)}`;
}

export function createEmptyCassette(fixtureId = "") {
  return { version: 1, fixtureId: text(fixtureId), entries: {} };
}

export class CassetteMissError extends Error {
  constructor(key, workflow) {
    super(
      `No recorded response for ${key}. The prompt changed, or this stage was never recorded. `
      + "Re-record the cassette in live mode, or fix the change that altered the prompt.",
    );
    this.name = "CassetteMissError";
    this.key = key;
    this.workflow = workflow;
  }
}

/**
 * Returns a `fetchLLMResponse`-shaped function.
 *
 * mode "replay"  — serve from the cassette; throw CassetteMissError on a miss.
 * mode "record"  — call `liveTransport`, store the response, serve it.
 * mode "refresh" — serve a hit from the cassette, record a miss via liveTransport.
 */
export function createCassetteTransport({
  cassette = createEmptyCassette(),
  mode = "replay",
  liveTransport = null,
} = {}) {
  if (mode !== "replay" && typeof liveTransport !== "function") {
    throw new Error(`Cassette mode "${mode}" needs a liveTransport; refusing to make unrecorded calls.`);
  }
  const entries = cassette.entries || (cassette.entries = {});
  const calls = [];

  const transport = async (prompt, sysmlData = {}, contexts = undefined, extraText = "", requestOptions = {}) => {
    const key = cassetteKey(prompt, requestOptions);
    const workflow = text(requestOptions.workflow);
    const recorded = entries[key];

    if (mode === "replay") {
      if (recorded === undefined) throw new CassetteMissError(key, workflow);
      calls.push({ key, workflow, source: "cassette" });
      return recorded;
    }
    if (mode === "refresh" && recorded !== undefined) {
      calls.push({ key, workflow, source: "cassette" });
      return recorded;
    }

    const response = await liveTransport(prompt, sysmlData, contexts, extraText, requestOptions);
    entries[key] = response;
    calls.push({ key, workflow, source: "live" });
    return response;
  };

  transport.cassette = cassette;
  transport.calls = calls;
  transport.stats = () => ({
    total: calls.length,
    fromCassette: calls.filter((call) => call.source === "cassette").length,
    fromLive: calls.filter((call) => call.source === "live").length,
    byWorkflow: calls.reduce((totals, call) => ({
      ...totals,
      [call.workflow || "unknown-workflow"]: (totals[call.workflow || "unknown-workflow"] || 0) + 1,
    }), {}),
  });
  return transport;
}

/**
 * Builds a cassette from explicit per-workflow responses.
 *
 * Used by tests to drive the pipeline down a chosen path without recording:
 * `{ "hazard-row-generation": [response, ...] }` serves responses in call order
 * for that workflow, so a test can hand each chunk its own payload.
 */
export function createScriptedTransport(responsesByWorkflow = {}, { fallback = null } = {}) {
  const remaining = Object.fromEntries(
    Object.entries(responsesByWorkflow).map(([workflow, responses]) => [
      workflow,
      Array.isArray(responses) ? [...responses] : [responses],
    ]),
  );
  const calls = [];

  const transport = async (prompt, sysmlData = {}, contexts = undefined, extraText = "", requestOptions = {}) => {
    const workflow = text(requestOptions.workflow) || "unknown-workflow";
    const queue = remaining[workflow];
    calls.push({ workflow, prompt });
    if (!queue || !queue.length) {
      // A repair or audit stage that has nothing scripted falls back to a
      // no-op payload so a test can target one stage without scripting all six.
      if (typeof fallback === "function") return fallback(prompt, requestOptions);
      throw new Error(`Scripted transport has no remaining response for workflow "${workflow}".`);
    }
    const next = queue.shift();
    return typeof next === "function" ? next(prompt, requestOptions) : next;
  };

  transport.calls = calls;
  transport.remaining = remaining;
  return transport;
}
