import TablePreparationProgress from '../../code-architecture-assurance/TablePreparationProgress';
import { ArchitectureTrace } from './ArchitectureDiagramView';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ArtifactObjectMenu from './ArtifactObjectMenu';
import HazardTrackingTable from './HazardTrackingTable';
import DesignEditorMenu from '../../requirements/components/DesignEditorMenu';
import { OutlinePanel, RowActionsBar, TablePanel, TraceabilityView, computeNumbering } from '../../requirements/components/RequirementsViews';
import { artifactRequirementRows } from './artifactRequirementsAdapter';

const EMPTY_PROJECTION = { rows: [], allRequirements: [], folderNameById: {} };

export default function ArtifactRequirementsViews({ meta, revision, objects, editableDescriptions = [], manifest, view: requestedView, setView: changeView, disabled, onEdit, onUpdate, onCommand, onHistory, fileActions = [], extraActions = [], document, diagram, focusObjectId, project, projectLoading, projectProgress, projectError, onRetryProject, draft }) {
  const tableOnly = meta.templateId === 'hazard-tracking-list';
  const view = tableOnly ? 'table' : requestedView;
  const setView = tableOnly ? () => {} : changeView;
  const contentRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(closeMenu, [closeMenu, view, meta.id]);
  const objectIndex = useMemo(() => new Map([...objects, ...editableDescriptions].map(object => [object.id, object])), [objects, editableDescriptions]);
  const targetObject = event => {
    if (view === 'diagram' || event.target.closest('input,textarea,select,button,a,summary,.artifact-citations')) return null;
    const element = event.target.closest('[data-artifact-object-id]');
    const object = element && objectIndex.get(element.dataset.artifactObjectId);
    return object && { object, element, field: event.target.closest('[data-object-field]')?.dataset.objectField };
  };
  const contextMenu = event => {
    const target = targetObject(event);
    if (!target) return;
    event.preventDefault(); event.stopPropagation();
    setSelectedId(target.object.id); setSelectedIds(new Set([target.object.id]));
    const bounds = target.element.getBoundingClientRect();
    setMenu({ ...target, x: event.clientX || bounds.left, y: event.clientY || bounds.top });
  };
  const doubleClick = event => {
    const target = targetObject(event);
    // Keep the native title and embedded-table editors in Outline and Table.
    if (!target || disabled || (!['document', 'TRACE'].includes(view) && !target.field)) return;
    event.stopPropagation();
    setSelectedId(target.object.id); setSelectedIds(new Set([target.object.id]));
    onEdit(target.object, target.field);
  };
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedId, setSelectedId] = useState(focusObjectId || null);
  useEffect(() => { if (focusObjectId) { setSelectedId(focusObjectId); setSelectedIds(new Set([focusObjectId])); } }, [focusObjectId]);
  // Yield before preparing a new view so the loading mark can paint and animate.
  const input = useMemo(() => ({ meta, revision, objects, manifest, project, draft, view }), [meta, revision, objects, manifest, project, draft, view]);
  const [prepared, setPrepared] = useState(null);
  const [preparationProgress, setPreparationProgress] = useState(null);
  const [preparationError, setPreparationError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (input.view === 'TRACE' && projectLoading) return;
    let cancelled = false, finish;
    const { meta, revision, objects, manifest, project, draft, view } = input;
    setPreparationProgress({ input, progress: 0 }); setPreparationError('');
    const timer = setTimeout(() => {
      try {
        const projection = meta.templateId === 'hazard-tracking-list' ? { ...EMPTY_PROJECTION, rows: objects.filter(object => !object.deleted) } : ['document', 'diagram'].includes(view) ? EMPTY_PROJECTION : artifactRequirementRows(meta, revision, objects, manifest, view === 'TRACE' ? project : undefined, draft, view === 'TRACE');
        if (cancelled) return;
        setPreparationProgress({ input, progress: 100 });
        finish = setTimeout(() => { if (!cancelled) setPrepared({ input, projection }); }, 0);
      } catch (error) { if (!cancelled) setPreparationError(error.message); }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(finish); };
  }, [input, attempt, projectLoading]); // input captures all preparation dependencies
  const preparing = prepared?.input !== input;
  useEffect(() => {
    if (!focusObjectId || preparing || tableOnly) return;
    const timer = setTimeout(() => {
      const node = [...(contentRef.current?.querySelectorAll('[data-artifact-object-id]') || [])].find(node => node.dataset.artifactObjectId === focusObjectId);
      if (node) { node.scrollIntoView?.({ block: 'center', inline: 'nearest' }); node.classList.add('xhandle-search-hit'); node.focus?.({ preventScroll: true }); }
    }, 0);
    return () => clearTimeout(timer);
  }, [focusObjectId, preparing, tableOnly, view]);
  const projection = preparing ? EMPTY_PROJECTION : prepared.projection;
  const { rows, allRequirements, folderNameById } = projection;
  const numbering = useMemo(() => tableOnly ? {} : computeNumbering(rows), [rows, tableOnly]);
  const selected = rows.find(r => r.id === selectedId);
  const columns = tableOnly ? [] : [...new Set(rows.flatMap(r => Object.keys(r.attributes)))];
  const select = (id, event) => { setSelectedId(id); setSelectedIds(previous => { if (!event?.shiftKey && !event?.metaKey && !event?.ctrlKey) return new Set([id]); const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const edit = row => !disabled && onEdit(objects.find(o => o.id === row.id));
  const update = (row, patch) => !disabled && onUpdate(row.id, patch);
  const command = name => !disabled && onCommand(name, selectedId, selectedIds);
  const selectedDisabled = disabled || !selected || preparing;
  const siblings = rows.filter(row => (row.parentId || null) === (selected?.parentId || null));
  const siblingIndex = siblings.findIndex(row => row.id === selectedId);
  const unavailable = { up: siblingIndex <= 0, down: siblingIndex < 0 || siblingIndex === siblings.length - 1, promote: !selected?.parentId, demote: siblingIndex <= 0 };
  const editorMenus = [
    { label: 'File', items: fileActions },
    { label: 'Edit', items: [
      { label: 'New Child', onSelect: () => command('new'), disabled: selectedDisabled },
      { label: 'Edit Selected', onSelect: () => edit(selected), disabled: selectedDisabled },
      { label: 'Delete Selected', onSelect: () => command('delete'), disabled: selectedDisabled },
    ] },
    { label: 'View', items: [
      ...[['outline', 'Outline'], ['table', 'Table'], ['TRACE', 'Traceability'], ['document', 'Document'], ...(meta.templateId === 'architecture' ? [['diagram', 'Diagram']] : [])].map(([value, label]) => ({ label: `${view === value ? '✓ ' : ''}${label}`, onSelect: () => setView(value) })),
    ] },
    { label: 'Arrange', items: [['up', 'Move Up'], ['down', 'Move Down'], ['promote', 'Promote'], ['demote', 'Demote']].map(([value, label]) => ({ label, onSelect: () => command(value), disabled: selectedDisabled || unavailable[value] })) },
    { label: 'Extras', items: extraActions },
    { label: 'Help', items: [{ text: 'Select an object to edit, remove or arrange it. Double-click its title or description to edit. Changes to accepted objects create a revision; draft edits stay in the proposal.' }] },
  ];
  return <div className="requirements-native-views text-gray-900">
    {!tableOnly && <div className="design-view-tools">{['outline', 'table'].includes(view) && <DesignEditorMenu menus={editorMenus} />}
    <RowActionsBar disabled={disabled || !selected} selection={selected} numbering={numbering} onClear={() => { setSelectedId(null); setSelectedIds(new Set()); }} onNewChild={() => command('new')} onEdit={() => selected && edit(selected)} onDelete={() => command('delete')} onMoveUp={() => command('up')} onMoveDown={() => command('down')} onPromote={() => command('promote')} onDemote={() => command('demote')} onHistory={() => onHistory(selectedId)} onSetContent={content => selected && update(selected, { content })} viewMode={view} setViewMode={setView} documentView diagramView={meta.templateId === 'architecture'} />
    </div>}
    <div ref={contentRef} onDoubleClickCapture={doubleClick} onContextMenu={contextMenu} onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) contextMenu(event); }} className="design-view-scroll" data-view={view.toLowerCase()} data-architecture={meta.templateId === 'architecture' && view === 'diagram' ? 'true' : undefined} role="region" aria-label="Artifact content" tabIndex={0}>
    {preparationError ? <div role="alert">{preparationError}<button onClick={() => setAttempt(value => value + 1)}>Retry loading view</button></div> : view === 'TRACE' && projectError ? <div role="alert">{projectError}<button onClick={onRetryProject}>Retry loading traceability</button></div> : view === 'TRACE' && projectLoading ? <TablePreparationProgress {...projectProgress} /> : preparing ? <TablePreparationProgress label={`Preparing ${view === 'TRACE' ? 'traceability' : view} view`} progress={preparationProgress?.input === input ? preparationProgress.progress : 0} /> : <>
    {view === 'outline' && <OutlinePanel moduleName={meta.title} rows={rows} numbering={numbering} disabled={disabled} selectedId={selectedId} selectedIds={selectedIds} onSelect={select} onEdit={edit} onInlineUpdate={update} />}
    {view === 'table' && (meta.templateId === 'hazard-tracking-list' ? <HazardTrackingTable artifactId={meta.id} rows={rows} selectedId={selectedId} selectedIds={selectedIds} onSelect={select} onEdit={(row, field) => !disabled && onEdit(objectIndex.get(row.id), field)} disabled={disabled} /> : <TablePanel hideRequirementTitles moduleName={meta.title} rows={rows} numbering={numbering} attrColumns={columns} disabled={disabled} canCreate={!disabled} selectedId={selectedId} selectedIds={selectedIds} onSelect={select} onEdit={edit} onInlineUpdate={update} />)}
    {view === 'TRACE' && <><ArchitectureTrace objects={objects} manifest={manifest} /><TraceabilityView allRequirements={allRequirements} selectedModule={meta.title} activeFolderId={meta.folderId} folderNameById={folderNameById} pageSize={100} /></>}
    {view === 'document' && document}
    {view === 'diagram' && diagram}
    </>}
    </div>
    {menu && <ArtifactObjectMenu tableOnly={tableOnly} onDelete={objectId => !disabled && onCommand('delete', objectId, new Set([objectId]))} target={menu} disabled={disabled} onClose={closeMenu} onEdit={onEdit} onHistory={revision && !draft ? onHistory : null} onView={(nextView, objectId) => {
      setSelectedId(objectId); setSelectedIds(new Set([objectId])); setView(nextView);
      requestAnimationFrame(() => {
        const element = [...(contentRef.current?.querySelectorAll('[data-artifact-object-id]') || [])].find(node => node.dataset.artifactObjectId === objectId);
        element?.scrollIntoView?.({ block: 'nearest' });
      });
    }} />}
  </div>;
}
