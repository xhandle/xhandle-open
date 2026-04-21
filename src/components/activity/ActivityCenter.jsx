/**
 * xHandle: activity center activity center.
 * This file implements the shared activity-center experience used to surface background actions, progress signals, and user-visible workflow events.
 * The activity layer gives large AI-assisted workflows a place to report progress without overloading the main modeling surfaces.
 * Related files: src/App.js, src/components/XHandleCopilotView.jsx, src/features/agents/xAgent/XAgentCenter.jsx.
 */

import React, { createContext, useContext, useMemo, useState, useCallback } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

const ActivityContext = createContext(null);

/**
 * ActivityProvider renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param children Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
export function ActivityProvider({ children }) {
  const [activities, setActivities] = useState(new Map()); // id -> {title, status, step, total, message, createdAt}

  const startActivity = useCallback((id, payload) => {
    setActivities(prev => {
      const next = new Map(prev);
      next.set(id, {
        title: payload.title || "Working…",
        status: "running", // running | success | error | canceled
        step: payload.step ?? 0,
        total: payload.total ?? 0,
        message: payload.message || "",
        createdAt: Date.now()
      });
      return next;
    });
  }, []);

  const updateActivity = useCallback((id, patch) => {
    setActivities(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      const current = next.get(id);
      next.set(id, { ...current, ...patch });
      return next;
    });
  }, []);

  const finishActivity = useCallback((id, status = "success", message = "") => {
    setActivities(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      const current = next.get(id);
      next.set(id, { ...current, status, message });
      // linger a bit longer so users can see the result
      setTimeout(() => {
        setActivities(later => {
          const n2 = new Map(later);
          n2.delete(id);
          return n2;
        });
      }, 4000); // was 2500
      return next;
    });
  }, []);

  const cancelActivity = useCallback((id) => finishActivity(id, "canceled"), [finishActivity]);

  const value = useMemo(() => ({
    activities,
    startActivity,
    updateActivity,
    finishActivity,
    cancelActivity
  }), [activities, startActivity, updateActivity, finishActivity, cancelActivity]);

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

/**
 * useActivityCenter renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
export function useActivityCenter() {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error("useActivityCenter must be used within <ActivityProvider />");
  return ctx;
}

/**
 * ProgressBar renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param step Input consumed by this step of the xHandle workflow.
 * @param total Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function ProgressBar({ step, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((step / total) * 100)) : 0;
  return (
    <div className="w-full h-1.5 bg-neutral-200 rounded">
      <div className="h-1.5 bg-[#2D7DFE] rounded" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * ActivitiesButton renders a interactive button surface. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
export function ActivitiesButton() {
  const { activities } = useActivityCenter();
  const running = Array.from(activities.values()).some(a => a.status === "running");
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border bg-white hover:bg-neutral-50"
        title="Activities"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="activities-dropdown"
      >
        <span className="relative flex h-2.5 w-2.5">
          {running ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2D7DFE] opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#2D7DFE]"></span>
            </>
          ) : (
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-neutral-300"></span>
          )}
        </span>
        <span className="font-medium">Activities</span>
        <ChevronDown className={`w-4 h-4 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          id="activities-dropdown"
          className="absolute right-0 mt-2 w-96 max-w-[90vw] rounded-xl border bg-white shadow-xl p-2 z-50"
          role="status"
          aria-live="polite"
        >
          {activities.size === 0 ? (
            <div className="p-3 text-sm text-neutral-500">No active activities.</div>
          ) : (
            Array.from(activities.entries())
              .sort((a, b) => b[1].createdAt - a[1].createdAt)
              .map(([id, a]) => {
                const pct = a.status === "running" && a.total > 0
                  ? Math.min(100, Math.round((a.step / a.total) * 100))
                  : null;
                return (
                  <div key={id} className="p-3 rounded-lg hover:bg-neutral-50">
                    <div className="flex items-center gap-2">
                      {a.status === "running" && <Loader2 className="w-4 h-4 animate-spin text-neutral-500" />}
                      <div className="font-medium text-sm">{a.title}</div>
                      <div className="ml-auto text-xs text-neutral-500 capitalize">
                        {a.status}{pct != null ? ` · ${pct}%` : ""}
                      </div>
                    </div>
                    {a.message && <div className="mt-1 text-xs text-neutral-600">{a.message}</div>}
                    {a.status === "running" && (
                      <div className="mt-2"><ProgressBar step={a.step} total={a.total} /></div>
                    )}
                  </div>
                );
              })
          )}
        </div>
      )}
    </div>
  );
}
