const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

const providerNeutralWorkflows = [
  "src/components/XHandleCopilotView.jsx",
  "src/components/PromptWizard.js",
  "src/components/ConversationalWizard.jsx",
  "src/components/aiAnalysisSTPA.js",
  "src/components/aiAnalysisFMEA.js",
  "src/components/aiAnalysisWhatIf.js",
  "src/components/generateAgenticReport.js",
  "src/features/project-hazard-analysis/hazardOperationalContextAi.js",
  "src/features/safety-case/safetyCaseAI.js",
  "src/features/safety-case/safetyCaseEvidenceRecommendations.js",
  "src/features/safety-remediation/safetyRemediationAi.js",
];

test("major text-generation workflows use the provider-neutral chat endpoint and auth", () => {
  providerNeutralWorkflows.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.match(source, /\/api\/chat/, relativePath + " must use /api/chat");
    assert.match(source, /buildAIAuthOpts/, relativePath + " must forward the selected provider");
    assert.doesNotMatch(source, /\/api\/openai/i, relativePath + " must not force OpenAI");
  });
});
