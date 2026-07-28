import React from "react";

export default function CodeReferenceList({ references = [] }) {
  if (!references.length) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 p-3 text-sm text-slate-500">
        No linked code references were found for this finding. Select a generated architecture row with source file evidence, or rerun code-based architecture analysis with repository indexing enabled.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {references.map((ref, index) => (
        <div key={`${ref.filePath || "ref"}-${index}`} className="rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-slate-800">{ref.symbolName || ref.filePath || "Code reference"}</div>
            {ref.symbolType === "file" && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                File-level
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-xs text-slate-500" title={ref.filePath}>{ref.filePath || "Unknown file"}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
            {ref.startLine && <span>Lines {ref.startLine}-{ref.endLine || ref.startLine}</span>}
            {ref.symbolType && <span>{ref.symbolType === "file" ? "File reference" : ref.symbolType}</span>}
            {ref.branch && <span>Branch {ref.branch}</span>}
            {ref.confidence != null && <span>Confidence {Math.round(Number(ref.confidence) * 100)}%</span>}
          </div>
          {ref.rationale && <p className="mt-2 text-xs text-slate-600">{ref.rationale}</p>}
        </div>
      ))}
    </div>
  );
}
