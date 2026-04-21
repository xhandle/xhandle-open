/**
 * xHandle: capability schema agent infrastructure.
 * This file defines the runtime-side structures that support xHandle's agent model, including task descriptions, monitoring hooks, and capability metadata.
 * These modules provide the shared contract between agent UIs and the orchestration logic that decides what an AI assistant should do, how it reports progress, and how task state is represented.
 * Related files: src/features/agents/xAgent/XAgentCenter.jsx, src/components/agentController.js, src/components/agentActions.js.
 */

// A shared, explicit capability model for all agents.
// Each agent declares: goals, tools, inputs, outputs, memory, actions, events.

export const AgentKinds = {
    PRODUCT: "product",
    DEV: "dev",
    SAFETY: "safety",
    VNV: "vnv",
  };
  
  export const capabilitySchema = {
    [AgentKinds.PRODUCT]: {
      displayName: "Product AI",
      goals: [
        "Capture and structure product intent, constraints, and stakeholder goals.",
        "Curate context packages for Safety and Dev agents.",
      ],
      tools: [
        { name: "ingestDocuments", in: ["files[]|urls[]"], out: ["contextPack"] },
        { name: "summarizeIntent", in: ["contextPack"], out: ["intentBrief"] },
      ],
      inputs: ["Design docs", "ConOps", "Stakeholder notes"],
      outputs: ["Intent Brief", "Context Pack"],
      memory: { shortTerm: ["currentBrief"], longTerm: ["projectContexts"] },
      actions: [
        { type: "product.create-intent-brief", desc: "Create/update intent brief" },
        { type: "product.publish-context", desc: "Publish context pack to bus" },
      ],
      events: {
        listen: ["safety.requirements-updated", "dev.architecture-updated"],
        emit: ["product.context-published", "product.intent-updated"],
      },
    },
  
    [AgentKinds.DEV]: {
      displayName: "Dev AI",
      goals: [
        "Translate intent and requirements into architecture and code artifacts.",
        "Keep diagrams and code-as-truth synchronized.",
      ],
      tools: [
        { name: "generateArchitecture", in: ["intentBrief", "requirements"], out: ["archDiagram"] },
        { name: "scanRepo", in: ["repoPath"], out: ["components", "links"] },
        { name: "renderDiagram", in: ["archDiagram"], out: ["svg|png"] },
      ],
      inputs: ["Intent Brief", "System Requirements", "Code Base"],
      outputs: ["Architecture Diagram", "Design Docs", "Links to Source"],
      memory: { shortTerm: ["lastArchGraph"], longTerm: ["moduleCatalog"] },
      actions: [
        { type: "dev.refresh-diagram", desc: "Re-generate architecture diagram" },
        { type: "dev.sync-from-repo", desc: "Re-scan repo + update graph" },
      ],
      events: {
        listen: ["product.context-published", "safety.requirements-updated"],
        emit: ["dev.architecture-updated"],
      },
    },
  
    [AgentKinds.SAFETY]: {
      displayName: "Systems & Safety AI",
      goals: [
        "Perform functional decomposition and hazard analysis (FMEA/STPA/What-If).",
        "Derive mitigations and system requirements with traceability.",
      ],
      tools: [
        { name: "runAnalysis", in: ["method", "decomposition|archGraph", "intentBrief"], out: ["summarySheet"] },
        { name: "generateMitigations", in: ["risks"], out: ["mitigationStrategies"] },
        { name: "deriveRequirements", in: ["mitigationStrategies"], out: ["requirements"] },
      ],
      inputs: ["Context Pack", "Architecture Graph / Decomposition"],
      outputs: ["Hazards, Mitigations, Requirements, Summary Sheet"],
      memory: { shortTerm: ["workingSheets"], longTerm: ["riskCorpus", "reqLibrary"] },
      actions: [
        { type: "safety.run-analysis", desc: "Run selected method" },
        { type: "safety.generate-mitigations", desc: "Generate mitigations for selected risks" },
      ],
      events: {
        listen: ["product.context-published", "dev.architecture-updated"],
        emit: ["safety.summary-updated", "safety.requirements-updated"],
      },
    },
  
    [AgentKinds.VNV]: {
        displayName: "V&V AI",      
      goals: [
        "Translate requirements into user stories and tests.",
        "Continuously verify and report V&V status.",
      ],
      tools: [
        { name: "generateUserStories", in: ["requirements"], out: ["stories"] },
        { name: "generateTests", in: ["requirements|stories", "codeBase"], out: ["tests", "junit|json"] },
        { name: "computeCoverage", in: ["tests", "requirements"], out: ["coverageReport"] },
      ],
      inputs: ["Requirements", "Code Base", "Architecture Graph"],
      outputs: ["Stories", "Tests", "Verification & Validation reports"],
      memory: { shortTerm: ["lastRun"], longTerm: ["evidenceVault"] },
      actions: [
        { type: "qa.generate-tests", desc: "Produce tests from reqs/stories" },
        { type: "qa.compute-coverage", desc: "Compute coverage & gaps" },
      ],
      events: {
        listen: ["safety.requirements-updated", "dev.architecture-updated"],
        emit: ["qa.tests-updated", "qa.verification-status"],
      },
    },
  };
  