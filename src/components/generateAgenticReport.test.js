import { generateAgenticRiskReport, generateGraphicalReportDiagram } from "./generateAgenticReport";
import { backendURL } from "./backendConfig";

const planning = JSON.stringify({ riskLevel: "low", expectedChunkCount: 1, recommendations: "Use the supplied evidence." });
const summary = JSON.stringify({ summary: "A control can fail; verify its safeguard.", confidence: 90 });
const audit = JSON.stringify({ needsRevision: false, indexesToFix: [], revisionAdvice: [] });
const markdown = "# Subsystem Design Document\n\nA verified synthetic subsystem report.";
const completion = (content, finish_reason = "stop") => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content }, finish_reason }] }),
});
const options = {
  summarySheet: [["Function", "Risk"], ["Control", "Lost output"]],
  method: "STPA",
  mode: "autonomous",
  reportType: "Subsystem Design Document",
};
const originalFetch = global.fetch;

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn();
});
afterEach(() => { global.fetch = originalFetch; });

function responses(...items) {
  items.forEach((item) => global.fetch.mockResolvedValueOnce(
    typeof item === "string" ? completion(item) : item,
  ));
}

test("generates the sidebar subsystem report through the configured backend", async () => {
  responses(planning, summary, audit, markdown);
  const progress = jest.fn();
  const result = await generateAgenticRiskReport({ ...options, setProgress: progress });
  expect(result.report).toBe(markdown);
  expect(progress).toHaveBeenLastCalledWith({ step: 5, total: 5 });
  expect(global.fetch).toHaveBeenCalledTimes(4);
  global.fetch.mock.calls.forEach(([url, request]) => {
    expect(url).toBe(`${backendURL}/api/chat`);
    expect(request.headers["x-ai-provider"]).toBe("openai");
    expect(JSON.parse(request.body)).toMatchObject({ max_tokens: 8192, xhandleWorkflow: "report-generation" });
  });
});

test("retries an empty cut-off planning response before parsing JSON and increases the bounded budget", async () => {
  responses(completion("", "length"), planning, summary, audit, markdown);
  await expect(generateAgenticRiskReport(options)).resolves.toMatchObject({ report: markdown });
  expect(JSON.parse(global.fetch.mock.calls[1][1].body).max_tokens).toBe(16384);
});

test.each(["max_tokens", "MAX_OUTPUT_TOKENS"])("does not accept even valid JSON when marked truncated: %s", async (reason) => {
  responses(completion(planning, reason), planning, summary, audit, markdown);
  await expect(generateAgenticRiskReport(options)).resolves.toMatchObject({ report: markdown });
  expect(global.fetch).toHaveBeenCalledTimes(5);
});

test("retries malformed and schema-invalid planning output, accepting fenced complete JSON", async () => {
  responses('{"riskLevel":', '{"riskLevel":"low"}', `\`\`\`json\n${planning}\n\`\`\``, summary, audit, markdown);
  await expect(generateAgenticRiskReport(options)).resolves.toMatchObject({ report: markdown });
  expect(global.fetch).toHaveBeenCalledTimes(6);
});

test("retries an incomplete HTTP JSON body", async () => {
  responses({ ok: true, json: async () => { throw new SyntaxError("Unexpected EOF"); } }, planning, summary, audit, markdown);
  await expect(generateAgenticRiskReport(options)).resolves.toMatchObject({ report: markdown });
});

