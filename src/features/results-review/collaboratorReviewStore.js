import { openReviewDB } from './reviewStore';
import { mergeVibeReviewEvidenceItems, normalizeReviewItem } from './reviewUtils';

const STORE = 'reviewItems';
const LOCAL_KEY = 'xhandle:results-review:items';
const localItems = () => JSON.parse(window.localStorage.getItem(LOCAL_KEY) || '[]');
const saveLocal = items => window.localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
const notifyChanged = items => window.dispatchEvent(new CustomEvent('xhandle:collaborator-review:evidence-changed', {
  detail: { projectIds: [...new Set(items.map(item => item.projectId || ''))] },
}));

// Explicit export/recovery only. Normal workspace rendering never calls this.
// Cursor filtering avoids retaining unrelated projects' historical evidence.
export async function readStoredReviewItems(predicate = () => true, { artifactPrefixes } = {}) {
  const db = await openReviewDB();
  const matches = item => (!artifactPrefixes || artifactPrefixes.some(prefix => String(item.artifactId || '').startsWith(prefix))) && predicate(item);
  if (!db) return localItems().filter(matches);
  try {
    const tx = db.transaction(STORE);
    const items = [];
    const seen = new Set();
    for (const prefix of artifactPrefixes ? [...new Set(artifactPrefixes)] : [null]) {
      let cursor = prefix == null ? await tx.store.openCursor()
        : await tx.store.index('artifactId').openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
      while (cursor) {
        if (!seen.has(cursor.primaryKey) && predicate(cursor.value)) { items.push(cursor.value); seen.add(cursor.primaryKey); }
        cursor = await cursor.continue();
      }
    }
    await tx.done;
    return items;
  } finally { db.close(); }
}

// Import/undo writes only the supplied IDs, never a replacement snapshot of
// the database. An empty in-memory provider cannot delete stored history.
export async function putStoredReviewItems(items = [], { preserveExisting = false } = {}) {
  const incoming = items.map(normalizeReviewItem);
  if (!incoming.length) return [];
  const db = await openReviewDB();
  const merge = (old, item) => old
    ? preserveExisting ? old : { ...old, ...item, originalContent: old.originalContent }
    : item;
  if (!db) {
    const byId = new Map(localItems().map(item => [item.id, item]));
    incoming.forEach(item => byId.set(item.id, merge(byId.get(item.id), item)));
    saveLocal([...byId.values()]);
    notifyChanged(incoming);
    return incoming;
  }
  let tx;
  try {
    tx = db.transaction(STORE, 'readwrite');
    for (const item of incoming) {
      const old = await tx.store.get(item.id);
      if (!old || !preserveExisting) await tx.store.put(merge(old, item));
    }
    await tx.done;
    notifyChanged(incoming);
    return incoming;
  } catch (error) {
    try { tx?.abort(); } catch {}
    await tx?.done.catch(() => {});
    throw error;
  } finally { db.close(); }
}

// Read-modify-write is one IndexedDB transaction, serializing decisions even
// across windows. Locate legacy generated-row evidence through artifactId;
// preserve its original content and accumulated history when it matches.
export async function saveCollaboratorReviewEvidence(incoming) {
  if (!incoming?.id) return null;
  const db = await openReviewDB();
  if (!db) {
    const items = localItems();
    const merged = mergeVibeReviewEvidenceItems(items, incoming);
    const recorded = { ...merged.recorded, id: incoming.id, artifactId: incoming.artifactId };
    const byId = new Map(items.map(item => [item.id, item]));
    byId.set(recorded.id, recorded);
    saveLocal([...byId.values()]);
    return recorded;
  }
  let tx;
  try {
    tx = db.transaction(STORE, 'readwrite');
    let existing = await tx.store.get(incoming.id);
    if (!existing) {
      const root = String(incoming.artifactId || '').split(':row:')[0];
      const index = incoming.currentContent?.rowIndex ?? incoming.originalContent?.rowIndex;
      const keys = new Set([incoming.artifactId]);
      if (index != null && Number.isFinite(Number(index))) keys.add(`${root}:row:${index}`);
      for (const key of keys) {
        if (!key) continue;
        let cursor = await tx.store.index('artifactId').openCursor(key);
        while (cursor) {
          if (mergeVibeReviewEvidenceItems([cursor.value], incoming).items.length === 1) {
            existing = cursor.value;
            break;
          }
          cursor = await cursor.continue();
        }
        if (existing) break;
      }
    }
    const merged = mergeVibeReviewEvidenceItems(existing ? [existing] : [], incoming);
    // Use the stable Collaborator key from now on. Leave any differently keyed
    // legacy row untouched; no bulk migration or deletion of history is needed.
    const recorded = { ...merged.recorded, id: incoming.id, artifactId: incoming.artifactId };
    await tx.store.put(recorded);
    await tx.done;
    return recorded;
  } catch (error) {
    try { tx?.abort(); } catch {}
    await tx?.done.catch(() => {});
    throw error;
  } finally { db.close(); }
}

