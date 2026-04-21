/**
 * xHandle: agent task composer agent workspace.
 * This file is part of the agent-facing experience that lets xHandle coordinate engineering tasks, task state, and specialized panels around AI-assisted work.
 * The agent layer experiments with longer-running or role-oriented assistance while still keeping the rest of the application in control of project context and persisted artifacts.
 * Related files: src/agents/AgentRuntime.js, src/agents/AgentMonitor.js, src/components/agentController.js, src/features/agents/xAgent/XAgentCenter.jsx.
 */

import React, { useState } from "react";
import { createTask } from "../../../../agents/taskModel";

export default function AgentTaskComposer({ kind, onCreated }) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [dueAt, setDueAt] = useState("");

  const canCreate = title.trim().length > 0 && prompt.trim().length > 0;

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="grid sm:grid-cols-2 gap-2">
        <input
          className="border rounded px-2 py-1"
          placeholder="Task title (e.g., Generate STPA summary)"
          value={title}
          onChange={(e)=>setTitle(e.target.value)}
        />
        <div className="flex gap-2">
          <select className="border rounded px-2 py-1" value={priority} onChange={(e)=>setPriority(e.target.value)}>
            <option>Low</option><option>Normal</option><option>High</option>
          </select>
          <input
            className="border rounded px-2 py-1"
            type="datetime-local"
            value={dueAt}
            onChange={(e)=>setDueAt(e.target.value)}
          />
        </div>
      </div>
      <textarea
        className="w-full border rounded px-2 py-2 min-h-[96px]"
        placeholder="Describe what you want this agent to do… include any parameters or links."
        value={prompt}
        onChange={(e)=>setPrompt(e.target.value)}
      />
      <div className="flex justify-end">
        <button
          className={`px-3 py-2 text-sm rounded border ${canCreate ? "bg-white hover:bg-gray-50" : "opacity-50 cursor-not-allowed"}`}
          disabled={!canCreate}
          onClick={()=>{
            const task = createTask({
              kind,
              title: title.trim(),
              prompt: prompt.trim(),
              payload: { userPrompt: prompt.trim() },
              priority,
              dueAt: dueAt || null
            });
            setTitle(""); setPrompt(""); setPriority("Normal"); setDueAt("");
            onCreated?.(task);
          }}
        >
          Create Task
        </button>
      </div>
    </div>
  );
}
