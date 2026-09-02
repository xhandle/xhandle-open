jest.mock("react-markdown", () => function ReactMarkdownMock({ children }) {
  return <div>{children}</div>;
});
jest.mock("remark-gfm", () => jest.fn());
jest.mock("rehype-sanitize", () => ({
  __esModule: true,
  default: jest.fn(),
  defaultSchema: {},
}));
jest.mock("html2canvas", () => jest.fn());
jest.mock("lucide-react", () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});
jest.mock("./RegionLassoOverlay", () => ({ openRegionSelector: jest.fn() }));
jest.mock("./utils/copilotContextBus", () => ({
  pushRegionContext: jest.fn(),
  popAllRegionContext: jest.fn(() => []),
}));
jest.mock("../features/workspace-graph", () => ({
  buildWorkspaceLLMContext: jest.fn(),
}));

const {
  FUNCTIONAL_DECOMPOSITION_GENERATION_INSTRUCTIONS,
  SUBSYSTEM_ARCHITECTURE_REVIEW_SYSTEM_PROMPT,
  buildFunctionalAbstractionChoiceMessage,
  buildCollaboratorChatPayload,
  buildCollaboratorContinuationMessages,
  buildCollaboratorModelOptions,
  buildResolvedAbstractionRequest,
  buildPromptContentFromContext,
  isDiagramFunctionalDecompositionRequest,
  isFunctionalDecompositionTableResponse,
  hasGenericControlActionsInFunctionalTable,
  inferFunctionalAbstractionLevel,
  extractMultiLevelLeafInventory,
  formatCollaboratorReasoningList,
  formatCollaboratorSourceCitations,
  insertSupplementalFunctionalRows,
  isCollaboratorLengthFinishReason,
  mergeCollaboratorContinuation,
  functionalAbstractionInstruction,
  isSubsystemGenerationRequest,
  needsFunctionalAbstractionClarification,
  materializeMultiLevelReview,
  renderCopilotContext,
  renderSubsystemArchitectureReview,
  sanitizeSubsystemArchitectureReview,
  shouldHandlePendingRowsApply,
  shouldReviewGeneratedFunctionalDecomposition,
  validateSubsystemArchitectureReview,
  validateMultiLevelHierarchy,
  normalizeMultiLevelHierarchy,
  parseCollaboratorReasoningEnvelope,
  recalculateFunctionalDirectionAudit,
  selectLiveCollaboratorReasoning,
} = require("./XHandleCopilotView");

