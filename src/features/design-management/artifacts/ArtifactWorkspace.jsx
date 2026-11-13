import TablePreparationProgress from '../../code-architecture-assurance/TablePreparationProgress';
import HazardAnalysisNotice, { useHazardAnalysisStatus } from './HazardAnalysisNotice';
import ConsolidatedHazardNotice, { useConsolidatedHazardStatus } from './ConsolidatedHazardNotice';
import { isSafetyArtifact } from './safetyArtifactTypes';
import { HAZARD_TRACKING_COLUMNS, projectHazardTrackingFields } from './hazardTrackingFields';
import { requestProjectLoad } from './requestProjectLoad';
import { architectureDraftingGuidance } from './architectureDraftingContext';
import { folderDestinations } from './folderDestinations';
import ArtifactComparison from './ArtifactComparison';
import ArchitectureDocument from './ArchitectureDocument';
import { architectureEditableSections } from './architectureDescription';
import ArtifactDocumentLayout from './ArtifactDocumentLayout';
import ArtifactActionsPopover from './ArtifactActionsPopover';
import DocumentDetailsDialog from './DocumentDetailsDialog';
import { savedPartCount } from './generationSourceBatches';
import { startGenerationRun, pauseGenerationRun, useGenerationRun } from './generationRuns';
import ArchitectureSourcesDialog from './ArchitectureSourcesDialog';
import { ArchitectureDiagrams, ArchitectureEvidence } from './ArchitectureDiagramView';
import ArchitectureSourcePicker, { ArchitectureKindSelect } from './ArchitectureSourcePicker';
import { listEngineeringProjects } from './engineeringProjectRepository';
import ArtifactRequirementsViews from './ArtifactRequirementsViews';
import { changeArtifactStructure } from './artifactRequirementsAdapter';
import { MiniTable, Modal } from '../../requirements/components/RequirementsViews';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ARTIFACT_TEMPLATES, artifactObjectText, getTemplate, mergeProposal, newId } from './artifactModel';
import { availableProjects, readArray, sourceCatalog } from './artifactSources';
import { acceptProposal, ARTIFACT_CHANGED, createArtifact, createBaseline, deleteArtifact, listArtifacts, listRevisions, loadArtifact, saveObjects, saveDraftObjects, startProposal } from './artifactRepository';
import { generateArtifact } from './artifactGeneration';
import { exportArtifact, orderedObjects } from './artifactExport';
import './artifacts.css';

