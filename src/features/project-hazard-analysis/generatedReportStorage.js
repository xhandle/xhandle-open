import { wrap } from 'idb';
import shajs from 'sha.js';
import { notifyBackupDataChanged } from '../../lib/localBackupEvents';

export const GENERATED_REPORT_DB = 'xhandle-generated-reports';
export const GENERATED_REPORT_CHANGED = 'xhandle:generated-report-changed';
const projectKey = (value) => String(value ?? '').trim();
const blockedProjects = new Set();
const pendingWrites = new Map();

export function openGeneratedReportDatabase() {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, db) => {
      if (finished) { db?.close(); return; }
      finished = true; clearTimeout(timer);
      if (error) reject(error); else { db.onversionchange = () => db.close(); resolve(wrap(db)); }
    };
    const timer = setTimeout(() => finish(new Error('Opening the reports library timed out. Close other xHandle windows and retry.')), 10000);
    try {
      const request = indexedDB.open(GENERATED_REPORT_DB, 1);
      request.onupgradeneeded = () => {
        if (finished) { request.transaction.abort(); return; }
        for (const name of ['metadata', 'reports']) {
          const store = request.result.createObjectStore(name, { keyPath: 'id' });
          store.createIndex('projectId', 'projectId');
        }
      };
      request.onblocked = () => finish(new Error('Reports storage is blocked. Close other xHandle windows and retry.'));
      request.onerror = () => finish(request.error || new Error('Reports storage is unavailable.'));
      request.onsuccess = () => finish(null, request.result);
    } catch (error) { finish(error); }
  });
}

function changed(projectId) {
  notifyBackupDataChanged({ source: 'generated-reports', projectId });
  window.dispatchEvent(new CustomEvent(GENERATED_REPORT_CHANGED, { detail: { projectId } }));
}

export async function listGeneratedReports(projectId) {
  const db = await openGeneratedReportDatabase();
  try {
    const rows = await db.getAllFromIndex('metadata', 'projectId', projectKey(projectId));
    return rows.filter((row) => !row.deleted).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  } finally { db.close(); }
}

export async function readGeneratedReport(projectId, id) {
  const db = await openGeneratedReportDatabase();
  try {
    const row = await db.get('reports', id);
    return row?.projectId === projectKey(projectId) ? { ...row, libraryId: row.id, libraryLoaded: true } : null;
  } finally { db.close(); }
}

export function saveGeneratedReport(projectId, value, { id } = {}) {
  const projectIdKey = projectKey(projectId);
  const work = (async () => {
    if (!projectIdKey || blockedProjects.has(projectIdKey)) throw new Error('This project is no longer available for saving reports.');
    const report = String(value.report ?? value.markdown ?? '').trim();
    if (!report) throw new Error('An empty report cannot be saved.');
    const date = new Date(value.generatedAt || Date.now());
    const createdAt = Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
    const reportId = id || window.crypto?.randomUUID?.() || `report-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const record = {
      id: reportId, projectId: projectIdKey, report, createdAt, generatedAt: createdAt,
      title: String(value.title || value.reportType || 'Saved report').slice(0, 160),
      reportType: String(value.reportType || 'Saved report'),
      status: value.status === 'draft' ? 'draft' : 'complete',
      functionalDiagramImage: typeof value.functionalDiagramImage === 'string' ? value.functionalDiagramImage : null,
    };
    const { functionalDiagramImage, report: body, ...metadata } = record;
    const db = await openGeneratedReportDatabase();
    try {
      if (blockedProjects.has(projectIdKey)) throw new Error('This project is no longer available for saving reports.');
      const tx = db.transaction(['metadata', 'reports'], 'readwrite');
      try {
        await tx.objectStore('reports').add(record);
        await tx.objectStore('metadata').add(metadata);
        await tx.done;
      } catch (error) {
        try { tx.abort(); } catch {}
        await tx.done.catch(() => {});
        throw error;
      }
      changed(projectIdKey);
      return { ...record, libraryId: record.id, libraryLoaded: true };
    } finally { db.close(); }
  })();
  const pending = pendingWrites.get(projectIdKey) || new Set();
  pending.add(work); pendingWrites.set(projectIdKey, pending);
  work.finally(() => { pending.delete(work); if (!pending.size) pendingWrites.delete(projectIdKey); }).catch(() => {});
  return work;
}

export async function preserveLegacyGeneratedReport(projectId, legacy) {
  const report = String(legacy?.report ?? legacy?.markdown ?? legacy?.text ?? legacy?.content ?? '').trim();
  if (!report) return null;
  const id = legacy.libraryId || `legacy:${projectKey(projectId)}:${shajs('sha256').update(report).digest('hex')}`;
  const existing = await readGeneratedReport(projectId, id);
  if (existing) return existing;
  const db = await openGeneratedReportDatabase();
  try {
    const metadata = await db.get('metadata', id);
    // A stale project-cache copy must not resurrect an explicitly deleted
    // report after a restart. This marker retains no report text or image.
    if (metadata?.deleted && metadata.projectId === projectKey(projectId)) return { deleted: true, libraryId: id };
  } finally { db.close(); }
  try { return await saveGeneratedReport(projectId, { ...legacy, report,
    reportType: legacy.reportType || legacy.state?.reportType || 'Saved report' }, { id }); }
  catch (error) {
    // Concurrent tabs may migrate the same legacy entry. Never overwrite it.
    const migrated = await readGeneratedReport(projectId, id);
    if (migrated) return migrated;
    throw error;
  }
}

export async function deleteGeneratedReport(projectId, id) {
  const db = await openGeneratedReportDatabase();
  try {
    const tx = db.transaction(['metadata', 'reports'], 'readwrite');
    const row = await tx.objectStore('metadata').get(id);
    if (row?.projectId !== projectKey(projectId)) { await tx.done; return false; }
    await tx.objectStore('metadata').put({ id, projectId: row.projectId, deleted: true, createdAt: new Date().toISOString() });
    await tx.objectStore('reports').delete(id);
    await tx.done; changed(projectKey(projectId)); return true;
  } finally { db.close(); }
}

export async function blockGeneratedReportWrites(projectId, blocked = true) {
  const key = projectKey(projectId);
  if (!blocked) { blockedProjects.delete(key); return; }
  blockedProjects.add(key);
  await Promise.allSettled([...(pendingWrites.get(key) || [])]);
}
