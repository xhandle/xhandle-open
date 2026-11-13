import { openHazardSchema, HAZARD_CHUNKS } from './hazardSchema';
import { hazardChunkKey, hazardChunkDigest } from './hazardRunChunks';
import { validateHazardRowIndex, PAGED_HAZARD } from './hazardRowIndex';
import { validateHazardTableIndex } from './hazardTableIndex';
import { readHazardTransaction } from './readHazardTransaction';
import { createValueAssembler } from '../code-architecture-transfer/archiveValueStream';

const check = signal => { if (signal?.aborted) throw new DOMException('Hazard source reading cancelled.', 'AbortError'); };

// Sequential source capture owns one index snapshot and a bounded chunk cache.
// Interactive paging intentionally remains separate: reloading and hashing the
// full row index for every 100 source rows made complete-document reads quadratic.
export async function* streamHazardSummary(run, { signal, onProgress = () => {} } = {}) {
  const descriptor = run[PAGED_HAZARD];
  if (!descriptor) throw new Error('This run has no saved row provider.');
  const db = await openHazardSchema({ signal });
  try {
    const verifyRevision = async () => {
      check(signal);
      const meta = await readHazardTransaction(db, 'runMetadata', store => store.get(run.id), { signal });
      if (!meta || meta.storageRevision !== descriptor.revision) throw new Error('Saved results changed. Reload the table before continuing.');
    };
    const root = await readHazardTransaction(db, 'hazardAnalysisRuns', store => store.get(run.id), { signal });
    await verifyRevision();
    if (root?.payload?.generation !== descriptor.generation) throw new Error('Saved results changed. Reload the table before continuing.');
    const index = validateHazardRowIndex(root.payload);
    const spans = descriptor.records ? index.recordSummarySpans : index.spans;
    if (!Array.isArray(spans) || spans.length !== descriptor.total) throw new Error('Saved hazard row coordinates are incomplete.');
    const headers = descriptor.records ? [] : index.headers;
    const digests = new Map(validateHazardTableIndex(root.payload).pages.map(page => [page.sequence, page.digest]));
    const cache = new Map();
    const readPage = async sequence => {
      check(signal);
      if (cache.has(sequence)) return cache.get(sequence);
      let end = Math.min(sequence + 15, root.payload.count - 1, spans[spans.length - 1][2]);
      for (let candidate = sequence; candidate <= end; candidate++) { if (!digests.has(candidate)) { end = candidate - 1; break; } }
      if (end < sequence) throw new Error('Saved table page failed integrity verification.');
      const pages = await readHazardTransaction(db, HAZARD_CHUNKS, store => store.getAll(IDBKeyRange.bound(hazardChunkKey(descriptor.generation, sequence), hazardChunkKey(descriptor.generation, end)), 16), { signal });
      if (pages.length !== end - sequence + 1) throw new Error('Saved table has a missing or damaged page.');
      cache.clear();
      for (let offset = 0; offset < pages.length; offset++) {
        const page = pages[offset], expected = sequence + offset;
        if (page.sequence !== expected || page.generation !== descriptor.generation || page.runId !== run.id || page.projectId !== run.projectId || page.repoId !== run.repoId || page.digest !== digests.get(expected) || page.digest !== hazardChunkDigest(page.tokens)) throw new Error('Saved table page failed integrity verification.');
        cache.set(expected, page);
      }
      return cache.get(sequence);
    };
    const readRow = async span => {
      const assembler = createValueAssembler();
      let bytes = 0;
      for (let sequence = span[0]; sequence <= span[2]; sequence++) {
        const page = await readPage(sequence);
        const start = sequence === span[0] ? span[1] : 0, end = sequence === span[2] ? span[3] : page.tokens.length;
        if (end > page.tokens.length) throw new Error('Invalid saved row range.');
        for (let index = start; index < end; index++) {
          const token = page.tokens[index]; bytes += JSON.stringify(token).length * 2;
          if (bytes > 8 * 1024 * 1024) throw new Error('A saved hazard row exceeds the supported row size. Existing results were not changed.');
          assembler.add(token);
        }
      }
      return assembler.finish();
    };
    let offset = 0, pending = null;
    onProgress({ completed: 0, total: spans.length });
    while (offset < spans.length) {
      await verifyRevision();
      const rows = [], start = offset;
      let bytes = 0;
      while (offset < spans.length && rows.length < 100) {
        check(signal);
        const row = pending || await readRow(spans[offset]);
        const size = JSON.stringify(row).length * 2;
        if (rows.length && bytes + size > 1024 * 1024) { pending = row; break; }
        pending = null; rows.push(row); bytes += size; offset++;
      }
      await verifyRevision();
      onProgress({ completed: offset, total: spans.length });
      yield { headers, rows, offset: start, records: Boolean(descriptor.records) };
    }
    await verifyRevision();
  } finally { db.close(); }
}
