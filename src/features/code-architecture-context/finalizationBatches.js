// These limits bound transient work, not the total accepted analysis size.
export function estimateJsonMemory(value, stopAfter = Infinity) {
  let size = 0;
  const seen = new WeakSet();
  const visit = item => {
    if (size > stopAfter) return;
    if (typeof item === 'string') { size += item.length * 2 + 32; return; }
    if (!item || typeof item !== 'object') { size += 16; return; }
    if (seen.has(item)) return;
    seen.add(item); size += 64;
    for (const name of Object.keys(item)) { size += name.length * 2 + 16; visit(item[name]); if (size > stopAfter) break; }
  };
  visit(value); return size;
}

export function createByteCache({ maxBytes = 8 * 1024 * 1024, maxEntries = 16 } = {}) {
  const entries = new Map();
  let bytes = 0;
  return {
    get(key) { const entry = entries.get(key); if (!entry) return undefined; entries.delete(key); entries.set(key, entry); return entry.value; },
    set(key, value, size = estimateJsonMemory(value, maxBytes)) {
      const old = entries.get(key); if (old) { bytes -= old.size; entries.delete(key); }
      if (size > maxBytes) return;
      while ((bytes + size > maxBytes || entries.size >= maxEntries) && entries.size) {
        const first = entries.keys().next().value; bytes -= entries.get(first).size; entries.delete(first);
      }
      entries.set(key, {value, size}); bytes += size;
    },
    clear() { entries.clear(); bytes = 0; },
    get bytes() { return bytes; },
    get size() { return entries.size; },
  };
}

export async function mapFinalizationBatches(rows, transform, {
  signal, maxRows = 128, maxBytes = 2 * 1024 * 1024,
  weight = row => estimateJsonMemory(row, maxBytes), onBatch,
} = {}) {
  const result = [];
  let batch = [], bytes = 0, first = 0;
  const check = () => { if (signal?.aborted) throw signal.reason || new DOMException('Analysis cancelled.', 'AbortError'); };
  const flush = async () => {
    check();
    // Await each transform and durable consumer: no unbounded promise queue.
    for (let index = 0; index < batch.length; index++) { check(); result.push(await transform(batch[index], first + index)); }
    await onBatch?.({completed:first + batch.length, total:rows.length});
    first += batch.length; batch = []; bytes = 0;
    await new Promise(resolve => setTimeout(resolve, 0)); check();
  };
  for (const row of rows) {
    check(); const size = weight(row);
    if (batch.length && (batch.length >= maxRows || bytes + size > maxBytes)) await flush();
    batch.push(row); bytes += size;
  }
  if (batch.length) await flush();
  return result;
}
