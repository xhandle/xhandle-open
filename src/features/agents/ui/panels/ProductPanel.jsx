/**
 * xHandle: product panel agent workspace.
 * This file is part of the agent-facing experience that lets xHandle coordinate engineering tasks, task state, and specialized panels around AI-assisted work.
 * The agent layer experiments with longer-running or role-oriented assistance while still keeping the rest of the application in control of project context and persisted artifacts.
 * Related files: src/agents/AgentRuntime.js, src/agents/AgentMonitor.js, src/components/agentController.js, src/features/agents/xAgent/XAgentCenter.jsx.
 */

import React from "react";
import { capabilitySchema, AgentKinds } from "../../../../agents/capabilitySchema";
import { dispatchAgentAction } from "../../../../agents/AgentRuntime";
import AgentTaskComposer from "../common/AgentTaskComposer";
import AgentTaskList from "../common/AgentTaskList";

export default function ProductPanel({ performTask, activeProjectId }) {
  const caps = capabilitySchema[AgentKinds.PRODUCT];

  const runTask = async (task) => {
    // Minimal mapping: choose based on keywords in title/prompt
    const p = (task.prompt || "").toLowerCase();
    const type = p.includes("context") ? "product.publish-context" : "product.create-intent-brief";
    await dispatchAgentAction(AgentKinds.PRODUCT, type, { projectId: activeProjectId, userPrompt: task.payload?.userPrompt }, performTask);
  };

  return (
    <Section caps={caps}>
      <AgentTaskComposer kind={AgentKinds.PRODUCT} onCreated={()=>{}} />
      <AgentTaskList kind={AgentKinds.PRODUCT} onRun={runTask} />
    </Section>
  );
}

/**
 * Section renders a feature panel. It gives users access to agent-oriented task execution and monitoring while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param caps Input consumed by this step of the xHandle workflow.
 * @param children Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Section({ caps, children }) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">{caps.displayName}</h3>
      <Schema caps={caps} />
      {children}
    </div>
  );
}
/**
 * Schema renders a feature panel. It gives users access to agent-oriented task execution and monitoring while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param caps Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Schema({ caps }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3 text-sm">
      <KV k="Goals" v={caps.goals.join(" · ")} />
      <KV k="Tools" v={caps.tools.map(t=>t.name).join(", ")} />
      <KV k="Inputs" v={caps.inputs.join(", ")} />
      <KV k="Outputs" v={caps.outputs.join(", ")} />
      <KV k="Memory" v={`ST: ${caps.memory.shortTerm.join(", ")} | LT: ${caps.memory.longTerm.join(", ")}`} />
      <KV k="Actions" v={caps.actions.map(a=>a.type).join(", ")} />
    </div>
  );
}
/**
 * KV renders a feature panel. It gives users access to agent-oriented task execution and monitoring while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param k Input consumed by this step of the xHandle workflow.
 * @param v Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function KV({k,v}){return(<div><div className="text-gray-500">{k}</div><div>{v}</div></div>);}
