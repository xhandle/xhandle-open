import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Folder, FolderPlus, MoveRight, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, ShieldCheck } from "lucide-react";
import SafetyCaseDiagram, { layoutSafetyCase } from "./SafetyCaseDiagram";
import SafetyCaseToolbar from "./SafetyCaseToolbar";
import SafetyCaseInspector from "./SafetyCaseInspector";
import {
  createSafetyCase,
  createSafetyCaseFolder,
  deleteSafetyCase,
  deleteSafetyCaseFolder,
  duplicateSafetyCase,
  getActiveSafetyCaseId,
  loadSafetyCase,
  loadSafetyCaseFolders,
  loadSafetyCases,
  moveSafetyCaseFolder,
  renameSafetyCaseFolder,
  removeLegacyUnfiledSafetyCaseFolders,
  saveSafetyCase,
} from "./safetyCaseStore";
import { createSafetyCaseEdge, createSafetyCaseNode, normalizeSafetyCase, uuid } from "./safetyCaseTypes";
import { layoutSafetyCaseTreeSymmetrically, usesLifecycleSafetyCaseLayout } from "./safetyCaseLayout";
import { buildSafetyCaseProjectContext, generateLifecycleSafetyCase, loadXHandleProjects } from "./safetyCaseProjectContext";
import { checkSafetyCaseCompleteness } from "./safetyCaseCompleteness";
import { generateSafetyCaseFromProject, improveClaimWording, suggestEvidence } from "./safetyCaseAI";

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button className="rounded px-2 py-1 text-sm hover:bg-gray-100" onClick={onClose}>Close</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function GenerateSafetyCaseModal({ folders, generation, onChange, onClose, onGenerate, projects }) {
  return (
    <Modal title="Generate Safety Case From Project" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Source xHandle project</label>
          <select
            className="w-full rounded-md border px-3 py-2"
            value={generation.sourceProjectId || ""}
            onChange={(event) => {
              const project = projects.find((item) => String(item.id) === String(event.target.value));
              onChange({
                ...generation,
                sourceProjectId: event.target.value,
                name: project?.name ? `${project.name} Safety Case` : generation.name,
              });
            }}
          >
            <option value="">Choose a project...</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          {!projects.length && <div className="mt-1 text-xs text-amber-700">No xHandle projects were found. Create or select a project first.</div>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Safety case project name</label>
          <input className="w-full rounded-md border px-3 py-2" value={generation.name} onChange={(event) => onChange({ ...generation, name: event.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Destination folder</label>
          <select className="w-full rounded-md border px-3 py-2" value={generation.folderId || ""} onChange={(event) => onChange({ ...generation, folderId: event.target.value || null })}>
            <option value="">No folder</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{`${"  ".repeat(folder.depth || 0)}${folder.name}`}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button className="rounded-md border px-3 py-2 text-xs" onClick={onClose}>Cancel</button>
          <button className="rounded-md bg-[#2D7DFE] px-3 py-2 text-xs font-semibold text-white" onClick={() => onGenerate(generation)}>Generate</button>
        </div>
      </div>
    </Modal>
  );
}

function MoveFolderModal({ folder, folders, onClose, onMove }) {
  const [parentId, setParentId] = useState(folder?.parentId || "");
  if (!folder) return null;

  const descendants = new Set();
  const queue = [folder.id];
  while (queue.length) {
    const currentId = queue.shift();
    folders.forEach((item) => {
      if (item.parentId === currentId && !descendants.has(item.id)) {
        descendants.add(item.id);
        queue.push(item.id);
      }
    });
  }
  const destinations = folders.filter((item) => item.id !== folder.id && !descendants.has(item.id));

  return (
    <Modal title={`Move Folder: ${folder.name}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Destination</label>
          <select className="w-full rounded-md border px-3 py-2" value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">Top level</option>
            {destinations.map((item) => (
              <option key={item.id} value={item.id}>{`${"  ".repeat(item.depth || 0)}${item.name}`}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button className="rounded-md border px-3 py-2 text-xs" type="button" onClick={onClose}>Cancel</button>
          <button className="rounded-md bg-[#2D7DFE] px-3 py-2 text-xs font-semibold text-white" type="button" onClick={() => onMove(parentId || null)}>Move</button>
        </div>
      </div>
    </Modal>
  );
}

function CollapseRailButton({ title, onClick, icon: Icon }) {
  return (
    <button
      type="button"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-white text-gray-600 shadow-sm hover:bg-gray-50"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <Icon size={16} />
    </button>
  );
}

function applyAIUpdate(safetyCase, update, selectedNodeId = null) {
  const idMap = new Map();
  const addedNodes = (update.nodesToAdd || []).map((node, index) => {
    const parentId = node.parentId && safetyCase.nodes.some((item) => item.id === node.parentId) ? node.parentId : (node.parentId || selectedNodeId);
    const created = createSafetyCaseNode({
      ...node,
      parentId: parentId || null,
      createdBy: "ai",
      lastModifiedBy: "ai",
      position: { x: 80 + index * 40, y: 240 + index * 50 },
    });
    idMap.set(node.title, created.id);
    return created;
  });
  const nodes = [...safetyCase.nodes.map((node) => {
    const updateNode = (update.nodesToUpdate || []).find((item) => item.id === node.id);
    return updateNode ? { ...node, ...updateNode.changes, metadata: { ...node.metadata, updatedAt: new Date().toISOString(), lastModifiedBy: "ai" } } : node;
  }), ...addedNodes];
  const edges = [...safetyCase.edges];
  addedNodes.forEach((node) => {
    if (node.parentId) edges.push(createSafetyCaseEdge(node.parentId, node.id, node.type === "evidence" ? "evidences" : "supports"));
  });
  (update.edgesToAdd || []).forEach((edge) => {
    if (nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target)) {
      edges.push({ id: uuid("sce"), ...edge });
    }
  });
  return { ...safetyCase, nodes, edges };
}

export default function SafetyCaseView({ activeProjectId }) {
  const [cases, setCases] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [safetyCase, setSafetyCase] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [message, setMessage] = useState("");
  const [findings, setFindings] = useState(null);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [moveFolderTarget, setMoveFolderTarget] = useState(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [generation, setGeneration] = useState({ sourceProjectId: activeProjectId || "", name: "Project Safety Case", folderId: null });

  const refresh = useCallback(async () => {
    await removeLegacyUnfiledSafetyCaseFolders();
    const list = await loadSafetyCases();
    const folderList = loadSafetyCaseFolders();
    setCases(list);
    setFolders(folderList);
    const activeId = getActiveSafetyCaseId();
    const active = (activeId && await loadSafetyCase(activeId)) || list[0] || null;
    setSafetyCase(active);
    if (active?.folderId) setSelectedFolderId(active.folderId);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!safetyCase) return;
    window.dispatchEvent(new CustomEvent("xhandle:safety-case-context", {
      detail: {
        currentSafetyCaseId: safetyCase.id,
        selectedNodeId,
        visibleNodes: safetyCase.nodes?.length || 0,
        unsupportedNodes: (safetyCase.nodes || []).filter((node) => ["unsupported", "needs-review"].includes(node.status)).map((node) => ({ id: node.id, title: node.title, status: node.status })),
      },
    }));
  }, [safetyCase, selectedNodeId]);

  const selectedNode = useMemo(() => safetyCase?.nodes?.find((node) => node.id === selectedNodeId) || null, [safetyCase, selectedNodeId]);
  const renderedSafetyCase = useMemo(() => (
    safetyCase && usesLifecycleSafetyCaseLayout(safetyCase)
      ? layoutSafetyCaseTreeSymmetrically(safetyCase)
      : safetyCase
  ), [safetyCase]);
  const stats = useMemo(() => {
    const nodes = safetyCase?.nodes || [];
    const unsupported = nodes.filter((node) => ["unsupported", "needs-review"].includes(node.status)).length;
    return {
      claims: nodes.filter((node) => node.type === "claim").length,
      evidence: nodes.filter((node) => node.type === "evidence").length,
      unsupported,
      overall: unsupported ? "Needs Review" : "Supported",
    };
  }, [safetyCase]);

  const updateCase = useCallback((next) => setSafetyCase(normalizeSafetyCase(next)), []);
  const persist = useCallback(async (next = safetyCase) => {
    if (!next) return;
    const saved = await saveSafetyCase(next);
    setSafetyCase(saved);
    setMessage("Safety case saved.");
    refresh();
  }, [refresh, safetyCase]);

  const updateNode = useCallback((node, options = {}) => {
    if (!safetyCase || !node?.id) return;
    const next = normalizeSafetyCase({
      ...safetyCase,
      nodes: safetyCase.nodes.map((item) => item.id === node.id ? node : item),
    });
    setSafetyCase(next);
    if (options.persist) {
      saveSafetyCase(next)
        .then((saved) => {
          setCases((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
          setMessage("Links saved.");
        })
        .catch((error) => {
          setMessage(error?.message || "Unable to save links.");
        });
    }
  }, [safetyCase]);

  const projects = useMemo(() => loadXHandleProjects(), []);
  const folderRows = useMemo(() => {
    const byParent = folders.reduce((acc, folder) => {
      const key = folder.parentId || "root";
      if (!acc[key]) acc[key] = [];
      acc[key].push(folder);
      return acc;
    }, {});
    const rows = [];
    const visit = (parentId = "root", depth = 0) => {
      (byParent[parentId] || []).sort((a, b) => a.name.localeCompare(b.name)).forEach((folder) => {
        rows.push({ ...folder, depth });
        visit(folder.id, depth + 1);
      });
    };
    visit();
    return rows;
  }, [folders]);
  const filteredCases = useMemo(
    () => cases.filter((item) => (selectedFolderId ? item.folderId === selectedFolderId : true)),
    [cases, selectedFolderId]
  );
  const selectedFolderName = folders.find((folder) => folder.id === selectedFolderId)?.name || "All Safety Cases";

  useEffect(() => {
    setGeneration((current) => ({
      ...current,
      sourceProjectId: current.sourceProjectId || activeProjectId || "",
      folderId: current.folderId ?? selectedFolderId,
    }));
  }, [activeProjectId, selectedFolderId]);

  const createBlank = async () => {
    const name = window.prompt("Safety case project name", "Untitled Safety Case");
    if (name === null) return;
    const created = await createSafetyCase({ sourceProjectId: activeProjectId, folderId: selectedFolderId, name: name || "Untitled Safety Case" });
    const layouted = await layoutSafetyCase(created);
    await persist(layouted);
  };

  const generateFromProject = async ({ sourceProjectId, name, folderId } = generation) => {
    if (!sourceProjectId) {
      setMessage("Choose a project to generate a safety case from.");
      setGenerateModalOpen(true);
      return;
    }
    const projectContext = buildSafetyCaseProjectContext(sourceProjectId);
    let base = await createSafetyCase({
      projectId: sourceProjectId,
      sourceProjectId,
      folderId: folderId ?? selectedFolderId,
      name: name || `${projectContext.project?.name || "Project"} Safety Case`,
    });
    const root = {
      ...base.nodes[0],
      title: `Claim: ${projectContext.project?.name || "System"} is acceptably safe for intended use in the defined operational context`,
      description: "Top-level safety claim for the generated lifecycle safety argument.",
      metadata: { ...base.nodes[0]?.metadata, template: "lifecycleSafetyCase", layoutRole: "topClaim" },
    };
    const rootId = root.id;
    const template = generateLifecycleSafetyCase(projectContext, rootId);
    const idByKey = new Map();
    const nodes = template.nodes.map(({ key, parentKey, relationship, ...node }) => {
      const created = createSafetyCaseNode({
        ...node,
        parentId: parentKey ? idByKey.get(parentKey) : node.parentId,
        createdBy: "ai",
        lastModifiedBy: "ai",
      });
      idByKey.set(key, created.id);
      return { ...created, metadata: { ...created.metadata, ...(node.metadata || {}) } };
    });
    const edges = template.nodes.map(({ key, parentKey, parentId, relationship }) => {
      const source = parentKey ? idByKey.get(parentKey) : parentId;
      return source ? createSafetyCaseEdge(source, idByKey.get(key), relationship || "supports") : null;
    }).filter(Boolean);
    const crossLinks = template.crossLinks.map((edge) => createSafetyCaseEdge(idByKey.get(edge.sourceKey), idByKey.get(edge.targetKey), edge.relationship, edge.label));
    const generated = layoutSafetyCaseTreeSymmetrically({ ...base, nodes: [root, ...nodes], edges: [...base.edges, ...edges, ...crossLinks] });
    await persist(generated);
    setGenerateModalOpen(false);
  };

  const addNode = async (type = "claim", parentId = selectedNodeId) => {
    if (!safetyCase) return;
    const parent = safetyCase.nodes.find((node) => node.id === parentId);
    const node = createSafetyCaseNode({
      type,
      parentId: parentId || null,
      title: type === "claim" ? "New safety claim" : `New ${type}`,
      status: type === "evidence" ? "needs-review" : "draft",
      position: { x: (parent?.position?.x || 0) + 40, y: (parent?.position?.y || 0) + 240 },
    });
    const next = { ...safetyCase, nodes: [...safetyCase.nodes, node], edges: parentId ? [...safetyCase.edges, createSafetyCaseEdge(parentId, node.id, type === "evidence" ? "evidences" : "supports")] : safetyCase.edges };
    updateCase(next);
    setSelectedNodeId(node.id);
  };

  const toggleCollapse = useCallback((id) => {
    setSafetyCase((current) => current
      ? normalizeSafetyCase({
          ...current,
          nodes: current.nodes.map((node) => node.id === id ? { ...node, collapsed: !node.collapsed } : node),
        })
      : current
    );
  }, []);

  const deleteSelectedNode = () => {
    if (!selectedNode || !safetyCase) return;
    const descendants = new Set();
    const collect = (id) => safetyCase.nodes.filter((node) => node.parentId === id).forEach((child) => { descendants.add(child.id); collect(child.id); });
    collect(selectedNode.id);
    descendants.add(selectedNode.id);
    updateCase({ ...safetyCase, nodes: safetyCase.nodes.filter((node) => !descendants.has(node.id)), edges: safetyCase.edges.filter((edge) => !descendants.has(edge.source) && !descendants.has(edge.target)) });
    setSelectedNodeId(null);
  };

  const importJson = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = normalizeSafetyCase(JSON.parse(text));
      if (!imported.nodes.length) throw new Error("Imported Safety Case must contain at least one node.");
      await persist({ ...imported, projectId: imported.projectId || activeProjectId, folderId: imported.folderId ?? selectedFolderId });
    } catch (error) {
      setMessage(error.message || "Invalid Safety Case JSON.");
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(safetyCase, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(safetyCase.name || "safety-case").replace(/[^\w-]+/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const askAI = async (mode = "support") => {
    if (!safetyCase) return;
    try {
      const projectContext = buildSafetyCaseProjectContext(safetyCase.sourceProjectId || safetyCase.projectId);
      const suggestion = mode === "improve"
        ? await improveClaimWording(selectedNode, safetyCase)
        : mode === "gaps"
          ? { summary: "Unsupported and incomplete areas found.", nodesToAdd: [], nodesToUpdate: [], edgesToAdd: [], warnings: checkSafetyCaseCompleteness(safetyCase).map((item) => item.title) }
          : selectedNode
            ? await suggestEvidence(selectedNode, safetyCase, projectContext)
            : await generateSafetyCaseFromProject(projectContext);
      setAiSuggestion(suggestion);
    } catch (error) {
      setAiSuggestion({ summary: "Collaborator suggestions are unavailable.", nodesToAdd: [], nodesToUpdate: [], edgesToAdd: [], warnings: [error.message || "Configure an AI key and try again."] });
    }
  };

  if (!safetyCase) {
    return (
      <div className="flex h-full flex-col overflow-auto bg-white px-6 py-5">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold">Safety Case</h1>
          <p className="text-sm text-gray-500">Create, edit, and maintain structured safety arguments.</p>
        </div>
        <div className="flex min-h-[520px] items-center justify-center rounded-lg border bg-gray-50 p-8 text-center">
          <div className="max-w-2xl">
            <ShieldCheck className="mx-auto mb-4 text-[#2D7DFE]" size={44} />
            <h2 className="text-2xl font-semibold">Build a Safety Case</h2>
            <p className="mt-3 text-sm leading-6 text-gray-600">Create a top-down safety argument that connects claims, evidence, hazards, requirements, verification results, and architecture artifacts.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button className="rounded-md bg-[#2D7DFE] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f66d1]" onClick={createBlank}>Create Blank Safety Case</button>
              <button className="rounded-md border bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setGenerateModalOpen(true)}>Generate From Project</button>
            </div>
            <p className="mt-5 text-xs text-gray-500">Collaborator can help identify unsupported claims, suggest evidence, and maintain the safety case as the system evolves.</p>
          </div>
        </div>
        {generateModalOpen && (
          <GenerateSafetyCaseModal
            folders={folderRows}
            generation={generation}
            onChange={setGeneration}
            onClose={() => setGenerateModalOpen(false)}
            onGenerate={generateFromProject}
            projects={projects}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="border-b px-4 py-2">
        <h1 className="text-xl font-semibold">Safety Case</h1>
        <p className="text-xs text-gray-500">Top-down assurance argument with traceable claims, evidence, and project links.</p>
        {message && <div className="mt-2 text-xs text-gray-500">{message}</div>}
      </div>
      <SafetyCaseToolbar
        disabled={!safetyCase}
        onNew={createBlank}
        onSave={() => persist()}
        onDuplicate={async () => setSafetyCase(await duplicateSafetyCase(safetyCase.id))}
        onDelete={async () => { await deleteSafetyCase(safetyCase.id, safetyCase.projectId); setSafetyCase(null); refresh(); }}
        onAddTopClaim={() => addNode("claim", null)}
        onLayout={() => updateCase(layoutSafetyCaseTreeSymmetrically(safetyCase))}
        onExport={exportJson}
        onImport={importJson}
        onAskAI={() => askAI("support")}
        onGenerate={() => setGenerateModalOpen(true)}
        onCheck={() => setFindings(checkSafetyCaseCompleteness(safetyCase))}
        onUnsupported={() => setFindings(checkSafetyCaseCompleteness(safetyCase).filter((finding) => /support|weak|unsupported/i.test(`${finding.title} ${finding.description}`)))}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
        {leftPanelCollapsed ? (
          <div className="flex shrink-0 border-r bg-gray-50 p-1.5 xl:w-10 xl:flex-col">
            <CollapseRailButton title="Show safety case projects" icon={PanelLeftOpen} onClick={() => setLeftPanelCollapsed(false)} />
          </div>
        ) : (
          <aside className="max-h-48 w-full shrink-0 overflow-auto border-r bg-gray-50 p-2 xl:max-h-none xl:w-60">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase text-gray-500">Safety Case Projects</div>
              <div className="flex items-center gap-1">
                <button
                  className="rounded-md p-1.5 text-gray-600 hover:bg-white"
                  title="New folder"
                  onClick={() => {
                    const name = window.prompt("Folder name", "New Folder");
                    if (!name) return;
                    const folder = createSafetyCaseFolder({ name, parentId: selectedFolderId || null });
                    if (!folder) return;
                    setFolders(loadSafetyCaseFolders());
                    setSelectedFolderId(folder.id);
                  }}
                >
                  <FolderPlus size={16} />
                </button>
                <button
                  className="rounded-md p-1.5 text-gray-600 hover:bg-white"
                  title="Hide safety case projects"
                  aria-label="Hide safety case projects"
                  onClick={() => setLeftPanelCollapsed(true)}
                >
                  <PanelLeftClose size={16} />
                </button>
              </div>
            </div>
            {folderRows.map((folder) => (
              <div key={folder.id} className="group flex items-center gap-1">
                <button
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${selectedFolderId === folder.id ? "bg-white font-medium text-[#2D7DFE]" : "text-gray-700 hover:bg-white"}`}
                  onClick={() => setSelectedFolderId(folder.id)}
                  title={folder.name}
                  style={{ paddingLeft: `${8 + folder.depth * 16}px` }}
                >
                  <Folder size={15} />
                  <span className="truncate">{folder.name}</span>
                </button>
                <button
                  className="invisible rounded p-1 text-gray-600 hover:bg-white group-hover:visible"
                  title="Rename folder"
                  aria-label={`Rename ${folder.name}`}
                  onClick={() => {
                    const name = window.prompt("Folder name", folder.name);
                    if (name === null) return;
                    renameSafetyCaseFolder(folder.id, name);
                    setFolders(loadSafetyCaseFolders());
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="invisible rounded p-1 text-gray-600 hover:bg-white group-hover:visible"
                  title="Move folder"
                  aria-label={`Move ${folder.name}`}
                  onClick={() => setMoveFolderTarget(folder)}
                >
                  <MoveRight size={13} />
                </button>
                <button
                  className="invisible rounded px-1.5 py-1 text-xs text-red-600 hover:bg-red-50 group-hover:visible"
                  title="Delete folder"
                  onClick={async () => {
                    if (!window.confirm(`Delete folder "${folder.name}"? Safety cases will move to no folder.`)) return;
                    await deleteSafetyCaseFolder(folder.id);
                    setSelectedFolderId(null);
                    refresh();
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
            <div className="mt-3 border-t pt-2">
              <div className="mb-2 text-xs font-semibold text-gray-500">{selectedFolderName}</div>
              <div className="space-y-1">
                {filteredCases.map((item) => (
                  <button
                    key={item.id}
                    className={`w-full rounded-md px-2 py-2 text-left text-sm ${safetyCase?.id === item.id ? "bg-[#ECEEFF] text-gray-900" : "text-gray-700 hover:bg-white"}`}
                    onClick={() => {
                      setSafetyCase(item);
                      setSelectedNodeId(null);
                    }}
                  >
                    <div className="truncate font-medium">{item.name}</div>
                    <div className="truncate text-[11px] text-gray-500">{item.nodes?.length || 0} nodes</div>
                  </button>
                ))}
                {!filteredCases.length && <div className="rounded-md border border-dashed bg-white p-3 text-xs text-gray-500">No safety case projects in this folder.</div>}
              </div>
            </div>
          </aside>
        )}
        <div className="min-h-0 min-w-0 flex-1 p-2">
          <SafetyCaseDiagram
            safetyCase={renderedSafetyCase}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onChange={updateCase}
            onToggleCollapse={toggleCollapse}
          />
        </div>
        {rightPanelCollapsed ? (
          <div className="flex shrink-0 border-l bg-white p-1.5 xl:w-10 xl:flex-col">
            <CollapseRailButton title="Show safety case inspector" icon={PanelRightOpen} onClick={() => setRightPanelCollapsed(false)} />
          </div>
        ) : (
          <div className="relative min-h-0 shrink-0 xl:w-80">
            <button
              className="absolute right-2 top-2 z-10 rounded-md p-1.5 text-gray-600 hover:bg-gray-100"
              title="Hide safety case inspector"
              aria-label="Hide safety case inspector"
              onClick={() => setRightPanelCollapsed(true)}
            >
              <PanelRightClose size={16} />
            </button>
            <SafetyCaseInspector
              safetyCase={safetyCase}
              selectedNode={selectedNode}
              stats={stats}
              onCaseChange={updateCase}
              onNodeChange={updateNode}
              onAddChild={(type) => addNode(type)}
              onDeleteNode={deleteSelectedNode}
              onAskAI={askAI}
            />
          </div>
        )}
      </div>
      {findings && (
        <Modal title="Safety Case Completeness" onClose={() => setFindings(null)}>
          <div className="space-y-2">
            {!findings.length && <div className="text-sm text-gray-600">No completeness findings were detected.</div>}
            {findings.map((finding) => (
              <button key={finding.id} className="block w-full rounded-md border p-3 text-left hover:bg-gray-50" onClick={() => { setSelectedNodeId(finding.nodeId); setFindings(null); }}>
                <div className="text-sm font-semibold">{finding.title}</div>
                <div className="text-xs text-gray-600">{finding.description}</div>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {generateModalOpen && (
        <GenerateSafetyCaseModal
          folders={folderRows}
          generation={generation}
          onChange={setGeneration}
          onClose={() => setGenerateModalOpen(false)}
          onGenerate={generateFromProject}
          projects={projects}
        />
      )}
      {moveFolderTarget && (
        <MoveFolderModal
          folder={moveFolderTarget}
          folders={folderRows}
          onClose={() => setMoveFolderTarget(null)}
          onMove={(parentId) => {
            moveSafetyCaseFolder(moveFolderTarget.id, parentId);
            setFolders(loadSafetyCaseFolders());
            setMoveFolderTarget(null);
          }}
        />
      )}
      {aiSuggestion && (
        <Modal title="Review AI Suggestions" onClose={() => setAiSuggestion(null)}>
          <div className="space-y-3 text-sm">
            <p>{aiSuggestion.summary}</p>
            <div className="rounded-md bg-gray-50 p-3 text-xs">Adds {aiSuggestion.nodesToAdd?.length || 0} nodes, updates {aiSuggestion.nodesToUpdate?.length || 0} nodes, adds {aiSuggestion.edgesToAdd?.length || 0} edges.</div>
            {(aiSuggestion.warnings || []).map((warning, index) => <div key={index} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{warning}</div>)}
            <div className="flex justify-end gap-2">
              <button className="rounded-md border px-3 py-2 text-xs" onClick={() => setAiSuggestion(null)}>Cancel</button>
              <button className="inline-flex items-center gap-1.5 rounded-md bg-[#2D7DFE] px-3 py-2 text-xs font-semibold text-white" onClick={async () => { const next = await layoutSafetyCase(applyAIUpdate(safetyCase, aiSuggestion, selectedNodeId)); updateCase(next); setAiSuggestion(null); }}>
                <Bot size={14} /> Apply
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