export function useArtifactWorkspace() {
  const [modules, setModules] = useState([]);
  const [selectedId, select] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showProjectCreate, setShowProjectCreate] = useState(false);
  const [focusObjectId, setFocusObjectId] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () => Promise.all([listArtifacts(), listEngineeringProjects()]).then(groups => groups.flat()).then(rows => { if (alive) setModules(rows.map(m => ({ ...m, name: m.title, externalArtifact: true }))); }).catch(e => { if (alive) setError(e.message); });
    refresh(); window.addEventListener(ARTIFACT_CHANGED, refresh);
    return () => { alive = false; window.removeEventListener(ARTIFACT_CHANGED, refresh); };
  }, []);
  return { modules, selectedId, select, showCreate, setShowCreate, showProjectCreate, setShowProjectCreate, focusObjectId, setFocusObjectId, error, setError };
}
export function ArtifactCreateDialog({ onClose, onCreated, activeFolderId, libraryProjects = [] }) {
  const [catalog] = useState(() => { try { return { projects: availableProjects(), folders: readArray('xhandle:req-projects'), sources: sourceCatalog() }; } catch (e) { return { projects: [], folders: [], sources: [], error: e.message }; } });
  const [config, setConfig] = useState({ templateId: 'conops', title: 'Concept of Operations', folderId: activeFolderId || '', system: '', subsystem: '', endpointA: '', endpointB: '', notes: '', sources: [], architectureSources: [], architectureKind: 'system' });
  const [owner, setOwner] = useState('');
  const [error, setError] = useState(catalog.error || '');
  const [busy, setBusy] = useState(false);
  const change = (key, value) => setConfig(c => ({ ...c, [key]: value }));
  const scope = getTemplate(config.templateId).scope;
  const safety = isSafetyArtifact(config.templateId);
  const sourceOwner = catalog.projects.find(project => `${project.workspaceType}:${project.id}` === owner);
  const requirements = config.templateId === 'safety-requirements';
  const analysisStatus = useHazardAnalysisStatus(sourceOwner ? [sourceOwner] : [], safety && !requirements);
  const consolidatedStatus = useConsolidatedHazardStatus(config, sourceOwner, requirements);
  const hazardStatus = requirements ? consolidatedStatus : analysisStatus;
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const project = catalog.projects.find(p => `${p.workspaceType}:${p.id}` === owner);
      if (!project) throw new Error('Select the owning project.');
      const id = await createArtifact({ ...config, ...(safety ? { sources: [], architectureSources: [], notes: '' } : {}), ...(requirements ? { hazardTrackingArtifactId: consolidatedStatus.selectedId } : {}), projectId: project.id, workspaceType: project.workspaceType });
      onCreated(id); onClose();
    } catch (e) { console.error('[Artifact creation]', e.artifactStage || 'Creating artifact', e.cause || e); setError(e.message); } finally { setBusy(false); }
  };
  return <div className="artifact-modal" role="dialog" aria-modal="true" aria-label="Generate engineering artifact"><form onSubmit={submit} className="artifact-form">
    <h2>Generate an engineering artifact</h2><p>{config.templateId === 'hazard-tracking-list' ? 'Create a table from saved hazard analysis. Consolidate hazard analysis into actionable safety concerns, grouping scenario and unsafe-action variants while retaining original assessments for inspection.' : 'Choose its scope and evidence. Generated sections are saved as a proposal for your review.'}</p>
    {error && <p role="alert" className="artifact-error">{error}</p>}
    <label>Document type<select value={config.templateId} onChange={e => { change('templateId', e.target.value); change('title', getTemplate(e.target.value).name); }}>{ARTIFACT_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    {config.templateId === 'architecture' && <ArchitectureKindSelect value={config.architectureKind} onChange={kind => { change('architectureKind', kind); change('architectureSources', []); }} />}
    <label>Title<input required maxLength={200} value={config.title} onChange={e => change('title', e.target.value)} /></label>
    <div className="artifact-fields"><label>Owning project<select required value={owner} onChange={e => { setOwner(e.target.value); change('architectureSources', []); if (config.templateId === 'architecture') change('architectureKind', e.target.value.startsWith('code-architecture:') ? 'code-based' : config.architectureKind === 'code-based' ? 'system' : config.architectureKind); }}><option value="">Choose project</option>{catalog.projects.map(p => <option key={`${p.workspaceType}:${p.id}`} value={`${p.workspaceType}:${p.id}`}>{p.name} ({p.workspaceType})</option>)}</select></label>
    <label>Destination folder<select required value={config.folderId} onChange={e => change('folderId', e.target.value)}><option value="">Choose folder</option>{folderDestinations(catalog.folders, libraryProjects).map(f => <option key={f.id} value={f.id}>{f.path}</option>)}</select></label></div>
    <label>System<input required value={config.system} onChange={e => change('system', e.target.value)} /></label>
    {scope === 'subsystem' && <label>Subsystem<input required value={config.subsystem} onChange={e => change('subsystem', e.target.value)} /></label>}
    {scope === 'interface' && <div className="artifact-fields"><label>Endpoint A<input required value={config.endpointA} onChange={e => change('endpointA', e.target.value)} /></label><label>Endpoint B<input required value={config.endpointB} onChange={e => change('endpointB', e.target.value)} /></label></div>}
    {requirements ? <ConsolidatedHazardNotice status={consolidatedStatus} onChange={id => change('hazardTrackingArtifactId', id)} /> : safety ? <HazardAnalysisNotice status={hazardStatus} /> : <>
    <ArchitectureSourcePicker owners={catalog.projects.filter(p => `${p.workspaceType}:${p.id}` === owner)} value={config.architectureSources} onChange={sources => change('architectureSources', sources)} kind={config.templateId === 'architecture' ? config.architectureKind : null} />
    <fieldset><legend>Source modules</legend><p>Include only modules that apply to this project. Existing design folders may contain work from more than one project.</p><div className="artifact-source-picker">{catalog.sources.map(source => {
      const checked = config.sources.some(s => s.folderId === source.folderId && s.moduleId === source.moduleId);
      return <label key={`${source.folderId}/${source.moduleId}`}><input type="checkbox" checked={checked} onChange={() => change('sources', checked ? config.sources.filter(s => !(s.folderId === source.folderId && s.moduleId === source.moduleId)) : [...config.sources, { folderId: source.folderId, moduleId: source.moduleId }])} />{source.label}</label>;
    })}{!catalog.sources.length && <p>Create a design folder and source module, or supply source notes below.</p>}</div></fieldset>
    <label>Source notes<textarea rows={4} maxLength={20000} value={config.notes} onChange={e => change('notes', e.target.value)} placeholder="Operational needs, scope, decisions and known constraints…" /></label>
    </>}
    <div className="artifact-actions"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy || !hazardStatus.ready}>{busy ? 'Saving…' : 'Create draft'}</button></div>
  </form></div>;
}

