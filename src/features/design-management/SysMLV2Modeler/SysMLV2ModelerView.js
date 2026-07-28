import React from "react";
import { ChevronDown, ChevronUp, PanelLeftOpen, PanelRightOpen } from "lucide-react";
import SysMLV2DiagramCanvas from "./SysMLV2DiagramCanvas";
import SysMLV2ElementTable from "./SysMLV2ElementTable";
import SysMLV2Explorer from "./SysMLV2Explorer";
import SysMLV2PropertiesPanel from "./SysMLV2PropertiesPanel";
import SysMLV2TextualView from "./SysMLV2TextualView";
import SysMLV2Toolbar from "./SysMLV2Toolbar";
import SysMLV2TraceabilityPanel from "./SysMLV2TraceabilityPanel";
import SysMLV2ValidationPanel from "./SysMLV2ValidationPanel";
import { autoLayoutSysML } from "./sysmlV2DiagramUtils";
import {
  addSysMLElement,
  addSysMLRelationship,
  createSysMLV2Model,
  deleteSysMLElement,
  deleteSysMLRelationship,
  ensureDefaultSysMLV2Model,
  importSysMLV2Model,
  loadSysMLV2Model,
  saveSysMLDiagramPositions,
  saveSysMLV2Model,
  updateSysMLElement,
  updateSysMLRelationship,
} from "./sysmlV2Store";
import { createSysMLTraceLink } from "./sysmlV2Types";
import { validateSysMLV2Model } from "./sysmlV2Validator";
import { applyGeneratedSysMLModel } from "./sysmlV2CopilotTools";

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeName(value, fallback = "Element") {
  const cleaned = String(value || fallback)
    .replace(/[^a-zA-Z0-9_ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const compact = cleaned.replace(/\s+/g, "");
  return compact || fallback;
}

function rowText(row) {
  return [row?.id, row?.title, row?.description, row?.text, row?.rationale]
    .filter(Boolean)
    .join(" - ");
}

const STOP_PART_WORDS = new Set([
  "system",
  "requirement",
  "requirements",
  "shall",
  "must",
  "should",
  "ability",
  "capability",
  "condition",
  "conditions",
  "operation",
  "operations",
  "performance",
  "safety",
  "design",
  "component",
  "components",
]);

function titleCaseName(value) {
  return safeName(String(value || "")
    .replace(/\b(the|a|an|and|or|to|from|with|for|of|in|on|by)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim(), "Element");
}

function extractCandidateParts(rows, sourceModule) {
  const scores = new Map();
  const add = (candidate, weight = 1) => {
    const name = titleCaseName(candidate);
    if (!name || name.length < 3 || STOP_PART_WORDS.has(name.toLowerCase())) return;
    scores.set(name, (scores.get(name) || 0) + weight);
  };

  rows.forEach((row) => {
    if (row?.heading) return;
    const text = rowText(row);
    const attrs = Object.values(row?.attributes || {}).join(" ");
    const combined = `${text} ${attrs}`;

    const explicitPatterns = [
      /\b(?:component|subsystem|module|unit|controller|sensor|actuator|interface|assembly)\s+["']?([A-Z][A-Za-z0-9 /_-]{2,40})/g,
      /\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\s+(?:subsystem|module|controller|sensor|actuator|interface|assembly|unit)\b/g,
      /\b(?:allocate(?:d)? to|performed by|hosted by|implemented by|controlled by)\s+([A-Za-z][A-Za-z0-9 /_-]{2,40})/gi,
    ];
    explicitPatterns.forEach((pattern) => {
      for (const match of combined.matchAll(pattern)) add(match[1], 3);
    });

    const domainTerms = combined.match(/\b[A-Z][A-Za-z0-9]*(?:Controller|Sensor|Actuator|Module|Interface|Processor|Computer|Battery|Motor|Valve|Pump|Brake|Bus|Gateway|Display|Unit|Assembly)\b/g) || [];
    domainTerms.forEach((term) => add(term, 2));
  });

  const ranked = [...scores.entries()]
    .filter(([, score]) => score >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);

  return ranked.length ? ranked : [titleCaseName(sourceModule.replace(/requirements?|specification/gi, "System"))];
}

function extractConnections(rows, partNames) {
  const partSet = new Set(partNames.map((name) => name.toLowerCase()));
  const connections = [];
  const findPart = (value) => partNames.find((name) => name.toLowerCase() === titleCaseName(value).toLowerCase() || partSet.has(String(value || "").toLowerCase()));
  rows.forEach((row) => {
    if (row?.heading) return;
    const text = rowText(row);
    const patterns = [
      /\bconnect(?:s|ed)?\s+(.+?)\s+to\s+(.+?)(?:\.|,|;|$)/gi,
      /\binterface\s+between\s+(.+?)\s+and\s+(.+?)(?:\.|,|;|$)/gi,
      /\bfrom\s+(.+?)\s+to\s+(.+?)(?:\.|,|;|$)/gi,
    ];
    patterns.forEach((pattern) => {
      for (const match of text.matchAll(pattern)) {
        const source = findPart(match[1]);
        const target = findPart(match[2]);
        if (source && target && source !== target) connections.push({ sourceName: source, targetName: target, label: "connects" });
      }
    });
  });
  return connections.slice(0, 12);
}

function analyzeDesignRowsToSysML({ rows, sourceFolder, sourceModule, projectId }) {
  const selectedRows = rows.slice(0, 120);
  const headingContext = selectedRows.filter((row) => row?.heading).map((row) => row.title || rowText(row)).filter(Boolean);
  const contentRows = selectedRows.filter((row) => !row?.heading);
  const partNames = extractCandidateParts(selectedRows, sourceModule);
  const systemName = titleCaseName(sourceModule.replace(/requirements?|specification/gi, "System"));
  const requirements = contentRows
    .filter((row) => /\bshall\b|\bmust\b|\brequire(?:d|ment)?\b/i.test(rowText(row)))
    .slice(0, 50)
    .map((row, index) => ({
      type: "RequirementDefinition",
      name: safeName(row.id || row.title || `Requirement ${index + 1}`, `Requirement${index + 1}`),
      description: row.title || row.description || row.text || "Requirement imported from the active Design Management module.",
      metadata: {
        sourceArtifact: "Design Management",
        sourceProjectId: projectId,
        sourceFolder,
        sourceModule,
        sourceRowId: row.id,
        headingContext,
        status: row.status,
        attributes: row.attributes || {},
      },
      traceLinks: row.id ? [{
        sourceType: "sysmlElement",
        targetType: "requirement",
        targetId: row.id,
        relationshipType: "derivedFrom",
        label: "derived from active Design Management row",
      }] : [],
    }));
  const partElements = partNames.map((name) => ({
    type: "PartDefinition",
    name,
    description: `Inferred from ${sourceFolder} / ${sourceModule}.`,
    metadata: { sourceArtifact: "Design Management", sourceProjectId: projectId, sourceFolder, sourceModule, headingContext },
  }));
  const systemElement = {
    type: "PartDefinition",
    name: systemName,
    description: `System boundary inferred from ${sourceFolder} / ${sourceModule}.`,
    metadata: { sourceArtifact: "Design Management", sourceProjectId: projectId, sourceFolder, sourceModule, headingContext },
  };
  const verificationCases = requirements.slice(0, 16).map((req) => ({
    type: "VerificationCase",
    name: `${req.name}Verification`,
    description: `Verify: ${req.description}`,
    metadata: { sourceArtifact: "Design Management", sourceRequirementName: req.name },
  }));
  const explicitConnections = extractConnections(selectedRows, partNames);
  const fallbackConnections = partNames.slice(0, 8).map((part) => ({ sourceName: systemName, targetName: part, label: "contains" }));
  return {
    modelName: safeName(`${sourceFolder} ${sourceModule} SysML Model`, "DesignSysMLModel"),
    elements: [systemElement, ...partElements, ...requirements, ...verificationCases],
    relationships: [
      ...fallbackConnections.map((rel) => ({ type: "contains", ...rel })),
      ...explicitConnections.map((rel) => ({ type: "connects", ...rel })),
      ...requirements.map((req, index) => ({ type: "satisfies", sourceName: partNames[index % partNames.length] || systemName, targetName: req.name, label: "satisfies" })),
      ...verificationCases.map((test) => ({ type: "verifies", sourceName: test.name, targetName: test.metadata.sourceRequirementName, label: "verifies" })),
    ],
  };
}

export default function SysMLV2ModelerView({ projectId, projectName, autoGenerateRequest = 0, designContext = {}, onGenerateRequirements }) {
  const [model, setModel] = React.useState(() => ensureDefaultSysMLV2Model(projectId, projectName));
  const [selection, setSelection] = React.useState(null);
  const [findings, setFindings] = React.useState(() => validateSysMLV2Model(model));
  const [bottomPanel, setBottomPanel] = React.useState("validation");
  const [bottomPanelOpen, setBottomPanelOpen] = React.useState(true);
  const [explorerOpen, setExplorerOpen] = React.useState(true);
  const [propertiesOpen, setPropertiesOpen] = React.useState(true);
  const lastAutoGenerateRef = React.useRef(0);

  const refresh = React.useCallback((next = loadSysMLV2Model(model?.id, projectId)) => {
    if (!next) return;
    setModel(next);
    setFindings(validateSysMLV2Model(next));
  }, [model?.id, projectId]);

  React.useEffect(() => {
    setSelection(null);
    const next = ensureDefaultSysMLV2Model(projectId, projectName);
    setModel(next);
    setFindings(validateSysMLV2Model(next));
  }, [projectId, projectName]);

  React.useEffect(() => {
    const onChange = () => refresh(loadSysMLV2Model(null, projectId));
    window.addEventListener("xhandle:sysml-v2-models-changed", onChange);
    window.addEventListener("xhandle:sysml-v2-active-model-changed", onChange);
    return () => {
      window.removeEventListener("xhandle:sysml-v2-models-changed", onChange);
      window.removeEventListener("xhandle:sysml-v2-active-model-changed", onChange);
    };
  }, [refresh, projectId]);

  const activeView = model?.activeView || "structure";

  const handleAddElement = (type) => {
    const name = window.prompt(`${type} name:`, type.replace(/Definition|Usage/g, ""));
    if (!name?.trim()) return;
    const result = addSysMLElement(model.id, { type, name: name.trim(), description: "" });
    refresh(result.model);
    setSelection({ kind: "element", id: result.element.id });
  };

  const handleAddRelationship = (type) => {
    const sourceName = window.prompt("Source element name or id:");
    if (!sourceName) return;
    const targetName = window.prompt("Target element name or id:");
    if (!targetName) return;
    const source = model.elements.find((el) => el.id === sourceName || el.name.toLowerCase() === sourceName.toLowerCase());
    const target = model.elements.find((el) => el.id === targetName || el.name.toLowerCase() === targetName.toLowerCase());
    if (!source || !target) {
      alert("Could not find source or target element.");
      return;
    }
    const result = addSysMLRelationship(model.id, { type, sourceId: source.id, targetId: target.id, label: type });
    refresh(result.model);
    setSelection({ kind: "relationship", id: result.relationship.id });
  };

  const handleCreateDrone = () => {
    const generated = {
      modelName: "DroneSystem",
      elements: [
        { type: "PartDefinition", name: "FlightController", description: "Computes stabilization and motor commands.", ports: [{ name: "sensorData" }, { name: "motorCommands" }], metadata: { safetyCritical: true } },
        { type: "PartDefinition", name: "Battery", description: "Stores and supplies electrical power.", ports: [{ name: "powerOutput" }], metadata: { safetyCritical: true } },
        { type: "PartDefinition", name: "PowerDistribution", description: "Distributes regulated power to avionics and propulsion.", ports: [{ name: "powerInput" }, { name: "regulatedPower" }] },
        { type: "PartDefinition", name: "MotorController", description: "Converts motor commands into motor drive signals.", ports: [{ name: "powerInput" }, { name: "motorDrive" }] },
        { type: "PartDefinition", name: "Motors", description: "Provide thrust for controlled flight." },
        { type: "PartDefinition", name: "Sensors", description: "Provide inertial, altitude, and navigation data." },
        { type: "PartDefinition", name: "CommunicationsModule", description: "Maintains command and telemetry links." },
        { type: "InterfaceDefinition", name: "PowerInterface", description: "Electrical power transfer interface." },
        { type: "RequirementDefinition", name: "MaintainControlledFlight", description: "The system shall maintain controlled flight during nominal operating conditions." },
        { type: "VerificationCase", name: "FlightControlVerification", description: "Verify controlled flight behavior under representative conditions." },
      ],
      relationships: [
        { type: "connects", sourceName: "Battery", targetName: "PowerDistribution", label: "supplies power" },
        { type: "connects", sourceName: "PowerDistribution", targetName: "MotorController", label: "regulated power" },
        { type: "connects", sourceName: "MotorController", targetName: "Motors", label: "drives" },
        { type: "connects", sourceName: "Sensors", targetName: "FlightController", label: "sensor data" },
        { type: "satisfies", sourceName: "FlightController", targetName: "MaintainControlledFlight", label: "satisfies" },
        { type: "verifies", sourceName: "FlightControlVerification", targetName: "MaintainControlledFlight", label: "verifies" },
      ],
    };
    refresh(applyGeneratedSysMLModel({ ...generated, projectId }));
  };

  const generateFromDesign = () => {
    const activeDesign = designContext?.activeDesign || {};
    const rows = Array.isArray(activeDesign.rows) && activeDesign.rows.length
      ? activeDesign.rows
      : (designContext?.requirements || []);
    const sourceFolder = activeDesign.activeFolderName || designContext?.projectName || projectName || "Design";
    const sourceModule = activeDesign.selectedModule || "Design Module";
    const selectedRows = rows.slice(0, 120);
    const generated = analyzeDesignRowsToSysML({ rows: selectedRows, sourceFolder, sourceModule, projectId });
    const hasRequirements = generated.elements.some((element) => /Requirement/.test(element.type));
    if (!hasRequirements && /drone|quadcopter|uav/i.test(selectedRows.map(rowText).join("\n"))) handleCreateDrone();
    else refresh(applyGeneratedSysMLModel({ ...generated, projectId }));
  };

  React.useEffect(() => {
    if (!autoGenerateRequest || autoGenerateRequest === lastAutoGenerateRef.current) return;
    lastAutoGenerateRef.current = autoGenerateRequest;
    generateFromDesign();
    // The request counter is the trigger; generateFromDesign reads the latest active Design Management context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerateRequest]);

  const generateRequirements = () => {
    const reqs = (model.elements || [])
      .filter((el) => /Part|Action|Interface|State/.test(el.type))
      .slice(0, 30)
      .map((el, index) => ({
        id: `SYSML-REQ-${index + 1}`,
        title: `The system shall provide ${el.name}.`,
        description: el.description || `Derived from SysML element ${el.name}.`,
        source: "SysML v2 Modeler",
        attributes: { SourceElement: el.qualifiedName || el.name, Verification: "Analysis/Test" },
      }));
    onGenerateRequirements?.(reqs, `${model.name} Requirements Specification`);
  };

  const updateActiveView = (view) => refresh(saveSysMLV2Model({ ...model, activeView: view }));
  const updatePositions = (positions) => refresh(saveSysMLDiagramPositions(model.id, activeView, positions));
  const updateElement = (id, patch) => refresh(updateSysMLElement(model.id, id, patch));
  const updateRelationship = (id, patch) => refresh(updateSysMLRelationship(model.id, id, patch));

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[560px] flex-col rounded-xl border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div>
          <div className="text-lg font-semibold text-gray-950">SysML v2 Modeler</div>
          <div className="text-xs text-gray-500">
            Source: <span className="font-medium text-gray-700">{projectName || "Current Project"}</span>
            {designContext?.activeDesign?.selectedModule ? <span> / {designContext.activeDesign.selectedModule}</span> : null}
            {model?.name ? <span> · Active model: {model.name}</span> : null}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50" onClick={handleCreateDrone}>Drone starter</button>
          <button className="rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50" onClick={generateFromDesign}>
            Generate from {designContext?.activeDesign?.selectedModule || "active design module"}
          </button>
          <button className="rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50" onClick={generateRequirements}>Generate requirements</button>
        </div>
      </div>
      <SysMLV2Toolbar
        model={model}
        activeView={activeView}
        onViewChange={updateActiveView}
        onCreateModel={() => {
          const name = window.prompt("Model name:", `${projectName || "System"} Model`);
          if (name?.trim()) refresh(createSysMLV2Model({ name: name.trim(), projectId }));
        }}
        onAddElement={handleAddElement}
        onAddRelationship={handleAddRelationship}
        onAutoLayout={() => refresh(saveSysMLV2Model({ ...model, diagrams: { ...(model.diagrams || {}), [activeView]: { ...(model.diagrams?.[activeView] || {}), positions: autoLayoutSysML(model, activeView) } } }))}
        onValidate={() => setFindings(validateSysMLV2Model(model))}
        onExportJson={() => downloadJson(`${model.name || "sysml-model"}.json`, model)}
        onImportJson={() => {
          const raw = window.prompt("Paste SysML v2 model JSON:");
          if (!raw) return;
          try { refresh(importSysMLV2Model(JSON.parse(raw))); } catch (err) { alert(err.message); }
        }}
      />
      <div
        className="grid min-h-0 flex-1 transition-[grid-template-columns] duration-200"
        style={{
          gridTemplateColumns: `${explorerOpen ? "260px" : "44px"} minmax(0, 1fr) ${propertiesOpen ? "320px" : "44px"}`,
        }}
      >
        {explorerOpen ? (
          <SysMLV2Explorer
            model={model}
            selectedId={selection?.id}
            onSelect={setSelection}
            onCollapse={() => setExplorerOpen(false)}
          />
        ) : (
          <div className="flex h-full flex-col items-center border-r bg-white px-1.5 py-2">
            <button
              type="button"
              className="rounded border p-1.5 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              title="Expand model explorer"
              aria-label="Expand model explorer"
              onClick={() => setExplorerOpen(true)}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        )}
        <div
          className="grid min-w-0"
          style={{
            gridTemplateRows: `minmax(0, 1fr) auto ${bottomPanelOpen ? "minmax(0, 220px)" : "0px"}`,
          }}
        >
          <SysMLV2DiagramCanvas model={model} activeView={activeView} selection={selection} onSelect={setSelection} onPositionsChange={updatePositions} />
          <div className="flex items-center justify-between gap-2 border-t bg-gray-50 px-2 py-1">
            <div className="flex gap-1">
              {["validation", "traceability", "table", "text"].map((panel) => (
                <button
                  key={panel}
                  className={`rounded px-2 py-1 text-xs font-medium ${bottomPanel === panel && bottomPanelOpen ? "bg-white shadow-sm" : "hover:bg-white"}`}
                  onClick={() => {
                    setBottomPanel(panel);
                    setBottomPanelOpen(true);
                  }}
                >
                  {panel[0].toUpperCase() + panel.slice(1)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="rounded border bg-white p-1 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              title={bottomPanelOpen ? "Collapse bottom viewer" : "Expand bottom viewer"}
              aria-label={bottomPanelOpen ? "Collapse bottom viewer" : "Expand bottom viewer"}
              aria-expanded={bottomPanelOpen}
              onClick={() => setBottomPanelOpen((open) => !open)}
            >
              {bottomPanelOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
          <div className="min-h-0 overflow-auto border-t bg-white">
            {bottomPanelOpen && bottomPanel === "validation" ? <SysMLV2ValidationPanel findings={findings} onSelect={setSelection} /> : null}
            {bottomPanelOpen && bottomPanel === "traceability" ? <SysMLV2TraceabilityPanel model={model} onSelect={setSelection} /> : null}
            {bottomPanelOpen && bottomPanel === "table" ? <SysMLV2ElementTable model={model} onSelect={setSelection} /> : null}
            {bottomPanelOpen && bottomPanel === "text" ? <SysMLV2TextualView model={model} onImported={refresh} /> : null}
          </div>
        </div>
        {propertiesOpen ? (
          <SysMLV2PropertiesPanel
            model={model}
            selection={selection}
            onCollapse={() => setPropertiesOpen(false)}
            onUpdateElement={updateElement}
            onUpdateRelationship={updateRelationship}
            onDeleteElement={(id) => {
              if (window.confirm("Delete this SysML element and connected relationships?")) refresh(deleteSysMLElement(model.id, id));
            }}
            onDeleteRelationship={(id) => {
              if (window.confirm("Delete this SysML relationship?")) refresh(deleteSysMLRelationship(model.id, id));
            }}
            onAddTraceLink={(link) => refresh(saveSysMLV2Model({ ...model, traceLinks: [...(model.traceLinks || []), createSysMLTraceLink(link)] }))}
          />
        ) : (
          <div className="flex h-full flex-col items-center border-l bg-white px-1.5 py-2">
            <button
              type="button"
              className="rounded border p-1.5 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              title="Expand properties panel"
              aria-label="Expand properties panel"
              onClick={() => setPropertiesOpen(true)}
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
