import { openCodeArchitectureHazardDB } from './codeArchitectureHazardStore';

const STORE = 'generationCheckpoints';
// Bump when prompts, interpretation or audit contracts change.
const VERSION = 'stpa-performance-v1';
export async function checkpointDigest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createCodeHazardCheckpoint(scopeParts, { regenerate = false, signal, onProgress = () => {} } = {}) {
  const db = await openCodeArchitectureHazardDB();
  if (!db || (typeof crypto === "undefined" || !crypto.subtle)) return null;
  const scope = JSON.stringify(scopeParts);
  if (regenerate) {
    const tx = db.transaction(STORE, 'readwrite');
    let cursor = await tx.store.index('scope').openCursor(scope);
    while (cursor) { await cursor.delete(); cursor = await cursor.continue(); }
    await tx.done;
  }
  const used = new Set();
  const check = () => { if (signal?.aborted) throw new DOMException('Hazard analysis cancelled.', 'AbortError'); };
  return {
    async prune() {
      check();
      const tx = db.transaction(STORE, 'readwrite');
      let cursor = await tx.store.index('scope').openKeyCursor(scope);
      while (cursor) {
        if (!used.has(cursor.primaryKey)) await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
    async read(basis) {
      check();
      const id = await checkpointDigest([VERSION, scope, basis]);
      used.add(id);
      const record = await db.get(STORE, id);
      check();
      if (record) onProgress({message: 'Reusing saved STPA work with matching inputs…'});
      return record?.value;
    },
    async write(basis, value) {
      check();
      const id = await checkpointDigest([VERSION, scope, basis]);
      used.add(id);
      check();
      await db.put(STORE, {id, scope, projectId: scopeParts.projectId, repoId: scopeParts.repoId, value, savedAt: new Date().toISOString()});
    },
  };
}