export function ArtifactEditor({ id, onDeleted, onOpenProject, focusObjectId, focusDraft }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [actionBusy, setBusy] = useState(false);
  const runKey = `artifact:${id}`, run = useGenerationRun(runKey);
  const busy = actionBusy || run.running, progress = run.progress;
  const [view, setView] = useState('outline');
  const [diagramFocus, setDiagramFocus] = useState(null);
  const [diagramExport, setDiagramExport] = useState(null);
  const [projectTrace, setProjectTrace] = useState(null);
  const [loadProgress, setLoadProgress] = useState({ progress: 0, label: 'Opening artifact…' });
  const [traceProgress, setTraceProgress] = useState({ progress: 0, label: 'Opening project traceability…' });
  const [traceError, setTraceError] = useState('');
  const [traceAttempt, setTraceAttempt] = useState(0);
  const [edit, setEdit] = useState(null);
  const [review, setReview] = useState(false);
  useEffect(() => { if (focusObjectId && data) { setView(focusObjectId.startsWith(`${id}:description:`) ? 'document' : 'table'); if (typeof focusDraft === 'boolean') setReview(focusDraft); } }, [id, focusObjectId, focusDraft, !!data]);
  const [history, setHistory] = useState([]);
  const [objectHistory, setObjectHistory] = useState(null);
  const [compare, setCompare] = useState('');
  const [baseline, setBaseline] = useState('');
  const [showBaseline, setShowBaseline] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const alive = useRef(true);
  const deleting = useRef(false);
  const loadSequence = useRef(0);
  const initialViewId = useRef(null);
  const reload = useCallback(async () => { const sequence = ++loadSequence.current; const next = await loadArtifact(id, update => { if (alive.current && sequence === loadSequence.current) setLoadProgress(update); }); if (next.meta.programId) next.project = { program: (await listEngineeringProjects()).find(program => program.id === next.meta.programId) }; if (alive.current && sequence === loadSequence.current) { if (initialViewId.current !== id) { initialViewId.current = id; setDiagramFocus(null); setView(next.meta.templateId === 'architecture' ? 'diagram' : next.meta.templateId === 'hazard-tracking-list' ? 'table' : 'outline'); } setData(next); } }, [id]);
  useEffect(() => {
    alive.current = true;
    reload().catch(e => setError(e.message));
    const refresh = () => { if (!deleting.current) reload().catch(e => { if (alive.current) setError(e.message); }); };
    window.addEventListener(ARTIFACT_CHANGED, refresh);
    return () => { alive.current = false; window.removeEventListener(ARTIFACT_CHANGED, refresh); };
  }, [reload]);
  const action = async fn => { setBusy(true); setError(''); try { await fn(); if (alive.current) await reload(); } catch (e) { if (alive.current) setError(e.message); } finally { if (alive.current) setBusy(false); } };
  const generate = (restart = false) => action(() => startGenerationRun(runKey, async options => {
    if (restart) await startProposal(id, data.meta.revision);
    return generateArtifact(id, options);
  }, { title: `Generate artifact: ${data.meta.title}` }));
  const presentation = useMemo(() => {
    if (!data) return null;
  const { meta, revision, job, baselines } = data;
  const objects = revision?.objects || [];
  const proposal = job ? getTemplate(meta.templateId).sections.flatMap(s => job.sections[s.id] || []) : [];
  const completeProposal = job?.state === 'ready';
  const citedDraftSources = new Set(proposal.flatMap(object => object.sourceIds));
  const draftEvidence = (job?.sources.entries || []).filter(source => source.sourceType !== 'project');
  const uncitedDraftCount = draftEvidence.filter(source => !citedDraftSources.has(source.id)).length;
  const proposedObjects = completeProposal ? mergeProposal(objects, proposal) : proposal;
  const showDraft = !!job && (review || (!revision && proposal.length > 0));
  const shown = showDraft ? proposedObjects : objects;
  const ordered = orderedObjects(shown);
  const sources = (showDraft ? job?.sources : revision?.sources)?.entries || [];
    return { meta, revision, job, baselines, objects, proposal, completeProposal, draftEvidence, uncitedDraftCount, proposedObjects, showDraft, shown, ordered, sources };
  }, [data, review]);
  const traceDraft = presentation?.showDraft || false;
  const traceReady = projectTrace?.data === data && projectTrace?.draft === traceDraft;
  useEffect(() => {
    if (view !== 'TRACE' || !data?.meta.programId || traceReady) return;
    const controller = new AbortController();
    setTraceError('');
    setTraceProgress({ progress: 0, label: 'Opening project traceability…' });
    requestProjectLoad(data.meta.programId, { trace: true, draft: traceDraft, signal: controller.signal,
      onProgress: update => { if (!controller.signal.aborted) setTraceProgress({ progress: update.percent, label: update.stage }); }
    }).then(project => {
      if (!controller.signal.aborted) setProjectTrace({ data, draft: traceDraft, project });
    }, error => { if (!controller.signal.aborted) setTraceError(error.message); });
    return () => controller.abort();
  }, [data, view, traceDraft, traceReady, traceAttempt]);
  if (!presentation) return <div className="artifact-editor">{error ? <p role="alert">{error}</p> : <TablePreparationProgress {...loadProgress} />}</div>;
  const { meta, revision, job, baselines, objects, proposal, completeProposal, draftEvidence, uncitedDraftCount, proposedObjects, showDraft, shown, ordered, sources } = presentation;
  const historical = history.find(r => String(r.number) === compare);
  const sourceLabel = sourceId => sources.find(e => e.id === sourceId)?.title || 'Unavailable supporting source';
  const draftingScope = meta.templateId !== 'architecture' && architectureDraftingGuidance(meta.config);
  const manifest = showDraft ? job?.sources : revision?.sources;
  const editingDisabled = busy || data.project?.program?.state === 'generating' || job?.state === 'generating' || (!revision && !showDraft);
  const descriptionSections = view === 'document' && meta.templateId === 'architecture' ? architectureEditableSections(meta, manifest, shown) : [];
  const editableDescriptions = descriptionSections.flatMap(section => [section.object, ...section.paragraphs.map(paragraph => paragraph.object)]);
  const saveShown = rows => showDraft ? saveDraftObjects(id, job, rows) : saveObjects(id, meta.revision, rows);
  const openEdit = (object, field) => {
    if (!object || editingDisabled) return;
    if (meta.templateId === 'hazard-tracking-list' && object.hazardTrackingRow) {
      const attributes = projectHazardTrackingFields(object.attributes);
      object = { ...object, attributes: Object.fromEntries(HAZARD_TRACKING_COLUMNS.map(column => [column, attributes[column] || ''])) };
    }
    const parent = editableDescriptions.find(candidate => candidate.id === object.parentId);
    const baseObjects = parent && !shown.some(candidate => candidate.id === parent.id) ? [...shown, parent] : shown;
    setEdit({ object: { ...object, sourceIds: object.sourceIds || [] }, base: meta.revision, baseObjects, job: showDraft ? job : null, manifest, field });
  };
  return <div className="artifact-editor">
    <header className="artifact-header"><div><p className="artifact-eyebrow">{(meta.templateId === 'architecture' ? meta.config.architectureKind + ' architecture' : getTemplate(meta.templateId).name)} · {meta.config.system}{meta.config.subsystem ? ` / ${meta.config.subsystem}` : ''}</p><h2 title={meta.title}>{meta.title}</h2><p>Revision {meta.revision || '—'} · {meta.freshness === 'current' ? 'Sources current' : meta.freshness === 'stale' ? 'Sources changed — review an update' : 'Sources unavailable'} · Working document</p></div>
    <ArtifactActionsPopover key={id} status={run.running ? (progress || 'Generating draft…') : job ? (completeProposal ? '' : job.state === 'paused' ? 'Draft paused' : 'Draft not complete') : showDraft ? 'Viewing proposal' : ''}>
      {closeActions => <>
    <div className="artifact-actions">{view === 'diagram' && diagramExport && <button disabled={diagramExport.disabled || busy} onClick={() => { closeActions(); diagramExport.run(); }}>{diagramExport.label}</button>}{view === 'diagram' && diagramExport?.restore && <button disabled={diagramExport.disabled || busy} onClick={() => { closeActions(); diagramExport.restore(); }}>Restore source layout</button>}<button disabled={busy || data.project?.program?.state === 'generating'} onClick={() => { closeActions(); setShowDetails(true); }}>Edit details</button><button disabled={actionBusy} onClick={() => { closeActions(); setConfirmDelete(true); }}>Delete artifact</button>{!meta.programId && !isSafetyArtifact(meta.templateId) && <button disabled={busy} onClick={() => { closeActions(); setShowSources(true); }}>Source diagrams</button>}{meta.programId ? <button onClick={() => { closeActions(); onOpenProject?.(meta.programId); }}>Open systems engineering project</button> : <button disabled={busy} onClick={() => { closeActions(); generate(!(meta.templateId === 'hazard-tracking-list' && job && job.state !== 'ready')); }}>{meta.templateId === 'hazard-tracking-list' ? 'Consolidate into actionable HTRs' : 'Generate update'}</button>}{meta.templateId === 'hazard-tracking-list' && job && (meta.freshness === 'stale' || /^Sources changed/.test(error || run.error || job.error || '')) && <button disabled={busy} onClick={() => { closeActions(); generate(true); }}>Start new consolidation</button>}{revision && <select aria-label="Export artifact" value="" disabled={busy} onChange={e => { const format = e.target.value; action(async () => exportArtifact(format, meta, revision, baselines, format === 'json' ? await listRevisions(id) : undefined)); }}><option value="">Export…</option><option value="docx">Word</option><option value="pdf">PDF</option><option value="md">Markdown</option>{meta.templateId === 'hazard-tracking-list' && <option value="csv">CSV table</option>}<option value="json">Backup (JSON)</option></select>}</div>
    {job && <section className="artifact-job"><strong>{job.state === 'ready' ? 'Proposal ready for review' : meta.templateId === 'hazard-tracking-list' ? (job.sections.s2 ? 'Hazard table saved' : 'Hazard table pending') : `${Object.keys(job.sections).length} of ${getTemplate(meta.templateId).sections.length} sections saved${savedPartCount(job) ? ` · ${savedPartCount(job)} partial parts saved` : ''}`}</strong><p role="status">{progress || job.error || (meta.templateId === 'architecture' ? 'Capture the selected diagrams and elements as an architecture proposal. No AI redraw is required.' : meta.templateId === 'hazard-tracking-list' ? 'Build the table from saved hazard analysis and consolidate actionable safety concerns. Expand a hazard to inspect and edit original assessments.' : meta.templateId === 'safety-requirements' ? 'Generate concise requirements from actionable issue summaries and recorded safety constraints. HTR traceability is preserved; missing responsibility or acceptance criteria remain gaps.' : 'Generate the draft using your configured AI provider. You can pause and resume without losing completed sections.')}{run.running && ' You can navigate away while xHandle stays open.'}</p>
      {job.evidenceBrief && completeProposal && <p className="artifact-warning">Drafted from a condensed evidence review. {draftEvidence.length - uncitedDraftCount} of {draftEvidence.length} sources are cited; {uncitedDraftCount} are not cited. Review the full source register for omitted requirements and constraints before accepting. A citation alone does not establish complete coverage. <button onClick={() => { closeActions(); setReview(true); setView('document'); }}>View document and source register</button></p>}
      <div className="artifact-actions">
        {meta.programId && <button onClick={() => { closeActions(); onOpenProject?.(meta.programId); }}>Review project and traceability</button>}
        {run.running ? <button onClick={() => pauseGenerationRun(runKey)}>Pause generation</button> : !completeProposal && !meta.programId && <button className="primary" disabled={busy} onClick={() => generate()}>Generate / resume draft</button>}
        {proposal.length > 0 && <button disabled={!!edit} onClick={() => { closeActions(); setReview(!review); }}>{review ? (revision ? 'Return to accepted document' : 'Close review') : completeProposal ? 'Review proposal' : 'Preview saved sections'}</button>}
        {review && completeProposal && !meta.programId && <button className="primary" disabled={busy} onClick={() => action(async () => { await acceptProposal(id, meta.revision, job.token); setReview(false); closeActions(); })}>Accept proposal</button>}
      </div>
    </section>}
    {showDraft && !completeProposal && <p className="artifact-warning">Partial draft preview — {Object.keys(job.sections).length} of {getTemplate(meta.templateId).sections.length} sections saved. Resume generation to finish the proposal. Saved sections will be reused.</p>}
    {completeProposal && <div className="artifact-warning"><ArtifactComparison before={objects} after={proposedObjects} /> Manually edited objects are preserved. Acceptance creates a new revision; it does not approve engineering claims.</div>}
      </>}
    </ArtifactActionsPopover></header>
    <div className="artifact-status">
    {draftingScope && <p className="text-sm">Drafting at {draftingScope.levels.join(', ')} level. Lower-level implementation detail stays in the linked source evidence; the draft focuses on responsibilities and interfaces at the selected level.</p>}
    {meta.description && <details><summary>Description</summary><p className="artifact-body">{meta.description}</p></details>}
    {(error || run.error) && <p className="artifact-error" role="alert">{error || run.error}</p>}{meta.freshnessError && <p className="artifact-warning">{meta.freshnessError}</p>}{meta.manualReviewRequired > 0 && <p className="artifact-warning">{meta.manualReviewRequired} manual objects retain earlier source evidence. Review their supporting sources before baselining.</p>}
    {!shown.length && <div className="artifact-empty"><h3>{meta.templateId === 'hazard-tracking-list' ? 'Your hazard table starts here' : 'Your document starts here'}</h3><p>{meta.templateId === 'hazard-tracking-list' ? 'Generate the table from saved hazard analysis.' : 'Generate the draft, inspect its sources and unresolved questions, and edit saved objects by double-clicking them.'}</p></div>}
    </div>
    <ArtifactRequirementsViews projectLoading={!!meta.programId && !traceReady} projectProgress={traceProgress} projectError={traceError} onRetryProject={() => setTraceAttempt(attempt => attempt + 1)} project={traceReady ? projectTrace.project : undefined} draft={showDraft} focusObjectId={focusObjectId} meta={meta} revision={revision} objects={shown} manifest={showDraft ? job?.sources : revision?.sources} view={view} setView={setView} editableDescriptions={editableDescriptions} disabled={editingDisabled}
      fileActions={revision && !showDraft ? [
        ...([['docx', 'Export as Word'], ['pdf', 'Export as PDF'], ['md', 'Export as Markdown'], ...(meta.templateId === 'hazard-tracking-list' ? [['csv', 'Export as CSV table']] : []), ['json', 'Download backup (JSON)']]).map(([format, label]) => ({ label, disabled: busy, onSelect: () => action(async () => exportArtifact(format, meta, revision, baselines, format === 'json' ? await listRevisions(id) : undefined)) })),
        { label: 'Create baseline…', disabled: busy, onSelect: () => setShowBaseline(true) },
      ] : []}
      extraActions={[
        { label: 'Edit document details', disabled: busy || data.project?.program?.state === 'generating', onSelect: () => setShowDetails(true) },
        ...(revision && !showDraft ? [{ label: 'Revision history', disabled: busy, onSelect: () => action(async () => setHistory(await listRevisions(id))) }] : []),
      ]}
      onEdit={openEdit}
      onUpdate={(objectId, patch) => action(() => saveShown(shown.map(o => o.id === objectId ? { ...o, ...patch, manual: true } : o)))}
      onHistory={objectId => action(async () => setObjectHistory({ id: objectId, revisions: await listRevisions(id) }))}
      onCommand={(command, objectId, selectedIds) => {
        if (command === 'new') {
          const parent = shown.find(o => o.id === objectId);
          openEdit({ id: `${id}:manual:${newId()}`, sectionId: parent?.sectionId, parentId: objectId || null, title: 'New object', text: '', kind: 'narrative', sourceIds: [], manual: true });
        } else action(() => {
          const targets = command === 'delete' && selectedIds.size ? [...selectedIds] : [objectId];
          const next = targets.reduce((rows, target) => changeArtifactStructure(rows, target, command), shown);
          return saveShown(next);
        });
      }}
      diagram={meta.templateId === 'architecture' && shown.length ? <ArchitectureDiagrams artifactId={meta.id} onExportActionChange={setDiagramExport} manifest={showDraft ? job?.sources : revision?.sources} kind={meta.config.architectureKind} initialDiagramId={diagramFocus?.diagramId} focusId={diagramFocus?.elementId} objects={shown} /> : null}
      document={view === 'document' && (meta.templateId === 'architecture' && shown.length ? <ArchitectureDocument meta={meta} manifest={showDraft ? job?.sources : revision?.sources} objects={shown} draft={showDraft} onOpenDiagram={reference => { setDiagramFocus(reference || null); setView('diagram'); }} /> : !!shown.length && (<ArtifactDocumentLayout sections={[...ordered.filter(o => o.kind === 'section'), { id: 'artifact-source-register', title: 'Source register' }]}><article className="artifact-paper"><div className="artifact-cover"><p>{showDraft ? (completeProposal ? 'PROPOSED UPDATE' : 'PARTIAL DRAFT') : 'ENGINEERING WORKING DOCUMENT'}</p><h1>{meta.title}</h1>{meta.description && <p className="artifact-body">{meta.description}</p>}<p>{meta.config.system}{meta.config.subsystem ? ` / ${meta.config.subsystem}` : ''}</p>{meta.config.endpointA && <p>{meta.config.endpointA} ↔ {meta.config.endpointB}</p>}<p>Revision {meta.revision} · {new Date(meta.updatedAt).toLocaleDateString()}</p></div>{ordered.map(o => <section key={o.id} id={o.id} data-artifact-object-id={o.id} tabIndex={0} className={`artifact-object ${o.kind === 'gap' ? 'artifact-gap' : ''}`}>{o.kind === 'section' ? <><h2 data-object-field="Title">{o.title}</h2>{o.text && <p data-object-field="Description" className="artifact-body">{o.text}</p>}</> : <><div className="artifact-object-title"><h3 data-object-field="Title">{o.title}</h3>{<button aria-label={`Edit ${o.title}`} disabled={editingDisabled} onClick={() => openEdit(o)}>Edit</button>}</div><p data-object-field="Description" className="artifact-body">{artifactObjectText(o)}</p>{o.content?.type === 'image' && <img src={o.content.image?.dataUrl} alt={o.content.image?.name || o.title} className="max-w-full" />}{o.content?.type === 'table' && <MiniTable cells={o.content.table?.cells} />}<small>{o.kind}{o.manual ? ' · Manually edited' : ''}</small>{o.manual && o.evidenceHash && o.evidenceHash !== (showDraft ? job?.sources.hash : revision?.sourceHash) && <p className="artifact-warning">This manual object retains evidence from an earlier revision. Review it against the changed sources.</p>}{!!o.sourceIds.length && <div className="artifact-citations">Sources: {o.sourceIds.map(s => <details key={s}><summary>{(o.sourceEvidence || []).find(e => e.id === s)?.title || sourceLabel(s)}</summary><ArchitectureEvidence source={(o.sourceEvidence || []).find(e => e.id === s) || sources.find(e => e.id === s)} manifest={showDraft ? job?.sources : revision?.sources} objects={shown} /></details>)}</div>}</>}</section>)}<h2 id="artifact-source-register">Source register</h2>{sources.map(s => <details id={`source-${s.id}`} key={s.id}><summary>{s.title || 'Untitled source'}</summary><ArchitectureEvidence source={s} manifest={showDraft ? job?.sources : revision?.sources} objects={shown} /></details>)}</article></ArtifactDocumentLayout>))} />
    {showDetails && <DocumentDetailsDialog key={id} meta={meta} onClose={() => setShowDetails(false)} />}
    {showBaseline && <div className="artifact-modal" role="dialog" aria-modal="true" aria-label="Create artifact baseline"><form className="artifact-form" onSubmit={event => { event.preventDefault(); action(async () => { await createBaseline(id, meta.revision, baseline); setBaseline(''); setShowBaseline(false); }); }}><h2>Create baseline</h2><label>Name<input autoFocus required maxLength={200} value={baseline} onChange={event => setBaseline(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<div className="artifact-actions"><button type="button" disabled={busy} onClick={() => setShowBaseline(false)}>Cancel</button><button disabled={busy || !baseline.trim()}>Save baseline</button></div></form></div>}
    {showSources && <ArchitectureSourcesDialog meta={meta} onClose={() => setShowSources(false)} onSaved={() => { setReview(false); reload().catch(e => setError(e.message)); }} />}
    {objectHistory && <Modal title="Object history" onClose={() => setObjectHistory(null)}>{objectHistory.revisions.map(record => {
      const object = record.objects.find(o => o.id === objectHistory.id);
      return object && <div key={record.number} className="border-b py-3"><strong>Revision {record.number} · {object.title}</strong><p>{record.createdAt} · {object.deleted ? 'Deleted' : object.status || 'Proposed'}</p><p className="whitespace-pre-wrap">{artifactObjectText(object)}</p></div>;
    })}</Modal>}
    {revision && !showDraft && <section className="artifact-history"><div className="artifact-actions">{meta.templateId !== 'hazard-tracking-list' && <button disabled={busy} onClick={() => { const section = objects.find(o => o.kind === 'section' && !o.deleted); openEdit({ id: `${id}:manual:${newId()}`, sectionId: section?.sectionId || 'manual', parentId: section?.id || null, title: 'New object', text: '', kind: 'narrative', sourceIds: [], manual: true }); }}>Add object</button>}<input aria-label="Baseline name" placeholder="Baseline name" value={baseline} onChange={e => setBaseline(e.target.value)} /><button disabled={busy || !baseline.trim()} onClick={() => action(async () => { await createBaseline(id, meta.revision, baseline); setBaseline(''); })}>Create baseline</button><button disabled={busy} onClick={() => action(async () => setHistory(await listRevisions(id)))}>Revision history</button></div>
      {!!baselines.length && <p>Baselines: {baselines.map(b => `${b.label} (r${b.revision})`).join(' · ')}</p>}{!!history.length && <label>Compare current revision with<select value={compare} onChange={e => setCompare(e.target.value)}><option value="">Choose revision</option>{history.map(r => <option key={r.number} value={r.number}>Revision {r.number} — {r.reason}</option>)}</select></label>}{historical && <ArtifactComparison historical before={historical.objects} after={objects} />}
    </section>}
    {edit && <div className="artifact-modal" role="dialog" aria-modal="true" aria-label="Edit artifact object"><form className="artifact-form" onSubmit={e => { e.preventDefault(); action(async () => { const object = { ...edit.object, manual: true, ...(edit.object.sourceIds.length ? { evidenceIssue: undefined } : {}) }; const rows = edit.baseObjects.some(o => o.id === object.id) ? edit.baseObjects.map(o => o.id === object.id ? object : o) : [...edit.baseObjects, object]; if (edit.job) await saveDraftObjects(id, edit.job, rows); else await saveObjects(id, edit.base, rows); setEdit(null); }); }}><h2>{edit.object.hazardTrackingRow ? 'Edit assessment' : 'Edit object'}</h2>{!edit.object.hazardTrackingRow && <><label>Title<input autoFocus={!edit.field || edit.field === "Title"} required value={edit.object.title} maxLength={300} onChange={e => setEdit({ ...edit, object: { ...edit.object, title: e.target.value } })} /></label><label>Parent object<select value={edit.object.parentId || ''} onChange={e => { const section = edit.baseObjects.find(o => o.id === e.target.value); setEdit({ ...edit, object: { ...edit.object, parentId: section?.id || null, sectionId: section?.sectionId || edit.object.sectionId } }); }}><option value="">Top level</option>{edit.baseObjects.filter(o => !o.deleted && o.id !== edit.object.id).map(o => <option key={o.id} value={o.id}>{o.title}</option>)}</select></label><label>Object kind<select autoFocus={edit.field === "Kind"} value={edit.object.kind} onChange={e => setEdit({ ...edit, object: { ...edit.object, kind: e.target.value } })}>{['section', 'narrative', 'requirement', 'decision', 'gap', 'interface', 'diagram', 'architecture-element'].map(kind => <option key={kind}>{kind}</option>)}</select></label><fieldset><legend>Supporting sources</legend><div className="artifact-source-picker">{(edit.manifest?.entries || []).map(source => <label key={source.id}><input type="checkbox" checked={edit.object.sourceIds.includes(source.id)} onChange={e => { const sourceIds = e.target.checked ? [...edit.object.sourceIds, source.id] : edit.object.sourceIds.filter(s => s !== source.id); setEdit({ ...edit, object: { ...edit.object, sourceIds, evidenceHash: edit.manifest.hash, sourceEvidence: sourceIds.map(s => edit.manifest.entries.find(entry => entry.id === s)).filter(Boolean) } }); }} />{source.title}</label>)}</div></fieldset><label>Content<textarea autoFocus={edit.field === "Description"} rows={10} maxLength={16000} value={edit.object.text} onChange={e => setEdit({ ...edit, object: { ...edit.object, text: e.target.value } })} /></label><label>Status<select value={edit.object.status || 'Proposed'} onChange={e => setEdit({ ...edit, object: { ...edit.object, status: e.target.value } })}>{['Proposed', 'Approved', 'Rejected'].map(status => <option key={status}>{status}</option>)}</select></label></>}{Object.entries(edit.object.attributes || {}).filter(([, value]) => typeof value === 'string' || typeof value === 'number').map(([key, value]) => <label key={key}>{key}<input autoFocus={edit.field === key} type={typeof value === 'number' ? 'number' : 'text'} value={value} onChange={e => setEdit({ ...edit, object: { ...edit.object, attributes: { ...edit.object.attributes, [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value } } })} /></label>)}<p>Manual edits are preserved when future proposals are accepted.</p>{error && <p role="alert" className="artifact-error">{error}</p>}<div className="artifact-actions"><button type="button" disabled={busy} onClick={() => setEdit(null)}>Cancel</button><button disabled={busy} className="primary">Save object</button></div></form></div>}
    {confirmDelete && <div className="artifact-modal" role="dialog" aria-modal="true" aria-label="Delete artifact"><div className="artifact-form"><h2>Delete {meta.title}?</h2><p>This removes this artifact, its drafts, revisions and baselines. Its source modules remain available.{meta.programId && ' It also removes this artifact from the project; other artifacts are kept.'}</p><div className="artifact-actions"><button onClick={() => setConfirmDelete(false)}>Cancel</button><button disabled={actionBusy} onClick={async () => {
      deleting.current = true; setBusy(true); setError('');
      pauseGenerationRun(runKey);
      if (meta.programId) pauseGenerationRun(`project:${meta.programId}`);
      try {
        await deleteArtifact(id); setConfirmDelete(false);
        if (meta.programId && onOpenProject) onOpenProject(meta.programId); else onDeleted?.();
      } catch (error) { if (alive.current) setError(error.message); }
      finally { deleting.current = false; if (alive.current) setBusy(false); }
    }}>Permanently delete artifact</button></div></div></div>}
  </div>;
}
