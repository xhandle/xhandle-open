import { sha256 } from 'hash.js';
import { openCbaIndexedDB } from '../code-architecture-assurance/codeArchitectureStorage';
import { readRecord, writeRecord } from '../code-architecture-storage/chunkedRecord';

// Prompt contents include the source rows and derivation phase. Preserve this
// namespace in transfer; a changed prompt/settings naturally starts fresh work.
export function createRequirementCheckpoint(projectId, repoId, kind, {reuse = true} = {}) {
  const scope=`cba:${projectId}:${repoId}:requirements-work:${kind}`;
  return async (basis, generate, accept) => {
    const key=`${scope}:${sha256().update(JSON.stringify(['requirements-v1',basis])).digest('hex')}`;
    const durable = async work => { try { return await work(); } catch (error) { error.code='REQUIREMENT_CHECKPOINT_FAILED'; throw error; } };
    const db=await durable(() => openCbaIndexedDB());
    try {
      const saved=reuse && await durable(() => readRecord(db,'copilot_baseline',key));
      if (saved && accept(saved.response)) return saved.response;
      const response=await generate();
      if (accept(response)) await durable(() => writeRecord(db,'copilot_baseline',key,{response,updatedAt:new Date().toISOString()}));
      return response;
    } catch (error) {
      if (['QuotaExceededError','TransactionInactiveError','InvalidStateError','AbortError'].includes(error.name)) error.code='REQUIREMENT_CHECKPOINT_FAILED';
      throw error;
    } finally {db.close();}
  };
}
