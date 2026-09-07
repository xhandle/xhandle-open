import React from "react";

function SourceLinks({ indexes = [], onOpenSourceRow }) {
  const values = Array.from(new Set(indexes.map(Number).filter(Number.isFinite))).sort((a, b) => a - b);
  if (!values.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {values.slice(0, 12).map((sourceIndex) => (
        <button
          key={sourceIndex}
          type="button"
          onClick={() => onOpenSourceRow?.(sourceIndex)}
          className="rounded bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
        >
          Source row {sourceIndex}
        </button>
      ))}
      {values.length > 12 && <span className="px-1 py-1 text-[11px] text-gray-500">+{values.length - 12} more</span>}
    </div>
  );
}

function ModelSection({ title, description, items = [], renderItem, onOpenSourceRow, tone = "blue" }) {
  const colors = tone === "amber"
    ? "border-amber-200 bg-amber-50/40"
    : tone === "rose"
      ? "border-rose-200 bg-rose-50/40"
      : "border-gray-200 bg-white";
  return (
    <section className={`rounded-xl border ${colors}`}>
      <div className="border-b border-inherit px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-gray-600">{items.length}</span>
        </div>
        {description && <p className="mt-1 text-xs text-gray-500">{description}</p>}
      </div>
      <div className="divide-y divide-gray-100">
        {items.length ? items.map((item) => (
          <article key={item.id} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="shrink-0 rounded bg-gray-100 px-2 py-1 font-mono text-[11px] font-semibold text-gray-700">{item.id}</span>
              <div className="min-w-0 flex-1 text-sm text-gray-800">{renderItem(item)}</div>
            </div>
            <SourceLinks indexes={item.sourceIndexes} onOpenSourceRow={onOpenSourceRow} />
          </article>
        )) : (
          <div className="px-4 py-5 text-sm text-gray-500">Not available yet. Regenerate consolidated safety issues to populate this section.</div>
        )}
      </div>
    </section>
  );
}

export default function HazardSafetyModelView({ model, onOpenSourceRow }) {
  if (!model) return null;
  return (
    <div className="h-[calc(100dvh-360px)] min-h-[320px] overflow-y-auto rounded-xl bg-[#F8FAFC] p-4">
      <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
        <div className="text-sm font-semibold text-blue-950">Normalized STPA safety model</div>
        <p className="mt-1 text-xs text-blue-800">
          Review canonical safety concepts here. The exhaustive {model.counts.rawRows} row analysis remains available under Analysis Detail and every concept links back to its evidence.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ModelSection title="Canonical Losses" description="Small, controlled set of unacceptable system-level outcomes." items={model.losses} onOpenSourceRow={onOpenSourceRow} renderItem={(item) => <><strong>{item.title}</strong>{item.description !== item.title && <p className="mt-1 text-xs text-gray-600">{item.description}</p>}</>} />
        <ModelSection title="Canonical Hazards" description="System-level hazardous states shared by many UCAs and contexts." items={model.hazards} onOpenSourceRow={onOpenSourceRow} renderItem={(item) => <><strong>{item.title}</strong>{item.description !== item.title && <p className="mt-1 text-xs text-gray-600">{item.description}</p>}</>} />
        <ModelSection title="Unsafe Control Actions" description="Contextual unsafe actions with type-aware guide-phrase semantics." items={model.unsafeControlActions} onOpenSourceRow={onOpenSourceRow} renderItem={(item) => <><div>{item.statement}</div><div className="mt-1 text-xs text-gray-500">{item.controlActionType} · {item.semanticDeviation}</div></>} />
        <ModelSection title="Causal Scenarios" description="Concrete causes categorized across control, sensing, actuation, interfaces, timing, power, lifecycle, and human factors." items={model.causalScenarios} onOpenSourceRow={onOpenSourceRow} renderItem={(item) => <><div>{item.description}</div><div className="mt-1 text-xs font-medium text-gray-500">{item.category}</div></>} />
        <ModelSection title="Safety Constraints" description="Reviewable design obligations kept separate from causes and mitigations." items={model.safetyConstraints} onOpenSourceRow={onOpenSourceRow} renderItem={(item) => <><div>{item.statement}</div>{item.verification && <div className="mt-1 text-xs text-gray-600"><strong>Verification:</strong> {item.verification}</div>}{item.parameterSource && <div className="mt-1 text-xs text-gray-500">Parameter source: {item.parameterSource}</div>}</>} />
        <ModelSection title="Architecture Assumptions" description="Operational-context invariants used to check availability and architectural consistency." items={model.architectureAssumptions} onOpenSourceRow={onOpenSourceRow} renderItem={(item) => item.statement} tone="amber" />
      </div>
      <div className="mt-4">
        <ModelSection title="End-to-End Traceability" description="Canonical Loss → Hazard → UCA → Causal Scenario → Safety Constraint paths, grouped by actionable safety issue." items={model.traceability} onOpenSourceRow={onOpenSourceRow} renderItem={(item) => <><strong>{item.title}</strong><div className="mt-1 break-words font-mono text-[11px] text-gray-600">{[
          item.lossIds.join(", ") || "L-TBD",
          item.hazardIds.join(", ") || "H-TBD",
          item.unsafeControlActionIds.join(", ") || "UCA-TBD",
          item.causalScenarioIds.join(", ") || "CS-TBD",
          item.safetyConstraintIds.join(", ") || "SC-TBD",
        ].join(" → ")}</div></>} />
      </div>
      <div className="mt-4">
        <ModelSection title="Quality Findings" description="Non-blocking review findings. These never hide the generated raw analysis." items={model.qualityFindings} onOpenSourceRow={onOpenSourceRow} renderItem={(item) => item.message} tone="rose" />
      </div>
    </div>
  );
}
