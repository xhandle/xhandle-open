import React from "react";
import { X } from "lucide-react";
import SafetyRemediationPanel from "./SafetyRemediationPanel";

export default function SafetyRemediationDrawer({ isOpen, onClose, ...panelProps }) {
  return (
    <div
      className={`fixed bottom-0 right-0 top-14 z-[79] flex pointer-events-none transition-transform duration-200 ease-out ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
      aria-hidden={!isOpen}
    >
      <div
        className="pointer-events-auto flex h-full flex-col border-l border-slate-200 bg-white shadow-2xl"
        style={{ width: "var(--safety-remediation-drawer-width)" }}
        aria-label="Safety Remediation"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Safety Remediation</h2>
            <p className="text-xs text-slate-500">Local-first patch proposals for human review</p>
          </div>
          <button type="button" className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <SafetyRemediationPanel {...panelProps} compact />
        </div>
      </div>
    </div>
  );
}
