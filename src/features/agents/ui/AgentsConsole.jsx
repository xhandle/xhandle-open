/**
 * xHandle: agents console agent workspace.
 * This file is part of the agent-facing experience that lets xHandle coordinate engineering tasks, task state, and specialized panels around AI-assisted work.
 * The agent layer experiments with longer-running or role-oriented assistance while still keeping the rest of the application in control of project context and persisted artifacts.
 * Related files: src/agents/AgentRuntime.js, src/agents/AgentMonitor.js, src/components/agentController.js, src/features/agents/xAgent/XAgentCenter.jsx.
 */

import React, { useState, useEffect } from "react";
import { capabilitySchema, AgentKinds } from "../../../agents/capabilitySchema";
import ProductPanel from "./panels/ProductPanel";
import DevPanel from "./panels/DevPanel";
import SafetyPanel from "./panels/SafetyPanel";
import VnVPanel from "./panels/VnVPanel";

export default function AgentsConsole({
  isOpen, onClose, performTask, activeProjectId,
}) {
  const [tab, setTab] = useState(AgentKinds.SAFETY);
  const caps = capabilitySchema;

  useEffect(() => {
    function onAlert(e){ /* could show toast */ }
    window.addEventListener("agent:alert", onAlert);
    return () => window.removeEventListener("agent:alert", onAlert);
  }, []);

  if (!isOpen) return null;

  const common = { performTask, activeProjectId };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center">
      <div className="bg-white w-[960px] max-w-[95vw] max-h-[90vh] rounded-2xl shadow-xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            {Object.keys(caps).map((k) => (
              <button
                key={k}
                className={`px-3 py-2 text-sm rounded ${tab===k ? "bg-gray-900 text-white" : "border bg-white"}`}
                onClick={() => setTab(k)}
              >
                {caps[k].displayName}
              </button>
            ))}
          </div>
          <button className="px-3 py-2 text-sm rounded border" onClick={onClose}>Close</button>
        </div>

        <div className="p-4 overflow-auto flex-1">
          {tab === AgentKinds.PRODUCT && <ProductPanel {...common} />}
          {tab === AgentKinds.DEV && <DevPanel {...common} />}
          {tab === AgentKinds.SAFETY && <SafetyPanel {...common} />}
          {tab === AgentKinds.VNV && <VnVPanel {...common} />}
          </div>

        <div className="p-3 border-t text-xs text-gray-500">
          Realtime monitoring enabled · Heartbeats via WS/polling · Traceable actions logged
        </div>
      </div>
    </div>
  );
}