describe("subsystem generation prompting", () => {
  it("separates a streamed reasoning summary from the final answer", () => {
    const partial = parseCollaboratorReasoningEnvelope("<collaborator_reasoning>\n- Inspecting project context");
    expect(partial).toEqual(expect.objectContaining({
      content: "",
      reasoningSummary: "- Inspecting project context",
      reasoningActive: true,
    }));

    const complete = parseCollaboratorReasoningEnvelope([
      "<collaborator_reasoning>",
      "- Used the selected abstraction level",
      "</collaborator_reasoning>",
      "<collaborator_answer>",
      "Final response",
      "</collaborator_answer>",
    ].join("\n"));
    expect(complete).toEqual(expect.objectContaining({
      content: "Final response\n",
      reasoningSummary: "- Used the selected abstraction level",
      reasoningActive: false,
      enveloped: true,
    }));
    expect(parseCollaboratorReasoningEnvelope("A normal short reply").content).toBe("A normal short reply");
  });

  it("replaces app progress with the latest streamed model reasoning and keeps it list-shaped", () => {
    const progress = "- Reviewing context\n- Drafting interfaces";
    const latestModelSummary = "- Established the boundary\n- Connected the control loop";

    expect(selectLiveCollaboratorReasoning(progress, "")).toBe(progress);
    expect(selectLiveCollaboratorReasoning(progress, latestModelSummary)).toBe(latestModelSummary);
    expect(selectLiveCollaboratorReasoning(progress, latestModelSummary, true)).toBe(progress);
    expect(formatCollaboratorReasoningList("Reviewing context\nDrafting interfaces")).toBe(
      "- Reviewing context\n- Drafting interfaces",
    );
  });

  it("turns internal artifact citations into readable in-app source links", () => {
    const artifactId = "artifact:projectData3Ap13AresponseRows3A11:abc123";
    const response = [
      "- **Calibration Verification**",
      "  Acts as an independent release gate.",
      `  [Artifact \`${artifactId}\`; source pointer \`p1:responseRows:11\`]`,
    ].join("\n");

    const formatted = formatCollaboratorSourceCitations(response, [{
      artifactId,
      type: "functional_decomposition_row",
      title: "Calibration Verification -> Parameter Promotion",
      sourceId: "p1:responseRows:11",
      projectId: "p1",
    }]);
    expect(formatted).toContain(
      `[Source: Calibration Verification → Parameter Promotion — Functional Decomposition](#xhandle-artifact=${encodeURIComponent(artifactId)}&`,
    );
    expect(formatted).toContain("sourceId=p1%3AresponseRows%3A11");
    expect(formatted).toContain("projectId=p1");
    expect(formatCollaboratorSourceCitations(response, [{ artifactId: "another-artifact" }]))
      .toContain(`[Source: row 12 — Functional Decomposition](#xhandle-artifact=${encodeURIComponent(artifactId)}&sourceId=p1%3AresponseRows%3A11`);
  });

  it("forwards the AI Provider modal's active model in request headers", () => {
    const priorKeys = localStorage.getItem("xhandle.aiProvider.keys");
    const priorProvider = localStorage.getItem("xhandle.aiProvider.active");
    const priorModel = localStorage.getItem("xhandle.aiProviderModel.openai");
    localStorage.setItem("xhandle.aiProvider.keys", JSON.stringify({ openai: { apiKey: "sk-proj-test-active-provider-key" } }));
    localStorage.setItem("xhandle.aiProvider.active", "openai");
    localStorage.setItem("xhandle.aiProviderModel.openai", "gpt-4o");

    const { buildAIAuthOpts } = require("./backendConfig");
    const request = buildAIAuthOpts({ "Content-Type": "application/json" });
    expect(request.headers["x-ai-provider"]).toBe("openai");
    expect(request.headers["x-ai-model"]).toBe("gpt-4o");

    if (priorKeys == null) localStorage.removeItem("xhandle.aiProvider.keys"); else localStorage.setItem("xhandle.aiProvider.keys", priorKeys);
    if (priorProvider == null) localStorage.removeItem("xhandle.aiProvider.active"); else localStorage.setItem("xhandle.aiProvider.active", priorProvider);
    if (priorModel == null) localStorage.removeItem("xhandle.aiProviderModel.openai"); else localStorage.setItem("xhandle.aiProviderModel.openai", priorModel);
  });

  it("leaves model selection to the AI Provider configuration", () => {
    const payload = buildCollaboratorChatPayload([{ role: "user", content: "Hello" }], {
      maxTokens: 2400,
      stream: true,
    });

    expect(payload).not.toHaveProperty("model");
    expect(payload).toEqual(expect.objectContaining({ max_tokens: 2400, stream: true }));
  });

  it("recognizes provider output-limit signals and builds a bounded continuation request", () => {
    expect(isCollaboratorLengthFinishReason("length")).toBe(true);
    expect(isCollaboratorLengthFinishReason("MAX_TOKENS")).toBe(true);
    expect(isCollaboratorLengthFinishReason("stop")).toBe(false);

    const initial = [{ role: "user", content: "Create the decomposition" }];
    const continued = buildCollaboratorContinuationMessages(initial, "Partial table row");
    expect(continued).toHaveLength(3);
    expect(continued[1]).toEqual({ role: "assistant", content: "Partial table row" });
    expect(continued[2].content).toContain("Return only the missing continuation");
    expect(continued[2].content).toContain("restart that one incomplete row");

    expect(mergeCollaboratorContinuation(
      "| A | B |\n| --- | --- |\n| complete | row |\n| interrupted",
      "| restarted | row |",
    )).toBe("| A | B |\n| --- | --- |\n| complete | row |\n| restarted | row |");
  });

  it("reconciles multi-level hierarchy coverage and derives audit counts from actual rows", () => {
    const draft = [
      "### Decomposition Hierarchy",
      "L1.1 — Perception",
      "L2.1.1 Acquire observations",
      "L2.1.2 Assess observation quality",
      "L1.2 — Planning",
      "L2.2.1 Select maneuver",
      "",
      "### Functional-Decomposition Table",
      "| Subsystem | Function From | Function From Details | Control Action | Control Action Details | Function To | Function To Details |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| Perception | Acquire observations | Collects observations | Publish observations | Provides synchronized observations | Assess observation quality | Evaluates observation validity |",
      "| Perception | Assess observation quality | Evaluates observation validity | Supply qualified observations | Provides observations and confidence | Select maneuver | Chooses an operating maneuver |",
      "",
      "### Interface Direction Audit",
      "Total interfaces: 99",
      "Primary forward/data-processing interfaces: 99",
    ].join("\n");
    const inventory = extractMultiLevelLeafInventory(draft);
    expect(inventory).toEqual([
      { name: "Acquire observations", parent: "Perception" },
      { name: "Assess observation quality", parent: "Perception" },
      { name: "Select maneuver", parent: "Planning" },
    ]);
    expect(extractMultiLevelLeafInventory([
      "### Decomposition Hierarchy",
      "L1.1 — Perception",
      "L2.1.1 — Observation Management",
      "L3.1.1.1 — Acquire observations",
      "### Functional-Decomposition Table",
    ].join("\n"))).toEqual([{ name: "Acquire observations", parent: "Perception" }]);

    const withSupplement = insertSupplementalFunctionalRows(draft, [{
      subsystem: "Planning",
      fromFunction: "Select maneuver",
      fromDetails: "Chooses an operating maneuver",
      controlAction: "Report maneuver decision",
      controlDetails: "Provides the selected maneuver and decision basis",
      toFunction: "Assess observation quality",
      toDetails: "Uses maneuver demand to prioritize observation-quality assessment",
    }]);
    const audited = recalculateFunctionalDirectionAudit(withSupplement, inventory);
    expect(audited).toContain("Total interfaces: 3");
    expect(audited).toContain("Hierarchy leaf coverage: 3/3");
    expect(audited).not.toContain("Total interfaces: 99");

    const envelopedWithoutAudit = [
      "<collaborator_answer>",
      "| Subsystem | Function From | Function From Details | Control Action | Control Action Details | Function To | Function To Details |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| Perception | Acquire observations | Collects observations | Publish observations | Provides observations | Assess observation quality | Evaluates validity |",
      "</collaborator_answer>",
    ].join("\n");
    const withAudit = recalculateFunctionalDirectionAudit(envelopedWithoutAudit, inventory.slice(0, 2));
    expect(withAudit.indexOf("Interface Direction Audit")).toBeLessThan(withAudit.indexOf("</collaborator_answer>"));
  });

  it("builds Collaborator model choices for the active provider and preserves custom selections", () => {
    const standard = buildCollaboratorModelOptions("openai", "gpt-4o");
    expect(standard).toEqual(expect.arrayContaining([expect.objectContaining({ value: "gpt-4o" })]));

    const custom = buildCollaboratorModelOptions("openai", "gpt-custom-architecture");
    expect(custom[0]).toEqual({ value: "gpt-custom-architecture", label: "gpt-custom-architecture (custom)" });
  });
  it("blocks generic control actions at the rendered table boundary", () => {
    const genericTable = [
      "| Subsystem | Function From | Function From Details | Control Action | Control Action Details | Function To | Function To Details |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| Example | Acquire Input | Collects input | send | Raw input | Interpret Input | Interprets input |",
    ].join("\n");
    const specificTable = genericTable.replace("| send |", "| Raw Measurement Publication |");

    expect(hasGenericControlActionsInFunctionalTable(genericTable)).toBe(true);
    expect(hasGenericControlActionsInFunctionalTable(specificTable)).toBe(false);
  });
  it("requires a justified closed-loop interface audit and boundary discipline", () => {
    const instructions = FUNCTIONAL_DECOMPOSITION_GENERATION_INSTRUCTIONS;

    expect(instructions).toContain("closed-loop interface audit");
    expect(instructions).toContain("acknowledgement/completion status");
    expect(instructions).toContain("configuration or parameter updates");
    expect(instructions).toContain("health/fault reporting");
    expect(instructions).toContain("reversed endpoints");
    expect(instructions).toContain("Do not mechanically mirror every row");
    expect(instructions).toContain("neighboring systems outside the requested boundary");
    expect(instructions).toContain("do not copy a fixed catalog");
    expect(instructions).toContain("Interface Direction Audit");
    expect(instructions).toContain("intentionally left unidirectional");
  });

  it("detects subsystem generation without matching unrelated subsystem questions", () => {
    expect(isSubsystemGenerationRequest(
      "Generate a functional decomposition for a Localization subsystem",
    )).toBe(true);
    expect(isSubsystemGenerationRequest(
      "Create interfaces and components for the Perception subsystem",
    )).toBe(true);
    expect(isSubsystemGenerationRequest(
      "Generate a Localization subsystem",
    )).toBe(true);
    expect(isSubsystemGenerationRequest(
      "Generate a LiDAR system",
    )).toBe(true);
    expect(isSubsystemGenerationRequest(
      "Design the perception architecture",
    )).toBe(true);
    expect(isSubsystemGenerationRequest(
      "Create an autonomy stack",
    )).toBe(true);
    expect(isSubsystemGenerationRequest(
      "Generate a functional decomposition for LiDAR",
    )).toBe(true);
    expect(isSubsystemGenerationRequest(
      "create a detailed functional decomposition table for a Lidar system",
    )).toBe(true);
    expect(isSubsystemGenerationRequest(
      "Create system requirements for LiDAR",
    )).toBe(false);
    expect(isSubsystemGenerationRequest(
      "What functions are currently in the Localization subsystem?",
    )).toBe(false);
  });

  it("routes generated seven-column tables through review even when wording misses intent detection", () => {
    const table = "Subsystem | Function From | Function From Details | Control Action | Control Action Details | Function To | Function To Details";
    expect(isFunctionalDecompositionTableResponse(table)).toBe(true);
    expect(shouldReviewGeneratedFunctionalDecomposition("Lidar please", table)).toBe(true);
    expect(shouldReviewGeneratedFunctionalDecomposition("Show the current saved table", table)).toBe(false);
    expect(shouldReviewGeneratedFunctionalDecomposition("Create a system", table, true)).toBe(false);
  });

  it("asks for abstraction only when a generation request leaves it ambiguous", () => {
    expect(needsFunctionalAbstractionClarification(
      "create a functional decomposition for an autonomy stack",
    )).toBe(true);
    expect(needsFunctionalAbstractionClarification(
      "create a detailed functional decomposition for an autonomy stack",
    )).toBe(false);
    expect(inferFunctionalAbstractionLevel("Use system-level abstraction")).toBe("system");
    expect(inferFunctionalAbstractionLevel("subsystem level")).toBe("subsystem");
    expect(inferFunctionalAbstractionLevel("3")).toBe("detailed-functional");
    expect(inferFunctionalAbstractionLevel("multi-level please")).toBe("multi-level");
    expect(inferFunctionalAbstractionLevel("create a lidar system")).toBe("");
  });

  it("builds a structured radio-choice prompt with a multi-level default", () => {
    const message = buildFunctionalAbstractionChoiceMessage();
    expect(message.role).toBe("assistant");
    expect(message.choicePrompt.type).toBe("functional-abstraction");
    expect(message.choicePrompt.options).toHaveLength(4);
    expect(message.choicePrompt.defaultValue).toBe("multi-level");
    expect(message.choicePrompt.options.find((option) => option.value === "multi-level")?.recommended).toBe(true);
    expect(message.choicePrompt.completed).toBe(false);
  });

  it("recognizes every canonical abstraction value emitted by the radio selector", () => {
    expect(inferFunctionalAbstractionLevel("system")).toBe("system");
    expect(inferFunctionalAbstractionLevel("subsystem")).toBe("subsystem");
    expect(inferFunctionalAbstractionLevel("detailed-functional")).toBe("detailed-functional");
    expect(inferFunctionalAbstractionLevel("multi-level")).toBe("multi-level");
    expect(inferFunctionalAbstractionLevel("multilevel")).toBe("multi-level");
    expect(inferFunctionalAbstractionLevel("detailed level")).toBe("detailed-functional");
    expect(inferFunctionalAbstractionLevel("leaf-function level")).toBe("detailed-functional");
  });

  it("gives each abstraction selection a materially different depth contract", () => {
    expect(functionalAbstractionInstruction("system")).toContain("enclosing system-of-interest boundary");
    expect(functionalAbstractionInstruction("system")).toContain("Do not list that enclosing system itself as a Subsystem");
    expect(functionalAbstractionInstruction("system")).toContain("Subsystem cell must name the major internal subsystem");
    expect(functionalAbstractionInstruction("system")).toContain("not internal capabilities");
    expect(functionalAbstractionInstruction("subsystem")).toContain("internally owned capabilities");
    expect(functionalAbstractionInstruction("detailed-functional")).toContain("implementable leaf functions");
    expect(functionalAbstractionInstruction("multi-level")).toContain("Decomposition Hierarchy");
    expect(functionalAbstractionInstruction("multi-level")).toContain("quality targets rather than hard acceptance criteria");
  });

  it("keeps abstraction metadata out of the user text parsed by local intent handlers", () => {
    const resolved = buildResolvedAbstractionRequest({
      userText: "Create a functional decomposition for an autonomy stack",
      options: {},
    }, "multi-level");

    expect(resolved.userText).toBe("Create a functional decomposition for an autonomy stack");
    expect(resolved.userText).not.toContain("Abstraction level selected by the user");
    expect(resolved.modelUserContent).toContain("Abstraction level selected by the user: multi-level");
  });

  it("preserves attached image model content when resuming after abstraction selection", () => {
    const imagePart = { type: "image_url", image_url: { url: "data:image/png;base64,example" } };
    const resolved = buildResolvedAbstractionRequest({
      userText: "Create a functional decomposition from this diagram",
      options: { modelUserContent: [imagePart, { type: "text", text: "Original diagram request" }] },
    }, "detailed-functional");

    expect(resolved.userText).toBe("Create a functional decomposition from this diagram");
    expect(resolved.modelUserContent[0]).toBe(imagePart);
    expect(resolved.modelUserContent.at(-1).text).toContain("DETAILED FUNCTIONAL abstraction");
  });

  it("does not reinterpret a resumed abstraction choice as approval to apply rows", () => {
    const resumed = "create a functional decomposition for an autonomy stack\n\nUse multi-level abstraction";
    expect(shouldHandlePendingRowsApply(resumed)).toBe(true);
    expect(shouldHandlePendingRowsApply(resumed, { abstractionResolved: true })).toBe(false);
  });

  it("reviews depth, boundaries, and reverse interfaces without example-domain bias", () => {
    const prompt = SUBSYSTEM_ARCHITECTURE_REVIEW_SYSTEM_PROMPT;

    expect(prompt).toContain("second-pass architecture reviewer");
    expect(prompt).toContain("purpose, operating context, lifecycle, and boundary");
    expect(prompt).toContain("canned reference architecture");
    expect(prompt).toContain("full operational lifecycle");
    expect(prompt).toContain("domain-neutral completeness check");
    expect(prompt).toContain("Do not manufacture symmetry");
    expect(prompt).toContain("Return strict JSON only");
    expect(prompt).toContain("The application derives counts and bidirectional pairs");
    expect(prompt).toContain("Multi-level output must include system context and detailed leaf functions");

    const modelGuidance = `${prompt}\n${FUNCTIONAL_DECOMPOSITION_GENERATION_INSTRUCTIONS}`;
    expect(modelGuidance).not.toMatch(/Perception|Localization|LiDAR|GPS|GNSS|IMU|Planning|Navigation/);
  });

  it("validates structured rows and renders deterministic audit counts", () => {
    const review = {
      requestedSystem: "Example System",
      rows: [
        { subsystem: "External Source", functionFrom: "External Source", functionFromDetails: "Supplies input", controlAction: "Input Delivery", controlActionDetails: "Provides input to A", functionTo: "Function A", functionToDetails: "Accepts input", sourceOwner: "External Source", targetOwner: "Example System", directionClass: "boundary-in" },
        { subsystem: "Example System", functionFrom: "Function A", functionFromDetails: "Produces state", controlAction: "State Delivery", controlActionDetails: "Delivers state to B", functionTo: "Function B", functionToDetails: "Consumes state", sourceOwner: "Example System", targetOwner: "Example System", directionClass: "forward" },
        { subsystem: "Example System", functionFrom: "Function B", functionFromDetails: "Assesses state", controlAction: "Quality Report", controlActionDetails: "Reports quality to A", functionTo: "Function A", functionToDetails: "Adapts production", sourceOwner: "Example System", targetOwner: "Example System", directionClass: "reverse" },
        { subsystem: "Example System", functionFrom: "Function B", functionFromDetails: "Publishes result", controlAction: "Result Delivery", controlActionDetails: "Provides result to consumer", functionTo: "External Consumer", functionToDetails: "Consumes result", sourceOwner: "Example System", targetOwner: "External Consumer", directionClass: "boundary-out" },
      ],
      intentionallyUnidirectional: [],
    };

    expect(validateSubsystemArchitectureReview(review)).toEqual([]);
    const rendered = renderSubsystemArchitectureReview(review);
    expect(rendered).toContain("Forward interface count: 1");
    expect(rendered).toContain("Reverse/feedback interface count: 1");
    expect(rendered).toContain("Function A ↔ Function B");
    expect(rendered).toContain("External boundary interface count: 2");

    const invalid = { ...review, rows: [{ ...review.rows[0], subsystem: "Wrong Owner", functionTo: "External Source" }] };
    expect(validateSubsystemArchitectureReview(invalid)).toEqual(expect.arrayContaining([
      expect.stringContaining("functionFrom and functionTo must differ"),
      expect.stringContaining("subsystem must equal sourceOwner"),
    ]));
  });

  it("rejects disconnected islands and ceremonial acknowledgement loops", () => {
    const invalidReview = {
      requestedSystem: "Example System",
      rows: [
        { subsystem: "External Source", functionFrom: "External Source", functionFromDetails: "Supplies input", controlAction: "Input Delivery", controlActionDetails: "Provides input", functionTo: "Function A", functionToDetails: "Accepts input", sourceOwner: "External Source", targetOwner: "Example System", directionClass: "boundary-in" },
        { subsystem: "Example System", functionFrom: "Function A", functionFromDetails: "Produces state", controlAction: "State Delivery", controlActionDetails: "Provides state", functionTo: "Function B", functionToDetails: "Consumes state", sourceOwner: "Example System", targetOwner: "Example System", directionClass: "forward" },
        { subsystem: "Example System", functionFrom: "Function B", functionFromDetails: "Stores state", controlAction: "Log Acknowledgement", controlActionDetails: "Acknowledges receipt for record-keeping", functionTo: "Function A", functionToDetails: "Produces state", sourceOwner: "Example System", targetOwner: "Example System", directionClass: "reverse" },
        { subsystem: "Example System", functionFrom: "Disconnected Function", functionFromDetails: "Performs separate work", controlAction: "Result Delivery", controlActionDetails: "Provides result", functionTo: "External Consumer", functionToDetails: "Consumes result", sourceOwner: "Example System", targetOwner: "External Consumer", directionClass: "boundary-out" },
      ],
      intentionallyUnidirectional: [],
    };

    expect(validateSubsystemArchitectureReview(invalidReview)).toEqual(expect.arrayContaining([
      expect.stringContaining("ceremonial acknowledgement"),
      expect.stringContaining("Internal function graph is disconnected"),
    ]));
  });

  it("normalizes ownership and removes ceremonial acknowledgement rows before repair", () => {
    const review = {
      requestedSystem: "Example System",
      rows: [
        { subsystem: "Wrong", functionFrom: "Function A", functionFromDetails: "Produces state", controlAction: "State Delivery", controlActionDetails: "Provides state", functionTo: "Function B", functionToDetails: "Consumes state", sourceOwner: "Example", targetOwner: "Example System", directionClass: "forward" },
        { subsystem: "Example System", functionFrom: "Function B", functionFromDetails: "Stores state", controlAction: "Log Acknowledgement", controlActionDetails: "Acknowledges receipt for record-keeping", functionTo: "Function A", functionToDetails: "Produces state", sourceOwner: "Example System", targetOwner: "Example System", directionClass: "reverse" },
      ],
    };

    const normalized = sanitizeSubsystemArchitectureReview(review);
    expect(normalized.rows).toHaveLength(1);
    expect(normalized.rows[0].subsystem).toBe("Example");
    expect(normalized.rows[0].directionClass).toBe("forward");
  });

  it("treats shallow multi-level depth as non-blocking quality guidance", () => {
    const shallowReview = {
      requestedSystem: "Example System",
      rows: [
        { subsystem: "External", functionFrom: "External Input", functionFromDetails: "Supplies input", controlAction: "Input Delivery", controlActionDetails: "Provides input", functionTo: "Capability A", functionToDetails: "Consumes input", sourceOwner: "External", targetOwner: "Example System", directionClass: "boundary-in", functionFromLevel: "external", functionFromParent: "", functionToLevel: "system-element", functionToParent: "" },
        { subsystem: "Example System", functionFrom: "Capability A", functionFromDetails: "Produces state", controlAction: "State Delivery", controlActionDetails: "Provides state", functionTo: "Capability B", functionToDetails: "Consumes state", sourceOwner: "Example System", targetOwner: "Example System", directionClass: "forward", functionFromLevel: "system-element", functionFromParent: "", functionToLevel: "system-element", functionToParent: "" },
        { subsystem: "Example System", functionFrom: "Capability B", functionFromDetails: "Assesses state", controlAction: "Quality Report", controlActionDetails: "Reports quality", functionTo: "Capability A", functionToDetails: "Adapts output", sourceOwner: "Example System", targetOwner: "Example System", directionClass: "reverse", functionFromLevel: "system-element", functionFromParent: "", functionToLevel: "system-element", functionToParent: "" },
        { subsystem: "Example System", functionFrom: "Capability B", functionFromDetails: "Publishes result", controlAction: "Result Delivery", controlActionDetails: "Provides result", functionTo: "External Output", functionToDetails: "Consumes result", sourceOwner: "Example System", targetOwner: "External", directionClass: "boundary-out", functionFromLevel: "system-element", functionFromParent: "", functionToLevel: "external", functionToParent: "" },
      ],
      intentionallyUnidirectional: [],
    };

    expect(validateSubsystemArchitectureReview(shallowReview, "system")).toEqual([]);
    expect(validateSubsystemArchitectureReview(shallowReview, "multi-level")).toEqual([]);
    expect(renderSubsystemArchitectureReview(shallowReview)).toContain("Decomposition Hierarchy");
  });

  it("validates a dedicated multi-level hierarchy before interface generation", () => {
    const hierarchy = {
      requestedSystem: "Example System",
      systemElements: [
        { name: "Element A", responsibility: "Owns input behavior" },
        { name: "Element B", responsibility: "Owns transformation behavior" },
        { name: "Element C", responsibility: "Owns output behavior" },
      ],
      leafFunctions: [
        { name: "A1", parent: "Element A", stage: "input", responsibility: "Validates input", consumes: ["external input"], produces: ["validated input"] },
        { name: "A2", parent: "Element A", stage: "assurance", responsibility: "Monitors input", consumes: ["validated input"], produces: ["input quality"] },
        { name: "B1", parent: "Element B", stage: "transform", responsibility: "Transforms input", consumes: ["validated input"], produces: ["transformed state"] },
        { name: "B2", parent: "Element B", stage: "decision", responsibility: "Selects outcome", consumes: ["transformed state"], produces: ["selected outcome"] },
        { name: "B3", parent: "Element B", stage: "assurance", responsibility: "Monitors quality", consumes: ["transformed state"], produces: ["quality state"] },
        { name: "C1", parent: "Element C", stage: "output", responsibility: "Coordinates output", consumes: ["selected outcome"], produces: ["operational output"] },
        { name: "C2", parent: "Element C", stage: "output", responsibility: "Publishes output", consumes: ["operational output"], produces: ["published output"] },
        { name: "C3", parent: "Element C", stage: "assurance", responsibility: "Monitors delivery", consumes: ["published output"], produces: ["delivery status"] },
      ],
      externalEntities: [
        { name: "External Source", role: "input-source", relationship: "Provides input", provides: ["external input"], receives: [] },
        { name: "External Consumer", role: "operational-output-recipient", relationship: "Consumes output", provides: [], receives: ["operational output"] },
      ],
      missionFlow: ["A1", "B1", "B2", "C1"],
    };

    expect(validateMultiLevelHierarchy(hierarchy)).toEqual([]);
    expect(validateMultiLevelHierarchy({ ...hierarchy, leafFunctions: hierarchy.leafFunctions.slice(0, 2) })).toEqual(expect.arrayContaining([
      expect.stringContaining("missionFlow references unknown leaves"),
    ]));
  });

  it("normalizes legacy hierarchy omissions along the declared mission flow", () => {
    const normalized = normalizeMultiLevelHierarchy({
      leafFunctions: [
        { name: "Acquire", stage: "transform" },
        { name: "Execute", stage: "decision" },
      ],
      externalEntities: [
        { name: "Source", role: "input-source" },
        { name: "Plant", role: "operational-output-recipient" },
      ],
      missionFlow: ["Acquire", "Execute"],
    });

    expect(normalized.leafFunctions[0]).toEqual(expect.objectContaining({ stage: "input", consumes: ["Acquire input"], produces: ["Acquire result"] }));
    expect(normalized.leafFunctions[1]).toEqual(expect.objectContaining({ stage: "output", consumes: ["Acquire result"], produces: ["Execute result"] }));
    expect(normalized.externalEntities[0].provides).toEqual(["Acquire input"]);
    expect(normalized.externalEntities[1].receives).toEqual(["Execute result"]);
  });

  it("turns interface-concept hierarchy labels into behavioral function names", () => {
    const normalized = normalizeMultiLevelHierarchy({
      leafFunctions: [{ name: "Feedback Loop", stage: "assurance" }],
      externalEntities: [],
      missionFlow: ["Feedback Loop"],
    });

    expect(normalized.leafFunctions[0].name).toBe("Evaluate Operational Feedback");
    expect(normalized.missionFlow).toEqual(["Evaluate Operational Feedback"]);
  });

  it("materializes multi-level interfaces from authoritative hierarchy IDs", () => {
    const hierarchy = {
      requestedSystem: "Example System",
      systemElements: [{ id: "SE1", name: "Element A" }],
      leafFunctions: [
        { id: "LF1", name: "Leaf A", parent: "Element A", consumes: ["input"], produces: ["state"] },
        { id: "LF2", name: "Leaf B", parent: "Element A", consumes: ["state"], produces: ["result"] },
      ],
      externalEntities: [{ id: "EX1", name: "External Source", provides: ["input"], receives: [] }],
    };
    const { review, errors } = materializeMultiLevelReview(hierarchy, {
      interfaces: [
        { sourceId: "EX1", targetId: "LF1", sourceDetails: "Provides input", controlAction: "Input Delivery", controlActionDetails: "Supplies input to the leaf", payload: "input", targetDetails: "Consumes input", interactionRole: "primary" },
        { sourceId: "LF1", targetId: "LF2", sourceDetails: "Produces state", controlAction: "State Update", controlActionDetails: "Provides current state", payload: "state", targetDetails: "Coordinates behavior", interactionRole: "return" },
      ],
      intentionallyUnidirectional: [],
    });

    expect(errors).toEqual([]);
    expect(review.rows[0]).toEqual(expect.objectContaining({
      functionFrom: "External Source",
      functionTo: "Leaf A",
      directionClass: "boundary-in",
      functionToLevel: "leaf-function",
      functionToParent: "Element A",
    }));
    expect(review.rows[1]).toEqual(expect.objectContaining({
      subsystem: "Example System",
      functionFrom: "Leaf A",
      functionTo: "Leaf B",
      directionClass: "reverse",
    }));
  });

  it("repairs an interface payload to the endpoints' shared authoritative contract", () => {
    const hierarchy = {
      requestedSystem: "Example System",
      systemElements: [{ id: "SE1", name: "Element A" }],
      leafFunctions: [
        { id: "LF1", name: "Produce State", parent: "Element A", consumes: ["input"], produces: ["validated state"] },
        { id: "LF2", name: "Use State", parent: "Element A", consumes: ["validated state"], produces: ["result"] },
      ],
      externalEntities: [],
    };
    const { review, errors } = materializeMultiLevelReview(hierarchy, {
      interfaces: [{
        sourceId: "LF1", targetId: "LF2", payload: "state", sourceDetails: "Produces state",
        controlAction: "State Publication", controlActionDetails: "Publishes the validated state",
        targetDetails: "Uses state", interactionRole: "primary",
      }],
    });

    expect(errors).toEqual([]);
    expect(review.rows).toHaveLength(1);
  });

  it("keeps a usable interface when payload labels have no exact textual match", () => {
    const hierarchy = {
      requestedSystem: "Example System",
      systemElements: [{ id: "SE1", name: "Element A" }],
      leafFunctions: [
        { id: "LF1", name: "Produce State", parent: "Element A", consumes: ["input"], produces: ["state estimate"] },
        { id: "LF2", name: "Use State", parent: "Element A", consumes: ["current state"], produces: ["result"] },
      ],
      externalEntities: [],
    };
    const { review, errors } = materializeMultiLevelReview(hierarchy, {
      interfaces: [{
        sourceId: "LF1", targetId: "LF2", payload: "estimated state", sourceDetails: "Produces state",
        controlAction: "State Publication", controlActionDetails: "Publishes the estimated state",
        targetDetails: "Uses state", interactionRole: "primary",
      }],
    });

    expect(errors).toEqual([]);
    expect(review.rows).toHaveLength(1);
  });

  it("replaces a generic generated action with a specific contract-based action", () => {
    const hierarchy = {
      requestedSystem: "Example System",
      systemElements: [{ id: "SE1", name: "Element A" }],
      leafFunctions: [
        { id: "LF1", name: "Produce State", parent: "Element A", consumes: ["input"], produces: ["state estimate"] },
        { id: "LF2", name: "Use State", parent: "Element A", consumes: ["state estimate"], produces: ["result"] },
      ],
      externalEntities: [],
    };
    const { review, errors } = materializeMultiLevelReview(hierarchy, {
      interfaces: [{
        sourceId: "LF1", targetId: "LF2", payload: "state estimate", sourceDetails: "Produces state",
        controlAction: "send", controlActionDetails: "Provides the current estimate",
        targetDetails: "Uses state", interactionRole: "primary",
      }],
    });

    expect(errors).toEqual([]);
    expect(review.rows[0].controlAction).toBe("State Estimate Provision");
  });
});

