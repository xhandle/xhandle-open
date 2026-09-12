import React, { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader2 } from "lucide-react";

const ActivityContext = createContext(null);

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

export function useActivityCenter() {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error("useActivityCenter must be used within <ActivityProvider />");
  return ctx;
}

function ProgressBar({ step, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((step / total) * 100)) : 0;
  return (
    <div className="w-full h-1.5 bg-neutral-200 rounded">
      <div className="h-1.5 bg-[#2D7DFE] rounded" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ActivitiesButton() {
  const { activities } = useActivityCenter();
  const running = Array.from(activities.values()).some(a => a.status === "running");
  const [open, setOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, right: 8 });
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);

  const positionDropdown = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect?.();
    if (!rect || typeof window === "undefined") return;
    setDropdownPosition({
      top: Math.round(rect.bottom + 8),
      right: Math.max(8, Math.round(window.innerWidth - rect.right)),
    });
  }, []);

  useEffect(() => {
    if (!open || typeof window === "undefined") return undefined;
    positionDropdown();
    const handlePointerDown = (event) => {
      if (buttonRef.current?.contains(event.target) || dropdownRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus?.();
      }
    };
    window.addEventListener("resize", positionDropdown);
    window.addEventListener("scroll", positionDropdown, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", positionDropdown);
      window.removeEventListener("scroll", positionDropdown, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, positionDropdown]);

  const dropdown = open && typeof document !== "undefined" ? createPortal(
    <div
      ref={dropdownRef}
      id="activities-dropdown"
      className="fixed z-[2147483000] w-96 max-w-[90vw] rounded-xl border bg-white p-2 shadow-xl"
      style={dropdownPosition}
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
                  <div className="font-medium text-sm min-w-0 break-words [overflow-wrap:anywhere]">{a.title}</div>
                  <div className="ml-auto text-xs text-neutral-500 capitalize">
                    {a.status}{pct != null ? ` · ${pct}%` : ""}
                  </div>
                </div>
                {a.message && (
                  <div className="mt-1 whitespace-normal break-words text-xs text-neutral-600 [overflow-wrap:anywhere]">
                    {a.message}
                  </div>
                )}
                {a.status === "running" && (
                  <div className="mt-2"><ProgressBar step={a.step} total={a.total} /></div>
                )}
              </div>
            );
          })
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
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

      {dropdown}
    </div>
  );
}
