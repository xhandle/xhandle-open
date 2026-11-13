import React from "react";

export default function NaturalLanguageDesignPanel({ children, modeControls, activeDesignContext, onGenerateSysML, onAnalyzeGaps, onGenerateArtifact, onGenerateProject }) {
  const rowCount = activeDesignContext?.rows?.length || 0;
  const sourceLabel = [
    activeDesignContext?.activeFolderName,
    activeDesignContext?.selectedModule,
  ].filter(Boolean).join(" / ");

  return (
    <div className="natural-language-design">
      <div className="design-toolbar" aria-label="Natural Language Design controls">
        {modeControls || <strong className="text-sm">Natural Language Design</strong>}
        <div className="design-toolbar-actions">
          <button className="rounded border border-indigo-600 text-indigo-700 px-3 py-1.5 text-xs font-medium" onClick={onGenerateProject}>Generate systems engineering project</button>
          <button className="rounded bg-indigo-600 text-white px-3 py-1.5 text-xs font-medium" onClick={onGenerateArtifact}>Generate engineering artifact</button>
          <button className="rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50" title={sourceLabel ? `SysML source: ${sourceLabel} · ${rowCount} visible rows` : undefined} onClick={onGenerateSysML}>Generate SysML v2 Model</button>
          <button className="rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50" onClick={onAnalyzeGaps}>Analyze Model Gaps</button>
        </div>
      </div>
      {children}
    </div>
  );
}
