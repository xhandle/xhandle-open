import { designLibraryModel, libraryContents } from './designLibraryModel';
import { LIBRARY_DRAG, LIBRARY_ORDER, libraryContainer, libraryDrop, libraryNodeKey, orderLibraryItems, reorderedKeys } from './designLibraryDrag';
import React, { useEffect, useId, useRef, useState } from 'react';
import { Briefcase, ChevronDown, ChevronRight, FileText, Folder, FolderOpen, FolderPlus, Layers, MoreHorizontal, Pencil, ArrowUpRight, Trash2 } from 'lucide-react';
export { libraryContents } from './designLibraryModel';

const OPEN_KEY = 'xhandle:folder-open';
const FOLDER_DRAG = 'application/x-xhandle-folder';
const MODULE_DRAG = 'application/x-xhandle-module';
const projectKey = item => `project:${item.id}`;


function FolderActions({ folder, onGenerateProject, onGenerateArtifact, onCreateChild, onRenameFolder, onMoveFolder, onDeleteFolder }) {
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef(null), panelId = useId();
  const run = callback => { setExpanded(false); callback?.(folder.id); };
  return <div className="contents" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setExpanded(false); trigger.current?.focus(); } }}>
    <button ref={trigger} type="button" aria-label={`Actions for ${folder.name}`} aria-expanded={expanded} aria-controls={panelId} className="inline-flex min-h-[36px] items-center gap-1 rounded border px-2 text-xs text-gray-700 hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-indigo-500" onClick={() => setExpanded(value => !value)}><MoreHorizontal className="h-4 w-4" aria-hidden="true" />Actions</button>
    {expanded && <div id={panelId} role="group" aria-label={`Folder actions for ${folder.name}`} className="basis-full w-full rounded-lg border bg-white p-1 shadow-sm">
      <button type="button" className="flex min-h-[44px] w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => run(onGenerateProject)}><Briefcase aria-hidden="true" className="h-4 w-4 shrink-0" />Generate systems engineering project</button>
      <button type="button" className="flex min-h-[44px] w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => run(onGenerateArtifact)}><FileText aria-hidden="true" className="h-4 w-4 shrink-0" />Generate engineering artifact</button>
      <button type="button" className="flex min-h-[44px] w-full items-center gap-2 rounded px-3 text-left text-sm hover:bg-gray-100" onClick={() => run(onCreateChild)}><FolderPlus className="h-4 w-4" />Add subfolder</button>
      <button type="button" className="flex min-h-[44px] w-full items-center gap-2 rounded px-3 text-left text-sm hover:bg-gray-100" onClick={() => run(onRenameFolder)}><Pencil className="h-4 w-4" />Rename folder</button>
      {(folder.parentId || folder.libraryParent?.startsWith('project:')) && <button type="button" className="flex min-h-[44px] w-full items-center gap-2 rounded px-3 text-left text-sm hover:bg-gray-100" onClick={() => { setExpanded(false); onMoveFolder?.(folder.id, null); }}><ArrowUpRight className="h-4 w-4" />Move to top level</button>}
      <button type="button" className="flex min-h-[44px] w-full items-center gap-2 rounded border-t px-3 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => run(onDeleteFolder)}><Trash2 className="h-4 w-4" />Delete folder</button>
    </div>}
  </div>;
}