test.each([
  [completion(""), "empty response"],
  [completion('{"riskLevel":'), "required complete structured response"],
  [completion("", "length"), "cut off"],
  [{ ok: true, json: async () => { throw new SyntaxError("Unexpected EOF"); } }, "incomplete or invalid response"],
])("reports persistent failures with the planning stage and no raw JSON error", async (response, message) => {
  global.fetch.mockResolvedValue(response);
  const error = await generateAgenticRiskReport(options).catch((failure) => failure);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toMatch(/^Report planning:/);
  expect(error.message).toContain(message);
  expect(error.message).not.toMatch(/Unexpected|EOF|JSON\.parse/);
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test("retries invalid summary and audit fields before downstream synthesis", async () => {
  responses(planning, '{"summary":"","confidence":200}', summary,
    '{"needsRevision":true,"indexesToFix":[99],"revisionAdvice":["Fix"]}', audit, markdown);
  await expect(generateAgenticRiskReport(options)).resolves.toMatchObject({ report: markdown });
});

test("does not silently synthesize a design report when all findings summaries fail", async () => {
  responses(planning);
  global.fetch.mockResolvedValue(completion("{}"));
  await expect(generateAgenticRiskReport(options)).rejects.toThrow("Report findings summary failed");
  expect(global.fetch).toHaveBeenCalledTimes(4);
});

test("bounds continuations and retains an incomplete final draft instead of claiming success", async () => {
  responses(planning, summary, audit);
  global.fetch.mockResolvedValue(completion("# Incomplete report", "length"));
  await expect(generateAgenticRiskReport(options)).rejects.toMatchObject({
    stage: 'Report writing', partialReport: expect.stringContaining('# Incomplete report'),
    message: expect.stringContaining('still incomplete after several continuations'),
  });
  expect(global.fetch).toHaveBeenCalledTimes(7);
});

test('continues a cut-off final report using its partial answer without restarting earlier stages', async () => {
  responses(planning, summary, audit, completion('# Report\n\nFirst ', 'length'), 'part completed.');
  const progress = jest.fn();
  await expect(generateAgenticRiskReport({ ...options, setProgress: progress })).resolves.toMatchObject({ report: '# Report\n\nFirst part completed.' });
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ message: 'Continuing report…' }));
  expect(global.fetch).toHaveBeenCalledTimes(5);
  const continuation = JSON.parse(global.fetch.mock.calls[4][1].body);
  expect(continuation.messages[2]).toEqual({ role: 'assistant', content: '# Report\n\nFirst ' });
  expect(continuation.messages[3].content).toContain('Continue exactly');
});

test('continues a long architecture overview as well as final report writing', async () => {
  responses(planning, summary, audit, completion('Architecture ', 'length'), 'overview.', markdown);
  await expect(generateAgenticRiskReport({ ...options, functionalDecomposition: [['A', 'signal', 'B']] }))
    .resolves.toMatchObject({ report: markdown });
  expect(JSON.parse(global.fetch.mock.calls[5][1].body).messages[1].content).toContain('Architecture overview.');
});

test('preserves a partial draft if a later continuation loses its connection', async () => {
  responses(planning, summary, audit, completion('# Draft\n\nSaved portion.', 'length'));
  global.fetch.mockRejectedValue(new TypeError('network unavailable'));
  await expect(generateAgenticRiskReport(options)).rejects.toMatchObject({ stage: 'Report writing', partialReport: '# Draft\n\nSaved portion.' });
});

test('separate report runs do not share mutable summary state', async () => {
  global.fetch.mockImplementation(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (prompt.includes('Rate how well')) return completion(planning);
    if (prompt.includes('Below is a section')) return completion(JSON.stringify({ summary: prompt.includes('Project-A') ? 'Finding A' : 'Finding B', confidence: 90 }));
    if (prompt.includes('You are auditing')) return completion(audit);
    return completion(prompt.includes('Finding A') ? '# Report A' : '# Report B');
  });
  const [a, b] = await Promise.all(['A', 'B'].map((name) => generateAgenticRiskReport({ ...options, summarySheet: [['Function'], ['Project-' + name]] })));
  expect(a.report).toBe('# Report A'); expect(b.report).toBe('# Report B');
  expect(a.state).not.toBe(b.state);
});

test("does not retry authentication failures or expose provider payloads", async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 401, text: async () => "private provider details" });
  await expect(generateAgenticRiskReport(options)).rejects.toThrow("Report planning: AI request failed (401). Check the AI provider key in Settings.");
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test("does not retry a provider refusal", async () => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { refusal: "declined" } }] }) });
  await expect(generateAgenticRiskReport(options)).rejects.toThrow("Report planning: the AI provider declined this request");
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test("forwards a saved non-OpenAI provider selection", async () => {
  localStorage.setItem("xhandle.aiProvider.active", "claude");
  localStorage.setItem("xhandle.aiProvider.keys", JSON.stringify({ claude: { apiKey: "synthetic-test-provider-key" } }));
  responses(planning, summary, audit, markdown);
  await expect(generateAgenticRiskReport(options)).resolves.toMatchObject({ report: markdown });
  expect(global.fetch.mock.calls[0][1].headers).toMatchObject({
    "x-ai-provider": "claude", "x-ai-api-key": "synthetic-test-provider-key",
  });
});

