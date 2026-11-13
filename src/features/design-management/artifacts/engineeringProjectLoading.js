import { openArtifactDatabase } from './artifactRepository';
import { artifactJobSummary } from './artifactJobSummary';
import { engineeringProjectTrace, ENGINEERING_PROJECT_TYPE } from './engineeringProjectModel';

const report = (onProgress, percent, stage) => onProgress?.({ percent, stage });
// Runs in the artifact worker in production. Old records are summarized once,
// without reading revisions, baselines, or sending evidence to the UI thread.
export async function readProjectOverview(id, onProgress) {
  report(onProgress, 0, 'Opening project');
  const db = await openArtifactDatabase();
  try {
    const tx = db.transaction(['metadata', 'jobs'], 'readwrite');
    const store = tx.objectStore('metadata'), program = await store.get(id);
    if (!program || program.deleted || program.recordType !== ENGINEERING_PROJECT_TYPE) throw new Error('This systems engineering project no longer exists.');
    report(onProgress, 10, 'Reading document summaries');
    const records = [];
    for (const member of program.members) {
      let meta = await store.get(member.id);
      if (!meta || meta.deleted) throw new Error('A project document is missing. Reload the project.');
      if (meta.draftSummary === undefined) {
        meta = { ...meta, draftSummary: artifactJobSummary(await tx.objectStore('jobs').get(member.id)) };
        await store.put(meta);
      }
      records.push({ meta });
      report(onProgress, 10 + Math.floor(records.length / program.members.length * 85), `Read ${records.length} of ${program.members.length} document summaries`);
    }
    await tx.done;
    report(onProgress, 100, 'Project ready');
    return { program, records };
  } finally { db.close(); }
}

export async function readProjectTrace(id, onProgress, sourceNodeId, draft) {
  report(onProgress, 0, 'Opening saved traceability');
  const db = await openArtifactDatabase();
  try {
    const tx = db.transaction(['metadata', 'jobs', 'revisions']);
    const program = await tx.objectStore('metadata').get(id);
    if (!program || program.deleted || program.recordType !== ENGINEERING_PROJECT_TYPE) throw new Error('This systems engineering project no longer exists.');
    const includeDraft = draft ?? (program.state === 'ready');
    const records = [];
    // Sequential reads bound peak structured-clone work; baselines are not used.
    for (const member of program.members) {
      const meta = await tx.objectStore('metadata').get(member.id);
      if (!meta || meta.deleted) throw new Error('A project document is missing. Reload the project.');
      const revision = meta.revision ? await tx.objectStore('revisions').get(`${meta.id}:${meta.revision}`) : null;
      const job = includeDraft ? await tx.objectStore('jobs').get(member.id) : null;
      records.push({ meta, revision, job });
      report(onProgress, Math.floor(records.length / program.members.length * 80), `Read ${records.length} of ${program.members.length} documents`);
    }
    await tx.done;
    report(onProgress, 85, 'Preparing traceability links');
    const graph = engineeringProjectTrace(program, records, includeDraft);
    if (sourceNodeId) {
      const source = graph.nodes.find(node => node.id === sourceNodeId)?.evidence;
      if (!source) throw new Error('This source changed. Reopen traceability to review the current source.');
      const entries = records.flatMap(record => (record.job?.state === 'ready' ? record.job.sources : record.revision?.sources)?.entries || [])
        .filter(entry => (entry.id === source.diagramId || entry.diagramId === source.diagramId) && entry.diagramHash === source.diagramHash);
      report(onProgress, 100, 'Source ready');
      return { source, manifest: { entries } };
    }
    // Evidence is loaded explicitly when a source is inspected, never as part of
    // the graph's list rows. Preserve stable node IDs and all links/gaps.
    const titles = new Map(records.map(record => [record.meta.id, record.meta.title]));
    graph.projectTitle = program.title;
    graph.nodes = graph.nodes.map(({ evidence, ...node }) => ({ ...node, hasEvidence: !!evidence, moduleTitle: evidence?.diagramTitle || titles.get(node.artifactId), ...(evidence?.diagramId ? { hasArchitectureEvidence: true } : {}) }));
    report(onProgress, 100, 'Traceability ready');
    return graph;
  } finally { db.close(); }
}
