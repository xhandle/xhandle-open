import './naturalLanguageLayout.css';
import { deleteEngineeringProject, moveDesignArtifact, moveFolderIntoEngineeringProject } from './artifacts/engineeringProjectRepository';
import { deleteArtifact, updateDocumentDetails } from './artifacts/artifactRepository';
import { pauseGenerationRun } from './artifacts/generationRuns';
import EngineeringProjectDialog from './artifacts/EngineeringProjectDialog';
import EngineeringProjectEditor from './artifacts/EngineeringProjectEditor';
import { ENGINEERING_PROJECT_TYPE } from './artifacts/engineeringProjectModel';
import React from "react";
import { ArtifactCreateDialog, ArtifactEditor, useArtifactWorkspace } from './artifacts/ArtifactWorkspace';
import RequirementsManager from "../../components/RequirementsManager";
import NaturalLanguageDesignPanel from "./NaturalLanguageDesignPanel";
import SysMLV2ModelerView from "./SysMLV2Modeler/SysMLV2ModelerView";
import { DESIGN_SEARCH_REVEAL, useDesignQuickSearch } from './designQuickSearch';
import { useDesignCollaborator } from './collaborator/useDesignCollaborator';
import TraceabilityProfilesDialog from './traceability/TraceabilityProfilesDialog';
import TraceabilityMatrix from './traceability/TraceabilityMatrix';