export default function DesignLibraryTree({ roots, activeId, selectedModule, onSelect, onSelectModule, onCreateChild, onManageModules, onGenerateProject, onGenerateArtifact, onRenameFolder, onDeleteFolder, onMoveFolder, onMoveModule, onMoveItem }) {
  const [open, setOpen] = useState(() => { try { const saved = JSON.parse(localStorage.getItem(OPEN_KEY) || '[]'); return new Set(Array.isArray(saved) ? saved : []); } catch { return new Set(); } });
  const readOrder = () => { try { const value = JSON.parse(localStorage.getItem(LIBRARY_ORDER) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };
  const [order, setOrder] = useState(readOrder);
  const [dragItem, setDragItem] = useState(null), [dropHint, setDropHint] = useState(null), [moveError, setMoveError] = useState('');
  const { containers, allFolders, parents } = designLibraryModel(roots);
  const childrenOf = key => orderLibraryItems(containers.get(key) || [], Array.isArray(order[key]) ? order[key] : []);
  const positionAt = (event, target) => {
    if (!target) return 'inside';
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.height && Number.isFinite(event.clientY) ? (event.clientY - rect.top) / rect.height : 0.5;
    if (target.kind === 'folder' || target.kind === 'project') return ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
    return ratio < 0.5 ? 'before' : 'after';
  };
  const dragProps = target => ({
    draggable: !!target,
    style: dropHint?.key === (target ? libraryNodeKey(target) : 'library') ? { boxShadow: dropHint.position === 'inside' ? 'inset 0 0 0 2px #6366f1' : `inset 0 ${dropHint.position === 'before' ? '2' : '-2'}px 0 #6366f1` } : undefined,
    onDragStart: event => {
      if (!target) return;
      event.stopPropagation(); setDragItem(target); setMoveError(''); event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(LIBRARY_DRAG, JSON.stringify(target && { kind: target.kind, id: target.id, name: target.name, parentId: target.parentId, folderId: target.folderId, programId: target.programId, libraryParent: libraryContainer(target) }));
      if (target.kind === 'folder') event.dataTransfer.setData(FOLDER_DRAG, target.id);
      if (target.kind === 'module') event.dataTransfer.setData(MODULE_DRAG, JSON.stringify({ moduleId: target.id, fromFolderId: target.folderId }));
      event.dataTransfer.setData('text/plain', target.name);
    },
    onDragEnd: () => { setDragItem(null); setDropHint(null); },
    onDragOver: event => {
      event.stopPropagation();
      const position = positionAt(event, target), placement = libraryDrop(dragItem, target, position, allFolders);
      if (!placement) { event.dataTransfer.dropEffect = 'none'; setDropHint(null); return; }
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropHint({ key: target ? libraryNodeKey(target) : 'library', position });
    },
    onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropHint(null); },
    onDrop: async event => {
      event.preventDefault(); event.stopPropagation(); setDropHint(null); setDragItem(null);
      try {
        const item = dragItem || JSON.parse(event.dataTransfer.getData(LIBRARY_DRAG) || 'null');
        const placement = libraryDrop(item, target, positionAt(event, target), allFolders);
        if (!placement) return;
        const keys = childrenOf(placement.container).map(libraryNodeKey);
        if (onMoveItem) await onMoveItem(item, placement);
        else if (item.kind === 'folder') await onMoveFolder?.(item.id, placement.folderId);
        else if (item.kind === 'module') await onMoveModule?.(item.id, item.folderId, placement.folderId);
        const next = readOrder(), previous = libraryContainer(item);
        if (previous !== placement.container && Array.isArray(next[previous])) next[previous] = next[previous].filter(key => key !== libraryNodeKey(item));
        next[placement.container] = reorderedKeys(keys, item, placement);
        localStorage.setItem(LIBRARY_ORDER, JSON.stringify(next)); setOrder(next);
        if (placement.position === 'inside' && target) setOpen(previous => new Set([...previous, target.kind === 'project' ? projectKey(target) : target.id]));
      } catch (error) { setMoveError(error.message); }
    },
  });
  let selectedContainer = !selectedModule && activeId ? `folder:${activeId}` : null;
  for (const [key, items] of containers) {
    const selected = items.find(item => item.kind !== 'folder' && (item.externalArtifact ? item.id === selectedModule : key === `folder:${activeId}` && item.name === selectedModule));
    if (selected) selectedContainer = selected.kind === 'project' ? projectKey(selected) : key;
  }
  const path = [], visited = new Set();
  let ancestor = selectedContainer;
  while (ancestor && ancestor !== 'library' && !visited.has(ancestor)) {
    visited.add(ancestor); path.push(ancestor.startsWith('folder:') ? ancestor.slice(7) : ancestor); ancestor = parents.get(ancestor);
  }
  const revealKey = JSON.stringify([activeId, selectedModule, path]);
  const previousReveal = useRef(null);
  useEffect(() => {
    if (previousReveal.current === revealKey) return;
    previousReveal.current = revealKey;
    const ancestors = JSON.parse(revealKey)[2];
    if (ancestors) setOpen(previous => ancestors.every(id => previous.has(id)) ? previous : new Set([...previous, ...ancestors]));
  }, [revealKey]);
  useEffect(() => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])); } catch { /* Expansion is optional UI state. */ } }, [open]);
  const toggle = id => setOpen(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const setAll = expanded => {
    const ids = [];
    const visit = nodes => nodes.forEach(node => { ids.push(node.id); ids.push(...libraryContents(node).projects.map(projectKey)); visit(node.children || []); });
    visit(roots); setOpen(new Set(expanded ? ids : []));
  };
  const disclosure = (key, type, name, hasContent) => hasContent
    ? <button type="button" className="shrink-0 rounded p-0.5 hover:bg-gray-200" aria-label={`${open.has(key) ? 'Collapse' : 'Expand'} ${type} ${name}`} aria-expanded={open.has(key)} onClick={() => toggle(key)}>{open.has(key) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
    : <span className="w-5 shrink-0" />;
  const selectItem = (folderId, item) => { onSelect(folderId); onSelectModule?.(item.name, item); };
  const renderItem = (folderId, item, libraryParent = `folder:${folderId}`) => {
    item = { ...item, folderId, libraryParent, kind: item.externalArtifact ? 'artifact' : 'module' };
    const artifact = !!item.externalArtifact;
    const owningProject = item.programId && libraryParent.startsWith('folder:') ? allFolders.flatMap(folder => folder.modules || []).find(project => project.id === item.programId) : null;
    const selected = activeId === folderId && selectedModule === (artifact ? item.id : item.name);
    const Icon = artifact ? FileText : Layers;
    const scope = (item.templateId === 'architecture' ? `${item.config?.architectureKind || 'system'} architecture` : '') || item.config?.subsystem || [item.config?.endpointA, item.config?.endpointB].filter(Boolean).join(' ↔ ');
    return <li key={item.id} data-library-kind={artifact ? 'artifact' : 'module'} data-library-id={item.id}>
      <div className={`flex items-start gap-2 rounded px-2 py-1.5 ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
        {...dragProps(item)}
        onDoubleClick={() => { if (!artifact) onManageModules(folderId); }}>
        <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 mt-0.5 ${artifact ? 'text-sky-700' : 'text-gray-500'}`} />
        <div className="min-w-0 flex-1"><button type="button" className="block w-full truncate text-left text-sm" title={item.name} aria-current={selected ? 'page' : undefined} onClick={() => selectItem(folderId, item)}>{item.name}</button><p className="text-[10px] text-gray-500 truncate" title={scope || undefined}>{artifact ? 'Artifact' : 'Module'}{owningProject ? ` · ${owningProject.name}` : ''}{scope ? ` · ${scope}` : ''}</p></div>
      </div>
    </li>;
  };
  const renderProject = (folderId, project) => {
    project = { ...project, folderId, kind: 'project' };
    const key = projectKey(project), expanded = open.has(key), selected = selectedModule === project.id;
    return <li key={project.id} data-library-kind="project" data-library-id={project.id}>
      <div {...dragProps(project)} className={`flex items-start gap-1 rounded px-1 py-1.5 ${selected ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
        {disclosure(key, 'project', project.name, childrenOf(key).length > 0)}
        <Briefcase aria-hidden="true" className="h-4 w-4 shrink-0 mt-0.5 text-indigo-700" />
        <div className="min-w-0 flex-1 ml-1"><button type="button" className="block w-full truncate text-left text-sm font-medium" title={project.name} aria-current={selected ? 'page' : undefined} onClick={() => selectItem(folderId, project)}>{project.name}</button><p className="text-[10px] text-indigo-700">Project · {project.members?.length ?? project.artifacts.length} {(project.members?.length ?? project.artifacts.length) === 1 ? 'artifact' : 'artifacts'}</p></div>
      </div>
      {expanded && !!childrenOf(key).length && <ul className="ml-3 border-l border-indigo-100 pl-2" aria-label={`Artifacts in ${project.name}`}>{childrenOf(key).map(item => item.kind === 'folder' ? renderFolder(item) : renderItem(folderId, item, key))}</ul>}
    </li>;
  };
  const renderFolder = folder => {
    folder = { ...folder, kind: 'folder' };
    const selected = activeId === folder.id && !selectedModule;
    const hasContent = childrenOf(`folder:${folder.id}`).length > 0, expanded = open.has(folder.id);
    const Icon = expanded ? FolderOpen : Folder;
    return <li key={folder.id} data-library-kind="folder" data-library-id={folder.id}>
      <div {...dragProps(folder)} className={`relative flex flex-wrap items-start gap-1 rounded px-1 py-1.5 ${selected ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
        {disclosure(folder.id, 'folder', folder.name, hasContent)}
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
        <div className="min-w-0 flex-1 ml-1"><button type="button" className="block w-full truncate text-left text-sm font-medium" title={folder.name} aria-current={selected ? 'page' : undefined} onClick={() => { setOpen(previous => new Set([...previous, folder.id])); onSelect(folder.id); }}>{folder.name}</button><p className="text-[10px] text-gray-500">Folder</p></div>
        <FolderActions folder={folder} onGenerateProject={onGenerateProject} onGenerateArtifact={onGenerateArtifact} onCreateChild={onCreateChild} onRenameFolder={onRenameFolder} onMoveFolder={async (...args) => { try { await onMoveFolder?.(...args); } catch (error) { setMoveError(error.message); } }} onDeleteFolder={onDeleteFolder} />
      </div>
      {expanded && hasContent && <ul className="ml-3 border-l border-gray-200 pl-2" aria-label={`Contents of ${folder.name}`}>{childrenOf(`folder:${folder.id}`).map(item => item.kind === 'folder' ? renderFolder(item) : item.kind === 'project' ? renderProject(folder.id, item) : renderItem(folder.id, item))}</ul>}
    </li>;
  };
  return <nav aria-label="Design library"><div className="flex gap-3 px-2 pb-2 text-[11px] text-gray-600"><button type="button" className="hover:underline" onClick={() => setAll(true)}>Expand all</button><button type="button" className="hover:underline" onClick={() => setAll(false)}>Collapse all</button></div><p className="px-2 pb-2 text-[10px] text-gray-500">Drag to move. Drop between items to reorder.</p>{moveError && <p role="alert" className="p-2 text-xs text-red-700">{moveError}</p>}{dragItem?.kind === 'folder' && <div {...dragProps(null)} className="mb-2 rounded border border-dashed p-3 text-xs text-indigo-700">Move folder to top level</div>}<ul>{childrenOf('library').map(renderFolder)}</ul>{!roots.length && <p className="px-2 py-4 text-sm text-gray-500">Create a folder to organize your projects and artifacts.</p>}</nav>;
}