describe("renderCopilotContext", () => {
  it("renders canonical workspace graph context without crashing", () => {
    const rendered = renderCopilotContext({
      scope: {
        workspaceId: "workspace:local",
        projectId: "p1",
        activeView: { section: "code-architecture" },
        query: "review hazards",
      },
      workspaceSummary: {
        projectCount: 1,
        artifactCount: 2,
        relationshipCount: 1,
        relevantArtifactCount: 1,
      },
      projects: [{ id: "p1", name: "Project One" }],
      relevantArtifacts: [
        {
          id: "artifact:hazard-1",
          type: "hazard_analysis_row",
          projectId: "p1",
          title: "Hazard row",
          sourceStore: "indexedDB:xhandle-code-architecture-hazard-analysis/hazardAnalysisRuns",
        },
      ],
      relationships: [
        {
          id: "rel:1",
          type: "derived_from",
          fromArtifactId: "artifact:hazard-1",
          toArtifactId: "run:1",
        },
      ],
      runs: [],
      reviews: [],
      evidence: [],
      sourceFiles: [{ id: "artifact:file-1", path: "src/hazard.ts", title: "src/hazard.ts" }],
      citations: [
        { artifactId: "artifact:hazard-1", type: "hazard_analysis_row" },
        { artifactId: "artifact:file-1", type: "source_file", title: "src/hazard.ts" },
      ],
      diagnostics: {},
    });

    expect(rendered).toContain("canonical xHandle workspace graph");
    expect(rendered).toContain("artifact:hazard-1");
    expect(rendered).toContain("artifact:file-1");
    expect(rendered).toContain("source_file");
    expect(rendered).toContain("derived_from");
  });
});