export default function DesignManagementView({
  requirements,
  setRequirements,
  onApplyWorkflowArtifacts,
}) {
  const artifacts = useArtifactWorkspace();
  const { select: selectArtifact, setFocusObjectId, setShowCreate: setShowArtifactCreate } = artifacts;
  const rootRef = React.useRef(null);
  const [searchTarget, setSearchTarget] = React.useState(null);
  const [activeDesignContext, setActiveDesignContext] = React.useState(null);
  const [generationFolderId, setGenerationFolderId] = React.useState(null);
  const [showProfiles, setShowProfiles] = React.useState(false);
  const [matrixProject, setMatrixProject] = React.useState(null);
  React.useEffect(() => { const create = event => { setMatrixProject(event.detail); setGenerationFolderId(event.detail.folderId); setShowArtifactCreate(true); }; window.addEventListener('xhandle:create-traceability-matrix', create); return () => window.removeEventListener('xhandle:create-traceability-matrix', create); }, [setShowArtifactCreate]);
  const openProjectGeneration = (folderId = activeDesignContext?.activeFolderId) => {
    setGenerationFolderId(folderId);
    artifacts.setShowProjectCreate(true);
  };
  const openArtifactGeneration = (folderId = activeDesignContext?.activeFolderId) => {
    setMatrixProject(null);
    setGenerationFolderId(folderId);
    artifacts.setShowCreate(true);
  };
  const [sysmlGenerationRequest, setSysmlGenerationRequest] = React.useState(0);
  const workspaceProjectName = "Local Workspace";
  const [mode, setMode] = React.useState(() => {
    try { return sessionStorage.getItem("xhandle.designManagement.mode") || "natural"; } catch { return "natural"; }
  });
  const openSearchArtifact = React.useCallback((id, objectId, draft = false) => {
    setMode('natural');
    setSearchTarget({ objectId, draft, nonce: Date.now() });
    setFocusObjectId(objectId || null); selectArtifact(id);
  }, [setFocusObjectId, selectArtifact]);
  const openSearchLibrary = React.useCallback(detail => {
    setMode('natural'); setSearchTarget(null); selectArtifact(null);
    // RequirementsManager may mount when leaving SysML. Deliver after commit.
    setTimeout(() => window.dispatchEvent(new CustomEvent(DESIGN_SEARCH_REVEAL, { detail })), 0);
  }, [selectArtifact]);
  useDesignQuickSearch({ rootRef, modules: artifacts.modules, onOpenArtifact: openSearchArtifact, onOpenLibrary: openSearchLibrary });
  useDesignCollaborator({ mode, selectedId: artifacts.selectedId, modules: artifacts.modules, openArtifact: openSearchArtifact, openLibrary: openSearchLibrary, setMode });

  React.useEffect(() => {
    try { sessionStorage.setItem("xhandle.designManagement.mode", mode); } catch {}
  }, [mode]);

  const segmented = (
    <div className="inline-flex rounded-lg border bg-white p-1 text-sm">
      <button className={`rounded-md px-3 py-1.5 font-medium ${mode === "natural" ? "bg-indigo-600 text-white" : "text-gray-700 hover:bg-gray-50"}`} onClick={() => setMode("natural")}>
        Natural Language Design
      </button>
      <button className={`rounded-md px-3 py-1.5 font-medium ${mode === "sysml" ? "bg-indigo-600 text-white" : "text-gray-700 hover:bg-gray-50"}`} onClick={() => setMode("sysml")}>
        SysML v2 Modeler
      </button>
    </div>
  );

  return (
    <div ref={rootRef} className={`design-management-workspace flex flex-col flex-1 min-h-0 min-w-0 bg-white w-full ${mode === "natural" ? "overflow-hidden" : "overflow-auto"}`}>
      <h1 className="sr-only">Design Management</h1>
      {mode !== 'natural' && <div className="shrink-0 flex justify-end p-2">{segmented}</div>}

      {mode === "natural" ? (
        <NaturalLanguageDesignPanel
          modeControls={segmented}
          activeDesignContext={activeDesignContext}
          onGenerateArtifact={() => openArtifactGeneration()}
          onGenerateProject={() => openProjectGeneration()}
          onTraceabilityProfiles={() => setShowProfiles(true)}
          onGenerateSysML={() => {
            setMode("sysml");
            setSysmlGenerationRequest((value) => value + 1);
          }}
          onAnalyzeGaps={() => setMode("sysml")}
        >
          <RequirementsManager
            key="workspace"
            artifactModules={artifacts.modules}
            onGenerateProject={openProjectGeneration}
            onGenerateArtifact={openArtifactGeneration}
            onUpdateArtifactDetails={(item, details) => updateDocumentDetails(item.id, item.detailsVersion || 0, details)}
            onDeleteArtifact={async item => {
              pauseGenerationRun(`artifact:${item.id}`);
              if (item.programId) pauseGenerationRun(`project:${item.programId}`);
              if (item.recordType === ENGINEERING_PROJECT_TYPE) {
                pauseGenerationRun(`project:${item.id}`);
                for (const member of item.members || []) pauseGenerationRun(`artifact:${member.id}`);
                await deleteEngineeringProject(item.id);
              } else await deleteArtifact(item.id);
            }}
            onMoveArtifact={moveDesignArtifact}
            onMoveDesignFolder={moveFolderIntoEngineeringProject}
            activeArtifactId={artifacts.selectedId}
            onSelectArtifact={id => { setSearchTarget(null); artifacts.setFocusObjectId(null); artifacts.select(id); }}
            renderArtifact={() => !artifacts.modules.some(module => module.id === artifacts.selectedId) ? <p>Loading design module…</p> : artifacts.modules.find(module => module.id === artifacts.selectedId)?.recordType === ENGINEERING_PROJECT_TYPE
              ? <EngineeringProjectEditor key={artifacts.selectedId} id={artifacts.selectedId} onDeleted={() => artifacts.select(null)} onOpenArtifact={(id, objectId) => { artifacts.setFocusObjectId(objectId || null); artifacts.select(id); }} />
              : artifacts.modules.find(module => module.id === artifacts.selectedId)?.templateId === 'traceability-matrix'
                ? <TraceabilityMatrix key={`${artifacts.selectedId}:${searchTarget?.nonce || ''}`} id={artifacts.selectedId} focusObjectId={artifacts.focusObjectId} onDeleted={() => artifacts.select(null)} onOpenArtifact={openSearchArtifact} />
                : <ArtifactEditor key={`${artifacts.selectedId}:${searchTarget?.nonce || ''}`} id={artifacts.selectedId} focusDraft={searchTarget?.draft} focusObjectId={artifacts.focusObjectId} onOpenProject={artifacts.select} onDeleted={() => artifacts.select(null)} />}
            projectName={workspaceProjectName}
            requirements={requirements}
            setRequirements={setRequirements}
            onActiveDesignContextChange={setActiveDesignContext}
          />
          {artifacts.error && <p role="alert">{artifacts.error}</p>}
          {artifacts.showProjectCreate && <EngineeringProjectDialog libraryProjects={artifacts.modules.filter(module => module.recordType === ENGINEERING_PROJECT_TYPE)} activeFolderId={generationFolderId} onClose={() => artifacts.setShowProjectCreate(false)} onCreated={artifacts.select} />}
          {artifacts.showCreate && <ArtifactCreateDialog matrixProject={matrixProject} libraryProjects={artifacts.modules.filter(module => module.recordType === ENGINEERING_PROJECT_TYPE)} activeFolderId={generationFolderId} onClose={() => artifacts.setShowCreate(false)} onCreated={artifacts.select} />}
          {showProfiles && <TraceabilityProfilesDialog onClose={() => setShowProfiles(false)} />}
        </NaturalLanguageDesignPanel>
      ) : (
        <SysMLV2ModelerView
          projectId={null}
          projectName={workspaceProjectName}
          autoGenerateRequest={sysmlGenerationRequest}
          designContext={{ projectId: null, projectName: workspaceProjectName, requirements, activeDesign: activeDesignContext }}
          onGenerateRequirements={(rows, requirementsModuleName) => {
            onApplyWorkflowArtifacts?.({
              artifacts: { requirementsRows: rows },
              mode: "append",
              source: "SysML v2 Modeler",
              requirementsModuleName,
            });
            setMode("natural");
          }}
        />
      )}
    </div>
  );
}
