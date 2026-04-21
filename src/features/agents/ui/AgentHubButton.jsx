/**
 * xHandle: agent hub button agent workspace.
 * This file is part of the agent-facing experience that lets xHandle coordinate engineering tasks, task state, and specialized panels around AI-assisted work.
 * The agent layer experiments with longer-running or role-oriented assistance while still keeping the rest of the application in control of project context and persisted artifacts.
 * Related files: src/agents/AgentRuntime.js, src/agents/AgentMonitor.js, src/components/agentController.js, src/features/agents/xAgent/XAgentCenter.jsx.
 */

import React from "react";

export default function AgentHubButton({ onOpen }) {
  return (
    <button
      className="px-3 py-2 text-sm rounded border bg-white hover:bg-gray-50"
      title="Open Agents Console"
      onClick={onOpen}
    >
      Agents
    </button>
  );
}
