import React from "react";
import DesignActionGroup from './artifacts/DesignActionGroup';
import ArtifactActionsPopover from './artifacts/ArtifactActionsPopover';
import { DesignActionsProvider, useDesignActions } from './DesignActionsContext';

function DesignActionsOutlet() {
  const shared = useDesignActions();
  return <div className="design-toolbar-actions" ref={shared.setHost}>
    {!shared.owner && <ArtifactActionsPopover compact label="Design Management actions">{shared.workspaceActions}</ArtifactActionsPopover>}
  </div>;
}

export default function NaturalLanguageDesignPanel({ children, modeControls, activeDesignContext, onGenerateSysML, onAnalyzeGaps, onGenerateArtifact, onGenerateProject, onTraceabilityProfiles }) {
  const rowCount = activeDesignContext?.rows?.length || 0;
  const sourceLabel = [
    activeDesignContext?.activeFolderName,
    activeDesignContext?.selectedModule,
  ].filter(Boolean).join(" / ");

  const workspaceActions = close => <>
    <DesignActionGroup label="Create">
      <button onClick={() => { close(); onGenerateProject?.(); }}>Generate systems engineering project</button>
      <button onClick={() => { close(); onGenerateArtifact?.(); }}>Generate engineering artifact</button>
    </DesignActionGroup>
    <DesignActionGroup label="Design tools">
      <button onClick={() => { close(); onTraceabilityProfiles?.(); }}>Traceability profiles</button>
      <button title={sourceLabel ? `SysML source: ${sourceLabel} · ${rowCount} visible rows` : undefined} onClick={() => { close(); onGenerateSysML?.(); }}>Generate SysML v2 Model</button>
      <button onClick={() => { close(); onAnalyzeGaps?.(); }}>Analyze Model Gaps</button>
    </DesignActionGroup>
  </>;
  return (
    <DesignActionsProvider workspaceActions={workspaceActions}>
    <div className="natural-language-design">
      <div className="design-toolbar" aria-label="Natural Language Design controls">
        {modeControls || <strong className="text-sm">Natural Language Design</strong>}
        <DesignActionsOutlet />
      </div>
      {children}
    </div>
    </DesignActionsProvider>
  );
}
