import React from "react";

export default function NaturalLanguageDesignPanel({ children, activeDesignContext, onGenerateSysML, onAnalyzeGaps }) {
  const rowCount = activeDesignContext?.rows?.length || 0;
  const sourceLabel = [
    activeDesignContext?.activeFolderName,
    activeDesignContext?.selectedModule,
  ].filter(Boolean).join(" / ");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2">
        <div>
          <div className="text-sm font-semibold text-gray-900">Natural Language Design</div>
          <div className="text-xs text-gray-500">Use the existing Design Management module system for specifications, requirements, and narrative artifacts.</div>
          {sourceLabel ? (
            <div className="mt-1 text-xs text-indigo-700">
              SysML source: <span className="font-medium">{sourceLabel}</span> · {rowCount} visible rows
            </div>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button className="rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50" onClick={onGenerateSysML}>Generate SysML v2 Model</button>
          <button className="rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50" onClick={onAnalyzeGaps}>Analyze Model Gaps</button>
        </div>
      </div>
      {children}
    </div>
  );
}
