/**
 * xHandle: agent task list agent workspace.
 * This file is part of the agent-facing experience that lets xHandle coordinate engineering tasks, task state, and specialized panels around AI-assisted work.
 * The agent layer experiments with longer-running or role-oriented assistance while still keeping the rest of the application in control of project context and persisted artifacts.
 * Related files: src/agents/AgentRuntime.js, src/agents/AgentMonitor.js, src/components/agentController.js, src/features/agents/xAgent/XAgentCenter.jsx.
 */

import React from "react";
import { listTasks, updateTask, deleteTask } from "../../../../agents/taskModel";

export default function AgentTaskList({ kind, onRun }) {
  const [, refresh] = React.useReducer((v) => v + 1, 0);
  const tasks = listTasks(kind);

  return (
    <div className="rounded-lg border divide-y">
      {tasks.length === 0 ? (
        <div className="p-3 text-sm text-gray-500">No tasks yet. Create one above.</div>
      ) : tasks.map(t => (
        <div key={t.id} className="p-3 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="font-medium">{t.title}</div>
            <div className="flex items-center gap-2">
              <span className="text-xs rounded px-2 py-1 border">{t.priority}</span>
              <span className="text-xs rounded px-2 py-1 border">{t.status}</span>
            </div>
          </div>
          <div className="text-sm text-gray-600 break-words">{t.prompt}</div>
          <div className="flex items-center gap-2 pt-1">
            <button className="px-2 py-1 text-xs rounded border" onClick={async ()=>{
              updateTask(t.id, { status: "Running" });
              refresh();
              try {
                await onRun?.(t);
                updateTask(t.id, { status: "Done" });
              } catch (e) {
                updateTask(t.id, { status: "Error", error: String(e) });
              } finally { refresh(); }
            }}>Run</button>
            <button className="px-2 py-1 text-xs rounded border" onClick={() => { updateTask(t.id, { status: "Done" }); refresh(); }}>Mark Done</button>
            <button className="px-2 py-1 text-xs rounded border" onClick={() => { deleteTask(t.id); refresh(); }}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