describe("diagram functional decomposition prompting", () => {
  const imageContext = [{
    file: { name: "architecture.png", type: "image/png", size: 1234 },
    imageDataUrl: "data:image/png;base64,abc123",
  }];

  it("detects image-grounded functional decomposition requests", () => {
    expect(isDiagramFunctionalDecompositionRequest(
      imageContext,
      "Use this diagram to create a functional decomposition",
    )).toBe(true);
    expect(isDiagramFunctionalDecompositionRequest(
      imageContext,
      "Describe the colors in this image",
    )).toBe(false);
    expect(isDiagramFunctionalDecompositionRequest(
      [],
      "Create a functional decomposition",
    )).toBe(false);
  });

  it("injects the visual inventory and coverage contract before the image", () => {
    const content = buildPromptContentFromContext(
      imageContext,
      "Use this diagram to create a functional decomposition",
    );

    expect(Array.isArray(content)).toBe(true);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain("Pass 1 — visual inventory");
    expect(content[0].text).toContain("every visible directed interface");
    expect(content[0].text).toContain("Never use connector text");
    expect(content[0].text).toContain("exactly those seven columns");
    expect(content[0].text).toContain("branched lines");
    expect(content[0].text).toContain("Coverage Check");
    expect(content.some((part) => part.type === "image_url")).toBe(true);
  });
});
