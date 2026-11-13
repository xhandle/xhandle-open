import DocumentDetailsDialog from './DocumentDetailsDialog';
import { isSafetyArtifact } from './safetyArtifactTypes';
import { generationProgressSummary, generationStageLabel } from './generationProgress';
import TablePreparationProgress from '../../code-architecture-assurance/TablePreparationProgress';
import PagedDetails from './PagedDetails';
import { requestProjectLoad } from './requestProjectLoad';
import { startGenerationRun, pauseGenerationRun, useGenerationRun } from './generationRuns';
import { engineeringProjectReport } from './engineeringProjectReport';
import { ownerLabel, relationshipLabel } from './SourceEvidenceDetails';
import { ArchitectureEvidence } from './ArchitectureDiagramView';
import { Modal } from '../../requirements/components/RequirementsViews';
import { getTemplate } from './artifactModel';
import ArchitectureSourcesDialog from './ArchitectureSourcesDialog';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ARTIFACT_CHANGED } from './artifactRepository';
import { availableProjects, ownerKey } from './artifactSources';
import { acceptEngineeringProject, deleteEngineeringProject, exportEngineeringProject } from './engineeringProjectRepository';
import { generateEngineeringProject } from './engineeringProjectGeneration';

export default function EngineeringProjectEditor({ id, onOpenArtifact, onDeleted }) {
  const [traceSource, setTraceSource] = useState(null);
  const [showSources, setShowSources] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [data, setData] = useState(null), [error, setError] = useState(''), [actionBusy, setBusy] = useState(false);
  const [tab, setTab] = useState('Documents'), [review, setReview] = useState(false), [filter, setFilter] = useState(''), [limit, setLimit] = useState(100), [confirmDelete, setConfirmDelete] = useState(false);
  const runKey = `project:${id}`, run = useGenerationRun(runKey);
  const busy = actionBusy || run.running, progress = run.progress;
  const alive = useRef(true), sequence = useRef(0), loading = useRef(null);
  const [loadProgress, setLoadProgress] = useState({ percent: 0, stage: 'Opening project' });
  const [trace, setTrace] = useState(null), [traceError, setTraceError] = useState('');
  const [traceProgress, setTraceProgress] = useState({ percent: 0, stage: 'Opening saved traceability' });
  const [traceRetry, setTraceRetry] = useState(0);
  const sourceRequest = useRef(null);
  const reload = useCallback(async () => {
    const version = ++sequence.current;
    setError('');
    loading.current?.abort(); const controller = new AbortController(); loading.current = controller;
    try {
      const value = await requestProjectLoad(id, { signal: controller.signal, onProgress: value => {
        if (alive.current && version === sequence.current) setLoadProgress(value);
      } });
      if (alive.current && version === sequence.current) { setData(value); setError(''); }
    } catch (error) {
      if (error.name !== 'AbortError' && alive.current && version === sequence.current) setError(error.message);
    }
  }, [id]);
  useEffect(() => {
    alive.current = true; setData(null); setError(''); setTab('Documents'); setReview(false); setTraceSource(null);
    setLoadProgress({ percent: 0, stage: 'Opening project' }); reload();
    let timer;
    const update = () => { clearTimeout(timer); timer = setTimeout(reload, 75); };
    window.addEventListener(ARTIFACT_CHANGED, update);
    return () => { alive.current = false; clearTimeout(timer); loading.current?.abort(); sourceRequest.current?.abort(); window.removeEventListener(ARTIFACT_CHANGED, update); };
  }, [reload]);
  const traceKey = data?.program.id === id ? JSON.stringify([id, data.program.version, data.program.state,
    data.records.map(({ meta }) => [meta.id, meta.revision, meta.updatedAt, meta.draftSummary])]) : '';
  useEffect(() => {
    setTrace(null); setTraceError('');
    if (tab !== 'Traceability' || !traceKey) return;
    const controller = new AbortController();
    setTraceProgress({ percent: 0, stage: 'Opening saved traceability' });
    requestProjectLoad(id, { trace: true, signal: controller.signal, onProgress: value => { if (!controller.signal.aborted) setTraceProgress(value); } })
      .then(graph => { if (!controller.signal.aborted) setTrace(graph); })
      .catch(error => { if (!controller.signal.aborted) setTraceError(error.message); });
    return () => controller.abort();
  }, [id, tab, traceKey, traceRetry]);
  const graph = trace || { nodes: [], links: [], gaps: [] };
  const nodes = useMemo(() => new Map((trace?.nodes || []).map(node => [node.id, node])), [trace]);
  const edges = useMemo(() => (trace?.links || []).filter(edge => `${edge.type} ${nodes.get(edge.from)?.title} ${nodes.get(edge.to)?.title}`.toLowerCase().includes(filter.toLowerCase())), [trace, nodes, filter]);
  const inspectSource = async nodeId => {
    sourceRequest.current?.abort(); const controller = new AbortController(); sourceRequest.current = controller;
    setTraceSource({ progress: { percent: 0, stage: 'Opening supporting source' } });
    try {
      const value = await requestProjectLoad(id, { trace: true, sourceNodeId: nodeId, signal: controller.signal,
        onProgress: progress => { if (!controller.signal.aborted) setTraceSource({ progress }); } });
      if (!controller.signal.aborted) setTraceSource(value);
    } catch (error) { if (!controller.signal.aborted) setTraceSource({ error: error.message }); }
  };
  const action = async fn => { setBusy(true); setError(''); try { await fn(); if (alive.current) await reload(); } catch (error) { if (alive.current) setError(error.message); } finally { if (alive.current) { setBusy(false); } } };
  const generate = reset => action(() => { setReview(false); return startGenerationRun(runKey, options => generateEngineeringProject(id, { reset, ...options }), { title: `Generate project: ${data.program.title}` }); });
  if (!data || data.program.id !== id) return error ? <div role="alert"><p>{error}</p><button onClick={reload}>Retry loading project</button></div>
    : <TablePreparationProgress label={`Loading systems engineering project · ${loadProgress.stage}`} progress={loadProgress.percent} />;
  const { program, records } = data;
  const projects = (() => { try { return availableProjects(); } catch { return []; } })();
  const nodeLabel = node => node?.type === 'owning-project' ? projects.find(project => ownerKey(project) === ownerKey(node.owner))?.name || node.title : node?.title;
  const renderNode = nodeId => { const node = nodes.get(nodeId); const artifactId = node?.artifactId || (node?.type === 'artifact' ? node.id : null); return node?.hasArchitectureEvidence ? <button className="text-indigo-700 underline text-left" onClick={() => inspectSource(nodeId)}>{nodeLabel(node)}</button> : artifactId && !node.historical ? <button className="text-indigo-700 underline text-left" onClick={() => onOpenArtifact(artifactId, node.objectId || (node.type === 'artifact' ? null : node.id))}>{nodeLabel(node)}</button> : <span>{nodeLabel(node) || nodeId}</span>; };
  const download = (backup = false) => action(async () => { const contents = await exportEngineeringProject(id); const url = URL.createObjectURL(new Blob([backup ? JSON.stringify(contents, null, 2) : engineeringProjectReport(contents)], { type: backup ? 'application/json' : 'text/html' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${program.title.replace(/[^a-z0-9_-]+/gi, '-')}.${backup ? 'json' : 'html'}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  return <div className="artifact-editor">
    {traceSource && <Modal title="Architecture source trace" onClose={() => { sourceRequest.current?.abort(); setTraceSource(null); }}>
      {traceSource.progress ? <TablePreparationProgress label={traceSource.progress.stage} progress={traceSource.progress.percent} />
        : traceSource.error ? <p role="alert">{traceSource.error}</p> : <ArchitectureEvidence source={traceSource.source} manifest={traceSource.manifest} />}</Modal>}
    {showDetails && <DocumentDetailsDialog key={id} meta={program} onClose={() => setShowDetails(false)} />}
    {showSources && <ArchitectureSourcesDialog meta={program} onClose={() => setShowSources(false)} onSaved={() => setReview(false)} />}
    <header className="artifact-header"><div><p className="artifact-eyebrow">Systems engineering project</p><h2 title={program.title}>{program.title}</h2><p>{program.config.system} · {records.length} documents · {program.state}</p></div><div className="artifact-actions"><button disabled={busy} onClick={() => setShowDetails(true)}>Edit details</button>{records.some(record => !isSafetyArtifact(record.meta.templateId)) && <button disabled={busy} onClick={() => setShowSources(true)}>Source diagrams</button>}<button disabled={busy} onClick={() => download()}>Export project and traceability</button><button disabled={busy} onClick={() => download(true)}>Download project backup (JSON)</button><button disabled={busy} onClick={() => setConfirmDelete(true)}>Delete project</button></div></header>
    <div className="artifact-status">
    {program.description && <details><summary>Description</summary><p className="artifact-body">{program.description}</p></details>}
    <details className="project-owner-details"><summary>Derived from {program.ownerProjects.map(owner => ownerLabel(owner)).join(', ')}</summary>{program.ownerProjects.map(owner => <p key={ownerKey(owner)}>{ownerLabel(owner)} · {owner.workspaceType === 'code-architecture' ? 'Code-based architecture' : 'Project diagrams'}</p>)}</details>
    {(error || run.error || program.error) && <p role="alert" className="artifact-error">{error || run.error || program.error}</p>}
    <section className="artifact-job"><p role="status">{progress || (program.state === 'ready' ? 'All selected documents are ready. Review the document set and traceability before accepting.' : 'Generate the selected documents in dependency order. Saved sections are reused when you resume.')}{run.running && ' You can navigate away while xHandle stays open.'}</p>
      {run.running && <div className="my-2 rounded border border-indigo-200 bg-white/70 p-3" aria-label="Project generation progress">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><strong className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-indigo-600 animate-pulse" aria-hidden="true" />{generationStageLabel(run.details?.stage)}</strong><span>{generationProgressSummary(run.details)}</span></div>
        {run.details?.documentTitle && <p className="mt-1 text-sm">Document {run.details.documentIndex} of {run.details.totalDocuments}: <button className="underline text-indigo-700" onClick={() => onOpenArtifact(run.details.artifactId)}>{run.details.documentTitle}</button>{run.details.sectionTitle ? ` · ${run.details.sectionTitle}` : ''}{run.details.partTitle ? ` · ${run.details.partTitle}` : ''}</p>}
        {!!run.details?.totalSections && <progress className="mt-2 h-2 w-full accent-indigo-600" aria-label="Saved project sections" value={run.details.completedSections || 0} max={run.details.totalSections} />}
        {run.details?.retryReason && <p className="mt-1 text-xs text-amber-800">{run.details.retryReason}{run.details.retryDelaySeconds ? ` · retrying in ${run.details.retryDelaySeconds} seconds` : ''}. Saved work is retained.</p>}
      </div>}
      <div className="artifact-actions">
      {run.running ? <button onClick={() => pauseGenerationRun(runKey)}>Pause project generation</button> : <><button className="primary" onClick={() => generate(false)} disabled={busy || program.state === 'ready' || program.state === 'accepted'}>Generate / resume project</button><button disabled={busy} onClick={() => generate(true)}>Generate fresh update</button></>}
      {program.state === 'ready' && <button disabled={busy} onClick={() => { setReview(true); setTab('Traceability'); }}>Review project proposal</button>}
      {review && program.state === 'ready' && <button className="primary" disabled={busy || !trace} onClick={() => action(async () => { await acceptEngineeringProject(id, program.version, program.runToken); setReview(false); })}>Accept complete project</button>}
    </div></section>
    </div>
    <div className="project-view-tabs inline-flex rounded border my-3">{['Documents', 'Traceability'].map(value => <button key={value} aria-pressed={tab === value} className={`px-3 py-2 ${tab === value ? 'bg-gray-900 text-white' : ''}`} onClick={() => setTab(value)}>{value}</button>)}</div>
    <div className="design-view-scroll" role="region" aria-label="Project content" tabIndex={0}>
    {tab === 'Documents' && <div className="overflow-auto rounded border"><table className="w-full text-sm"><thead className="bg-gray-50 text-left"><tr><th className="p-3">Document</th><th>Scope</th><th>Saved draft sections</th><th>Accepted revision</th><th>Source status</th></tr></thead><tbody>{records.map(record => <tr key={record.meta.id} className={`border-t ${run.running && run.details?.artifactId === record.meta.id ? 'bg-indigo-50' : ''}`}><td className="p-3"><button className="text-indigo-700 underline" onClick={() => onOpenArtifact(record.meta.id)}>{record.meta.title}</button></td><td>{record.meta.config.subsystem || [record.meta.config.endpointA, record.meta.config.endpointB].filter(Boolean).join(' ↔ ') || record.meta.config.system}</td><td>{record.meta.draftSummary ? `${record.meta.draftSummary.completedSections} / ${getTemplate(record.meta.templateId).sections.length}${record.meta.draftSummary.partialParts ? ` · ${record.meta.draftSummary.partialParts} partial parts saved` : ''} · ${record.meta.draftSummary.state}` : '—'}</td><td>{record.meta.revision || '—'}</td><td>{record.meta.freshness}</td></tr>)}</tbody></table></div>}
    {tab === 'Traceability' && !trace && (traceError ? <div role="alert"><p>{traceError}</p><button onClick={() => setTraceRetry(value => value + 1)}>Retry loading traceability</button></div> : <TablePreparationProgress label={traceProgress.stage} progress={traceProgress.percent} />)}
    {tab === 'Traceability' && trace && <><p className="my-2">{graph.nodes.length} nodes · {graph.links.length} links · {graph.gaps.length} unresolved coverage items</p><p className="text-sm text-gray-600">“Uses drafting input” records document dependencies. “Refines” links cite specific source objects. Ownership links identify the selected source projects; they do not establish verification or compliance.</p><label className="block my-3">Filter traceability<input className="block border rounded p-2 w-full" value={filter} onChange={e => { setFilter(e.target.value); setLimit(100); }} /></label><div className="overflow-auto rounded border"><table className="w-full text-sm"><thead className="bg-gray-50 text-left"><tr><th className="p-3">From</th><th>Relationship</th><th>To</th></tr></thead><tbody>{edges.slice(0, limit).map(edge => <tr className="border-t" key={edge.id}><td className="p-3">{renderNode(edge.from)}</td><td className="p-3">{relationshipLabel(edge.type)}</td><td className="p-3">{renderNode(edge.to)}</td></tr>)}</tbody></table></div>{edges.length > limit && <button className="border rounded p-2" onClick={() => setLimit(limit + 100)}>Show more links</button>}
      {!!graph.gaps.length && <PagedDetails title={`Unresolved traceability and evidence (${graph.gaps.length})`} items={graph.gaps} renderItem={(gap, index) => <p key={index}><button className="underline" onClick={() => onOpenArtifact(gap.artifactId, gap.objectId)}>{gap.message}</button></p>} />}</>}
    </div>
    {confirmDelete && <div className="artifact-modal" role="dialog" aria-modal="true" aria-label="Delete systems engineering project"><div className="artifact-form"><h2>Delete {program.title}?</h2><p>This removes its generated documents, revisions and drafts. Owning projects and source modules are retained.</p><div className="artifact-actions"><button onClick={() => setConfirmDelete(false)}>Cancel</button><button disabled={busy} onClick={() => action(async () => { await deleteEngineeringProject(id); onDeleted(); })}>Delete complete project</button></div></div></div>}
  </div>;
}
