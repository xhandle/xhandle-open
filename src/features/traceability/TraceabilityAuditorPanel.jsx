/**
 * xHandle: traceability auditor panel traceability and V&V workflow.
 * This file belongs to xHandle's traceability and verification layer, where requirements, evidence, tests, and audit views are correlated into navigable engineering artifacts.
 * The traceability feature closes the loop between hazards, mitigations, requirements, and verification activities so downstream plans and reports stay connected to the modeled system.
 * Related files: src/components/RequirementsManager.jsx, src/lib/storage/requirementsStore.ts, src/features/traceability/utils/aiPlanGen.js, src/features/traceability/utils/aiTestGen.js.
 */

// components/TraceabilityAuditorPanel.jsx
import React, { useState } from "react";
import { ShieldCheck, Play, RefreshCcw, CheckCircle2, XCircle } from "lucide-react";
import { runTraceabilityAgent } from "./TraceabilityAgent";

export default function TraceabilityAuditorPanel({
  requirements,
  functions,
  hazardsSummaryRows,
  onRunPatches, // async (patches) => void  // you wire this to your store
}) {
  const [running, setRunning] = useState(false);
  const [iterLog, setIterLog] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [suggestions, setSuggestions] = useState([]);

  const handleRun = async () => {
    setRunning(true);
    setIterLog([]);
    setSuggestions([]);
    try {
      const result = await runTraceabilityAgent({
        requirements,
        functions,
        hazardsSummaryRows,
        maxIterations: 3,
        onUpdate: (msg) => setIterLog(prev => [...prev, msg]),
        dryRun: true,
        targetCoverage: { reqCoveredPct: 100, hazardMitigatedPct: 100, mitigationVerifiedPct: 80, functionCoveredPct: 80 },
      });
      setCoverage(result.coverage);
      setSuggestions(result.suggestions || result.patches || []);
    } finally {
      setRunning(false);
    }
  };

  const handleApply = async () => {
    if (!suggestions.length) return;
    await onRunPatches(suggestions); // caller persists (create/update/link)
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-indigo-600" />
          <h2 className="text-sm font-semibold">Traceability Auditor</h2>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRun}
            disabled={running}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
          >
            <Play className="h-4 w-4" /> Run Agent
          </button>
          <button
            onClick={() => { setIterLog([]); setSuggestions([]); setCoverage(null); }}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50"
          >
            <RefreshCcw className="h-4 w-4" /> Reset
          </button>
        </div>
      </header>

      {coverage && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Meter label="Req→Hazard" value={coverage.reqCoveredPct} />
          <Meter label="Hazard→Mitigation" value={coverage.hazardMitigatedPct} />
          <Meter label="Mitigation→Test" value={coverage.mitigationVerifiedPct} />
          <Meter label="Function→Req" value={coverage.functionCoveredPct} />
        </div>
      )}

      <section className="rounded-xl border p-3">
        <h3 className="text-xs font-semibold mb-2">Agent Log</h3>
        <div className="max-h-48 overflow-auto text-xs space-y-1">
          {iterLog.map((m, i) => (
            <div key={i} className="font-mono">
              <span className="text-gray-500">{m.stage}</span> #{m.iter ?? "-"} → {m.coverage ? JSON.stringify(m.coverage) : ""}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold">Suggestions</h3>
          <button
            onClick={handleApply}
            disabled={!suggestions.length}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" /> Apply Selected
          </button>
        </div>

        {!suggestions.length ? (
          <p className="text-xs text-gray-500">No suggestions yet. Run the agent.</p>
        ) : (
          <ul className="space-y-2">
            {suggestions.map((s, i) => (
              <li key={i} className="rounded border p-2 text-xs">
                <div className="flex items-center justify-between">
                  <code className="text-[11px]">{s.type}</code>
                  <span className="text-gray-500">conf: {(s.confidence ?? 0).toFixed(2)}</span>
                </div>
                <div className="mt-1">
                  {s.type === "link" && (
                    <div><b>link</b> {s.fromId} → {s.toId} <span className="text-gray-500">({s.linkType})</span></div>
                  )}
                  {s.type === "create" && (
                    <div><b>create</b> [{s.module}] “{s.title}”</div>
                  )}
                  {s.type === "update" && (
                    <div><b>update</b> {s.id} → “{s.title}”</div>
                  )}
                  {s.rationale && <div className="text-gray-600 mt-1">why: {s.rationale}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Meter renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param label Input consumed by this step of the xHandle workflow.
 * @param value Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Meter({ label, value }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-[11px] text-gray-600">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-lg font-semibold">{value}%</div>
        {value >= 90 ? (
          <CheckCircle2 className="h-4 w-4 text-green-600" />
        ) : (
          <XCircle className="h-4 w-4 text-gray-400" />
        )}
      </div>
      <div className="mt-2 h-1.5 w-full rounded bg-gray-100">
        <div className="h-1.5 rounded bg-indigo-600" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}
