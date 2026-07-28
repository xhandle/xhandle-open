import React from "react";
import RequirementsManager from "../../components/RequirementsManager";
import NaturalLanguageDesignPanel from "./NaturalLanguageDesignPanel";
import SysMLV2ModelerView from "./SysMLV2Modeler/SysMLV2ModelerView";

export default function DesignManagementView({
  requirements,
  setRequirements,
  onApplyWorkflowArtifacts,
}) {
  const [activeDesignContext, setActiveDesignContext] = React.useState(null);
  const [sysmlGenerationRequest, setSysmlGenerationRequest] = React.useState(0);
  const workspaceProjectName = "Local Workspace";
  const [mode, setMode] = React.useState(() => {
    try { return sessionStorage.getItem("xhandle.designManagement.mode") || "natural"; } catch { return "natural"; }
  });

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
    <div className="flex flex-col flex-1 min-h-0 overflow-auto bg-white py-0 px-3 md:px-5 lg:px-7 w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Design Management</h1>
          <p className="text-gray-500 text-sm">
            Manage natural-language design artifacts and formal SysML v2-style MBSE models in one local-first workspace.
          </p>
        </div>
        {segmented}
      </div>

      {mode === "natural" ? (
        <NaturalLanguageDesignPanel
          activeDesignContext={activeDesignContext}
          onGenerateSysML={() => {
            setMode("sysml");
            setSysmlGenerationRequest((value) => value + 1);
          }}
          onAnalyzeGaps={() => setMode("sysml")}
        >
          <RequirementsManager
            key="workspace"
            projectName={workspaceProjectName}
            requirements={requirements}
            setRequirements={setRequirements}
            onActiveDesignContextChange={setActiveDesignContext}
          />
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
