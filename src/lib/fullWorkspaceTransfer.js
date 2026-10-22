import { openDB } from 'idb';
import { backendURL, ACCOUNT_ID } from './api/backendConfig';
import { pauseBackupsForWorkspaceTransfer } from './localBackupService';
import { notifyBackupDataChanged } from './localBackupEvents';
import { encodeWorkspace, decodeWorkspace, workspaceDigest } from './workspaceTransferCodec';
import { TRANSFER_RECOVERY_DB, readTransferDatabases, preflightTransferDatabases, validateTransferDatabases, writeTransferDatabases } from './workspaceTransferStorage';

const FORMAT = 'xhandle-full-workspace', VERSION = 2;
const PENDING_KEY = 'xhandle.workspaceTransfer.pending.v2';
const reserved = key => key === PENDING_KEY || /^xhandle\.backup\.(settings|status)\.v1$/.test(key);
const secret = key => ['githubToken','jiraToken','xhandle.localAIProviderSettings','xhandle.aiProvider.keys'].includes(key) || /(?:^|[.:_-])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credentials?)(?:$|[.:_-])|^(?:google|github|jira).*Token$/i.test(key);
let active = false;
const progress = callback => (message, percent) => callback?.(message, percent);
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));
async function api(action, data) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
  const response = await fetch(`${backendURL}/api/workspace-transfer/${action}`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'x-account-id': ACCOUNT_ID }, body: JSON.stringify(data) });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'Full workspace transfer needs a running, compatible local xHandle API server. Update both installations and retry.');
  return result;
  } finally { clearTimeout(timer); }
}
function readStorage(storage, includeCredentials) {
  const entries = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!reserved(key) && (includeCredentials || !secret(key))) entries.push({ key, value: storage.getItem(key) });
  }
  return entries;
}
function writeStorage(storage, entries, includeCredentials) {
  for (const key of Object.keys(storage)) if (!reserved(key) && (includeCredentials || !secret(key))) storage.removeItem(key);
  for (const { key, value } of entries) if (!reserved(key) && (includeCredentials || !secret(key))) storage.setItem(key, value);
}
function validateEntries(entries) {
  if (!Array.isArray(entries)) throw new Error('Workspace settings are missing.');
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string' || typeof entry.value !== 'string' || seen.has(entry.key) || reserved(entry.key)) throw new Error('Invalid workspace settings.');
    seen.add(entry.key);
  }
}
export function workspaceTransferSummary(data) {
  const records = Object.values(data.indexedDB).reduce((sum, db) => sum + Object.values(db.stores).reduce((count, store) => count + store.records.length, 0), 0);
  const projectIds = new Set();
  for (const key of ['xhandle.projects','xhandle.codeArchitectureProjects']) {
    try { const rows = JSON.parse(data.localStorage.find(entry => entry.key === key)?.value || '[]'); if (Array.isArray(rows)) rows.forEach(row => { if (row?.id) projectIds.add(String(row.id)); }); } catch {}
  }
  for (const [dbName, storeName] of [['TraceabilityDB','Projects'],['xhandle-workspace-graph','projects']]) {
    for (const record of data.indexedDB[dbName]?.stores?.[storeName]?.records || []) projectIds.add(String(record.value?.id || record.key));
  }
  const projects = projectIds.size;
  return { projects, databases: Object.keys(data.indexedDB).length, records, settings: data.localStorage.length, baselines: data.backend.baselines.length };
}
function validateData(data) {
  if (!data || typeof data !== 'object') throw new Error('Workspace data is missing.');
  validateEntries(data.localStorage); validateEntries(data.sessionStorage);
  validateTransferDatabases(data.indexedDB);
  if (data.backend?.version !== 1 || !Array.isArray(data.backend.baselines) || typeof data.backend.includeCredentials !== 'boolean') throw new Error('Local-server workspace data is missing.');
}
async function pack(data, includeCredentials, onProgress = () => {}) {
  const manifest = { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), includeCredentials, summary: workspaceTransferSummary(data), exclusions: ['Local-folder and backup-folder permissions (reconnect after import)', 'External files not saved in xHandle', 'Cookies, environment variables, and running processes'] };
  const payload = await encodeWorkspace(data);
  onProgress('Creating integrity checksum…', 85); await yieldUI();
  return { manifest, payload, sha256: await workspaceDigest({ manifest, payload }) };
}
async function capture(includeCredentials, onProgress) {
  onProgress('Reading workspace databases…', 5); await yieldUI();
  const indexedDB = await readTransferDatabases((message, fraction) => onProgress(message, Math.round(5 + fraction * 50)));
  onProgress('Reading local-server baselines and settings…', 60); await yieldUI();
  const backend = await api('export', { includeCredentials });
  return { localStorage: readStorage(localStorage, includeCredentials), sessionStorage: readStorage(sessionStorage, includeCredentials), indexedDB, backend };
}
export async function inspectWorkspaceTransfer(file) {
  let envelope;
  try {
    const text = file.text ? await file.text() : await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsText(file); });
    envelope = JSON.parse(text);
  } catch { throw new Error('This is not a readable workspace JSON file.'); }
  return decodeEnvelope(envelope);
}
async function decodeEnvelope(envelope) {
  if (envelope?.manifest?.format !== FORMAT || envelope.manifest.version !== VERSION || typeof envelope.manifest.includeCredentials !== 'boolean') throw new Error('Unsupported full-workspace file. Use matching, updated xHandle versions. Older backup files use Import Backup File.');
  const digest = await workspaceDigest({ manifest: envelope.manifest, payload: envelope.payload });
  if (digest !== envelope.sha256) throw new Error('Workspace integrity check failed. The file is incomplete or changed.');
  const data = decodeWorkspace(envelope.payload);
  validateData(data);
  const summary = workspaceTransferSummary(data);
  if (JSON.stringify(summary) !== JSON.stringify(envelope.manifest.summary)) throw new Error('Workspace counts do not match the file.');
  return { envelope, data, summary };
}
async function journal() {
  return openDB(TRANSFER_RECOVERY_DB, 1, { upgrade(db) { db.createObjectStore('checkpoints'); } });
}
export function hasPendingWorkspaceTransfer() { return localStorage.getItem(PENDING_KEY) === 'true'; }
export async function getWorkspaceRecovery() {
  const db = await journal();
  try { const entry = await db.get('checkpoints', 'pending'); if (!entry) localStorage.removeItem(PENDING_KEY); return entry ? { createdAt: entry.snapshot.manifest.createdAt, summary: entry.snapshot.manifest.summary } : null; }
  finally { db.close(); }
}
async function saveJournal(entry) { const db = await journal(); try { await db.put('checkpoints', entry, 'pending'); } finally { db.close(); } }
async function clearJournal() { const db = await journal(); try { await db.delete('checkpoints', 'pending'); localStorage.removeItem(PENDING_KEY); } finally { db.close(); } }
async function exclusive(action, { recovery = false } = {}) {
  if (active) throw new Error('A workspace transfer is already in progress.');
  active = true;
  let release;
  try {
    if (!recovery && await getWorkspaceRecovery()) throw new Error('Recover the previous workspace before starting another transfer.');
    release = pauseBackupsForWorkspaceTransfer();
    return await action();
  } finally { release?.(); active = false; }
}
export async function createWorkspaceTransfer({ includeCredentials = false, onProgress } = {}) {
  return exclusive(async () => {
    const report = progress(onProgress);
    const data = await capture(includeCredentials, report);
    report('Encoding workspace data and evidence attachments…', 70); await yieldUI();
    const result = await pack(data, includeCredentials, report);
    report('Workspace file prepared.', 95); return result;
  });
}
export async function downloadWorkspaceTransfer(options = {}) {
  const envelope = await createWorkspaceTransfer(options);
  options.onProgress?.('Preparing download…', 95); await yieldUI();
  const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `xhandle-full-workspace-${envelope.manifest.createdAt.replace(/[:.]/g,'-')}.json`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  options.onProgress?.('Export complete. Download started; check your browser downloads.', 100);
  return envelope.manifest;
}
function backendForImport(data, restoreCredentials) {
  if (restoreCredentials && data.includeCredentials) return data;
  return { version: 1, includeCredentials: false, baselines: data.baselines, repo: data.repo ? { owner: data.repo.owner, repo: data.repo.repo } : null };
}
async function apply(data, names, restoreCredentials, onProgress) {
  await writeTransferDatabases(data.indexedDB, names, onProgress);
  onProgress('Restoring local-server baselines and settings…');
  await api('import', backendForImport(data.backend, restoreCredentials));
  writeStorage(localStorage, data.localStorage, restoreCredentials);
  writeStorage(sessionStorage, data.sessionStorage, restoreCredentials);
}
async function recover(onProgress) {
  const db = await journal(); let entry;
  try { entry = await db.get('checkpoints', 'pending'); } finally { db.close(); }
  if (!entry) throw new Error('No pending workspace recovery was found.');
  const { data } = await decodeEnvelope(entry.snapshot);
  await api('validate', data.backend);
  await apply(data, entry.affectedNames, entry.snapshot.manifest.includeCredentials, onProgress);
  await clearJournal(); notifyBackupDataChanged({ source: 'workspace-recovery' });
}
export async function recoverPreviousWorkspace({ onProgress } = {}) {
  return exclusive(() => recover(progress(onProgress)), { recovery: true });
}
export async function importWorkspaceTransfer(envelope, { restoreCredentials = false, onProgress } = {}) {
  return exclusive(async () => {
    const report = progress(onProgress);
    report('Validating the entire workspace before changing data…');
    const { data } = await decodeEnvelope(envelope);
    const credentials = restoreCredentials && envelope.manifest.includeCredentials;
    await api('validate', backendForImport(data.backend, credentials));
    await preflightTransferDatabases(data.indexedDB);
    report('Saving a local recovery checkpoint…');
    const previous = await capture(credentials, report);
    const affectedNames = [...new Set([...Object.keys(previous.indexedDB), ...Object.keys(data.indexedDB)])];
    const checkpoint = { snapshot: await pack(previous, credentials), affectedNames };
    await saveJournal(checkpoint);
    try {
      localStorage.setItem(PENDING_KEY, 'true');
      await apply(data, affectedNames, credentials, report);
      await clearJournal();
    } catch (error) {
      report('Import interrupted. Recovering the previous workspace…');
      try { await recover(report); }
      catch { throw new Error('Import failed and recovery is pending. Keep xHandle closed to other work and use Recover Previous Workspace in Settings → Backup.'); }
      throw new Error('Import failed. The previous workspace was restored. No successful import was recorded.');
    }
    notifyBackupDataChanged({ source: 'full-workspace-import' });
    report('Full workspace imported. Reload xHandle to use the imported data.');
    return workspaceTransferSummary(data);
  });
}
