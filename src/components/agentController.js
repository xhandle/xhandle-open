/**
 * xHandle: agent controller shared application component.
 * This file implements a reusable application-level component or helper that participates in xHandle's end-to-end engineering workflows.
 * Shared components connect the main workspace, diagrams, copilot features, reporting, and local persistence so individual features can cooperate as one system.
 * Related files: src/App.js, src/lib/storage/indexedDB.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

/**
 * runAgentTask executes one step of the workspace orchestration flow. This keeps the broader xHandle flow readable by isolating a named stage in the processing pipeline instead of mixing every transformation into one large procedure.
 * @param message Input consumed by this step of the xHandle workflow.
 * @param context Context object or text used to enrich this step.
 * @param setProgress React state setter supplied by the parent workflow.
 * @param appendMessage Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function runAgentTask(message, context, setProgress, appendMessage) {
    // Step 1: Plan
    const plan = await fetchLLMResponse({
      system: "You are an autonomous xHandle project assistant.",
      user: `Plan step-by-step how to accomplish this request: ${message}`
    });
  
    appendMessage({ role: "assistant", content: `📋 Plan:\n${plan}` });
    setProgress({ step: 1, total: 3 });
  
    // Step 2: Execute each step
    const steps = plan.split("\n").filter(Boolean);
    for (let i = 0; i < steps.length; i++) {
      const result = await executeStep(steps[i], context);
      appendMessage({ role: "assistant", content: `✅ ${steps[i]}\n${result}` });
      setProgress({ step: i + 2, total: steps.length + 2 });
    }
  
    // Step 3: Summarize
    const summary = await fetchLLMResponse({
      system: "Summarize work completed for user in concise bullet points.",
      user: JSON.stringify(steps)
    });
  
    appendMessage({ role: "assistant", content: `📌 Summary:\n${summary}` });
  }
  