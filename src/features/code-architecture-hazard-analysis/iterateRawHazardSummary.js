import {openHazardSchema, HAZARD_CHUNKS} from './hazardSchema';
import {hazardChunkKey, hazardChunkDigest} from './hazardRunChunks';
import {validateHazardRowIndex} from './hazardRowIndex';
import {validateHazardTableIndex} from './hazardTableIndex';
import {createValueAssembler} from '../code-architecture-transfer/archiveValueStream';

// Bulk indexing needs a single validated snapshot, rather than re-hashing the
// complete row-coordinate index for every 100-row interactive table request.
// Only verified pages and the current row are assembled; evidence is not read.
export async function* iterateRawHazardSummary(run, {signal} = {}) {
  const check = () => { if (signal?.aborted) throw new DOMException('Workspace indexing cancelled.', 'AbortError'); };
  check();
  const db = await openHazardSchema({signal});
  const cache = new Map();
  try {
    const opening = db.transaction(['hazardAnalysisRuns', 'runMetadata']);
    const [root, metadata] = await Promise.all([
      opening.objectStore('hazardAnalysisRuns').get(run.id),
      opening.objectStore('runMetadata').get(run.id),
    ]);
    await opening.done;
    if (!root || root.payload?.generation !== run.payload?.generation || root.payload?.digest !== run.payload?.digest) {
      throw new Error('Saved results changed during workspace indexing.');
    }
    const index = validateHazardRowIndex(root.payload);
    const table = validateHazardTableIndex(root.payload);
    const generation = root.payload.generation, revision = metadata?.storageRevision;
    const digests = new Map(table.pages.map(page => [page.sequence, page.digest]));
    const assertMetadata = value => {
      if (Boolean(value)!==Boolean(metadata) || value?.storageRevision !== revision) throw new Error('Saved results changed during workspace indexing.');
    };
    const checkRevision = async () => {
      check();
      assertMetadata(await db.get('runMetadata', run.id));
      check();
    };
    const page = async sequence => {
      check();
      if (cache.has(sequence)) return cache.get(sequence);
      const tx = db.transaction([HAZARD_CHUNKS, 'runMetadata']);
      const [value, current] = await Promise.all([
        tx.objectStore(HAZARD_CHUNKS).get(hazardChunkKey(generation, sequence)),
        tx.objectStore('runMetadata').get(run.id),
      ]);
      await tx.done; check(); assertMetadata(current);
      if (!value || value.runId !== run.id || value.generation !== generation ||
          value.digest !== digests.get(sequence) || value.digest !== hazardChunkDigest(value.tokens)) {
        throw new Error('Saved table has a missing or damaged page.');
      }
      if (cache.size >= 8) cache.delete(cache.keys().next().value);
      cache.set(sequence, value);
      return value;
    };
    for (let rowIndex = 0; rowIndex < index.spans.length; rowIndex++) {
      check();
      if (rowIndex % 100 === 0) await checkRevision();
      const span = index.spans[rowIndex], assembler = createValueAssembler();
      let bytes = 0;
      for (let sequence = span[0]; sequence <= span[2]; sequence++) {
        const value = await page(sequence);
        const start = sequence === span[0] ? span[1] : 0;
        const end = sequence === span[2] ? span[3] : value.tokens.length;
        if (end > value.tokens.length) throw new Error('Invalid saved row range.');
        for (let token = start; token < end; token++) {
          bytes += JSON.stringify(value.tokens[token]).length * 2;
          if (bytes > 8 * 1024 * 1024) throw new Error('This saved row exceeds the safe indexing size.');
          assembler.add(value.tokens[token]);
        }
      }
      yield {headers: index.headers, row: assembler.finish(), index: rowIndex};
    }
    await checkRevision();
    const current = await db.get('hazardAnalysisRuns', run.id);
    if (current?.payload?.generation !== generation || current?.payload?.digest !== root.payload.digest ||
        current?.payload?.rowIndex?.digest !== index.digest || current?.payload?.tableIndex?.digest !== root.payload.tableIndex?.digest) {
      throw new Error('Saved results changed during workspace indexing.');
    }
  } finally {
    cache.clear(); db.close();
  }
}