test("keeps safety, custom reports, and audit revisions working", async () => {
  const revision = JSON.stringify({ needsRevision: true, indexesToFix: [0], revisionAdvice: ["Clarify the safeguard."] });
  responses(planning, summary, revision, "Revised safeguard summary.", "# Safety Report\n\nSafeguard findings.");
  await expect(generateAgenticRiskReport({ ...options, reportType: "Safety" })).resolves.toMatchObject({
    report: "# Safety Report\n\nSafeguard findings.",
  });
  global.fetch.mockReset();
  responses(planning, summary, audit, "# Custom report\n\nRequested findings.");
  await expect(generateAgenticRiskReport({ ...options, reportType: "Custom Report", customPrompt: "Describe the safeguards." }))
    .resolves.toMatchObject({ report: "# Custom report\n\nRequested findings." });
  expect(JSON.parse(global.fetch.mock.calls[3][1].body).messages[1].content).toContain("Describe the safeguards.");
});

test("keeps architecture-only reports working with diagram data and no hazard rows", async () => {
  responses("## Functions\n\nControl", "Architecture overview.", markdown);
  await expect(generateAgenticRiskReport({
    ...options, summarySheet: [], reportType: "Functional Architecture Definition",
    functionalDecomposition: [["Control", "Signal", "Actuate"]],
  })).resolves.toMatchObject({ report: markdown });
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('new report writing requests graphical diagram blocks while preserving Markdown output', async () => {
  responses(planning, summary, audit, markdown);
  await generateAgenticRiskReport(options);
  const body = JSON.parse(global.fetch.mock.calls[3][1].body);
  expect(body.messages[0].content).toContain('xhandle-diagram');
  expect(body.messages[0].content).toContain('never ASCII art');
  expect(body.response_format).toBeUndefined();
});

test('converts an existing diagram using the selected provider and validates its graph before rendering', async () => {
  const graph = { title: 'Control flow', direction: 'TB', notes: [], nodes: [{ id: 'a', label: 'QIBUS' }, { id: 'b', label: 'ATOMS DBW' }], edges: [{ from: 'a', to: 'b', label: 'Control' }] };
  responses(JSON.stringify(graph));
  await expect(generateGraphicalReportDiagram('QIBUS --> ATOMS DBW')).resolves.toEqual(graph);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(body.messages[1].content).toContain('QIBUS --> ATOMS DBW');
  expect(body.response_format.json_schema.strict).toBe(true);
});

test('rejects invented endpoints returned by diagram conversion with bounded retries', async () => {
  global.fetch.mockResolvedValue(completion(JSON.stringify({ title: 'Invalid', direction: 'LR', notes: [], nodes: [{ id: 'a', label: 'Existing' }], edges: [{ from: 'a', to: 'invented', label: 'No target' }] })));
  await expect(generateGraphicalReportDiagram('Existing diagram')).rejects.toThrow('Report diagram:');
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('canceling diagram conversion stops the request without retrying', async () => {
  global.fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }));
  const controller = new AbortController();
  const request = generateGraphicalReportDiagram('Existing diagram', { signal: controller.signal });
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each([
  '{"needsRevision":false}',
  '{"needsRevision":false,"indexesToFix":null,"revisionAdvice":null}',
  '{"needsRevision":false,"revisions":[]}',
  'No changes needed.\n{"needsRevision":false}\nThe summaries are consistent.',
])("accepts complete no-revision audit decisions without requiring unused arrays: %s", async (decision) => {
  responses(planning, summary, decision, markdown);
  const result = await generateAgenticRiskReport(options);
  expect(result.report).toBe(markdown);
  expect(result.audit).toEqual({ needsRevision: false, indexesToFix: [], revisionAdvice: [] });
  expect(global.fetch).toHaveBeenCalledTimes(4);
});

test("labels audit summaries with explicit identifiers and pairs revision advice with them", async () => {
  const advice = 'Clarify the safeguard with {braces} and "quoted" terms.';
  responses(planning, summary,
    "Audit follows:\n" + JSON.stringify({ needsRevision: true, revisions: [{ summaryId: "summary-0", advice }] }) + "\nEnd of audit.",
    "Revised safeguard findings.", markdown);
  const result = await generateAgenticRiskReport(options);
  expect(result.report).toBe(markdown);
  expect(result.audit).toMatchObject({ needsRevision: true, indexesToFix: [0], revisionAdvice: [advice] });
  const auditRequest = JSON.parse(global.fetch.mock.calls[2][1].body);
  expect(auditRequest.messages[1].content).toContain('"summaryId":"summary-0"');
  expect(auditRequest.messages[1].content).not.toContain('"indexesToFix": [number]');
  expect(auditRequest.response_format.json_schema).toMatchObject({ strict: true });
  expect(auditRequest.response_format.json_schema.schema.properties.revisions.items.properties.summaryId).toEqual({ type: "string" });
});

test("uses native structured responses only for supported OpenAI models and only JSON stages", async () => {
  responses(planning, summary, audit, markdown);
  await generateAgenticRiskReport(options);
  const requests = global.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
  requests.slice(0, 3).forEach((body) => expect(body.response_format).toMatchObject({ type: "json_schema" }));
  expect(requests[3].response_format).toBeUndefined();
  global.fetch.mockReset();
  localStorage.setItem("xhandle.aiProvider.active", "claude");
  localStorage.setItem("xhandle.aiProvider.keys", JSON.stringify({ claude: { apiKey: "synthetic-test-provider-key" } }));
  responses(planning, summary, audit, markdown);
  await generateAgenticRiskReport(options);
  const claudeRequest = JSON.parse(global.fetch.mock.calls[2][1].body);
  expect(claudeRequest.response_format).toBeUndefined();
  expect(claudeRequest.messages[0].content).toContain('"required":["needsRevision","revisions"]');
});

test("corrects the audit contract on retry instead of repeating the same prompt", async () => {
  responses(planning, summary,
    '{"needsRevision":true,"revisions":[{"summaryId":"summary-99","advice":"Fix"}]}',
    '{"needsRevision":false,"revisions":[]}', markdown);
  await expect(generateAgenticRiskReport(options)).resolves.toMatchObject({ report: markdown });
  const first = JSON.parse(global.fetch.mock.calls[2][1].body);
  const retry = JSON.parse(global.fetch.mock.calls[3][1].body);
  expect(retry.messages[0].content).toContain("previous answer was rejected (invalid structured fields)");
  expect(retry.messages[0].content).toContain("Use only the supplied summaryId values");
  expect(retry.messages).toHaveLength(first.messages.length);
  expect(retry.messages[0].content).not.toContain("summary-99");
});

test.each([
  { needsRevision: true, revisions: [] },
  { needsRevision: true, revisions: [{ summaryId: "summary-0", advice: "" }] },
  { needsRevision: true, revisions: [{ summaryId: "summary-0", advice: "A" }, { summaryId: "summary-0", advice: "B" }] },
  { needsRevision: false, revisions: [{ summaryId: "summary-0", advice: "Fix" }] },
])("still rejects ambiguous or contradictory audit decisions: %j", async (decision) => {
  responses(planning, summary);
  global.fetch.mockResolvedValue(completion(JSON.stringify(decision)));
  await expect(generateAgenticRiskReport(options)).rejects.toThrow("Report audit: the AI provider did not return the required complete structured response (invalid structured fields)");
  expect(global.fetch).toHaveBeenCalledTimes(5);
});

test("does not repair truncated audit JSON or silently mark an unaudited report complete", async () => {
  responses(planning, summary);
  global.fetch.mockResolvedValue(completion('{"needsRevision":false'));
  await expect(generateAgenticRiskReport(options)).rejects.toThrow("Report audit: the AI provider did not return the required complete structured response (invalid JSON)");
  expect(global.fetch).toHaveBeenCalledTimes(5);
});

test("does not confuse the original source chunk when an earlier summary failed", async () => {
  const rows = [["Function", "Risk"], ...Array.from({ length: 26 }, (_, index) => ["Function-" + index, "Risk-" + index])];
  global.fetch.mockImplementation(async (_url, init) => {
    const request = JSON.parse(init.body);
    const prompt = request.messages[1].content;
    if (prompt.includes("Rate how well")) return completion(planning);
    if (prompt.includes("Below is a section")) {
      if (prompt.includes("Function-0\n")) return completion("{}");
      return completion(summary);
    }
    if (prompt.includes("You are auditing")) return completion('{"needsRevision":true,"revisions":[{"summaryId":"summary-0","advice":"Clarify"}]}');
    if (prompt.includes("Revise the following")) {
      expect(prompt).toContain("Function-25");
      expect(prompt).not.toContain("Function-0\n");
      return completion("Revised final chunk summary.");
    }
    return completion(markdown);
  });
  const result = await generateAgenticRiskReport({ ...options, summarySheet: rows });
  expect(result.state.failedChunks).toHaveLength(1);
  expect(result.state.revisionsMade).toHaveLength(1);
  expect(result.state.completedChunkRows).toEqual([[rows[26]]]);
});