export async function deleteStoredReviewItems(ids = []) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const db = await openReviewDB();
  if (!db) {
    const wanted = new Set(unique), items = localItems();
    saveLocal(items.filter(item => !wanted.has(item.id)));
    const removed = items.filter(item => wanted.has(item.id));
    notifyChanged(removed);
    return removed;
  }
  let tx;
  try {
    tx = db.transaction(STORE, 'readwrite');
    const removed = [];
    for (const id of unique) {
      const item = await tx.store.get(id);
      if (item) { removed.push(item); await tx.store.delete(id); }
    }
    await tx.done;
    notifyChanged(removed);
    return removed;
  } catch (error) {
    try { tx?.abort(); } catch {}
    await tx?.done.catch(() => {});
    throw error;
  } finally { db.close(); }
}

export function hazardDecisionEvidence(item) {
  const review = item?.vibeReview;
  if (review?.domain !== 'hazard-analysis' || !['guidePhraseApplicable', 'safetySignificant', 'safetyClassification'].includes(review.reviewTarget)) return null;
  const rowId = review.rowId || item.currentContent?.rowId || item.originalContent?.rowId;
  // Session summaries share the same domain/target but carry a decision ledger,
  // not one source row. Never retain those ledgers in the workspace cache.
  if (!rowId || !Array.isArray(item.currentContent?.row)) return null;
  // Regeneration needs the reviewed basis row; it does not need original
  // snapshots, session queues, AI payloads or the full decision history.
  return {
    id: item.id, projectId: item.projectId, reviewedAt: item.reviewedAt,
    updatedAt: item.updatedAt, createdAt: item.createdAt,
    userFeedback: item.userFeedback,
    currentContent: item.currentContent,
    vibeReview: { domain: review.domain, reviewTarget: review.reviewTarget,
      rowId,
      decision: review.decision, reviewerName: review.reviewerName,
      humanAdjudicationRationale: review.humanAdjudicationRationale,
      reviewerRationale: review.reviewerRationale, userFeedback: review.userFeedback },
  };
}

export async function readHazardDecisionEvidence(projectId) {
  if (!projectId) return [];
  const db = await openReviewDB();
  if (!db) return localItems().filter(item => item.projectId === projectId).map(hazardDecisionEvidence).filter(Boolean);
  try {
    const tx = db.transaction(STORE);
    const latest = new Map();
    for (const prefix of [`hazard-summary:${projectId}:`, `hazard-summary-draft:${projectId}:`]) {
      let cursor = await tx.store.index('artifactId').openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
      while (cursor) {
        const item = cursor.value.projectId === projectId ? hazardDecisionEvidence(cursor.value) : null;
        if (item) {
          const key = `${item.vibeReview.reviewTarget}:${item.vibeReview.rowId}`;
          const old = latest.get(key);
          const time = value => Date.parse(value?.reviewedAt || value?.updatedAt || value?.createdAt || '') || 0;
          if (!old || time(item) >= time(old)) latest.set(key, item);
        }
        cursor = await cursor.continue();
      }
    }
    await tx.done;
    return [...latest.values()];
  } finally { db.close(); }
}
