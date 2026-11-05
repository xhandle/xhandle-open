// Disposable read acceleration only. Unsaved results are retained separately by
// artifactUtils until a durable save succeeds and must never be evicted here.
export function estimateArtifactBytes(value, limit) {
  let bytes = 0;
  const seen = new WeakSet();
  const frames = [[value][Symbol.iterator]()];
  function* values(item) {
    for (const key in item) {
      if (Object.prototype.hasOwnProperty.call(item, key)) {
        bytes += 16 + key.length * 2;
        yield item[key];
      }
    }
  }
  while (frames.length && bytes <= limit) {
    const next = frames[frames.length - 1].next();
    if (next.done) { frames.pop(); continue; }
    const item = next.value;
    if (typeof item === 'string') bytes += 24 + item.length * 2;
    else if (item && typeof item === 'object') {
      if (seen.has(item)) continue;
      seen.add(item);
      bytes += 64;
      // Iterators avoid allocating a second project-sized values array.
      frames.push(values(item));
    } else bytes += 8;
  }
  return bytes;
}

export function createArtifactMemoryCache({ maxBytes = 8 * 1024 * 1024, maxEntries = 16 } = {}) {
  const entries = new Map();
  let bytes = 0;
  const remove = key => {
    const entry = entries.get(key);
    if (entry) { bytes -= entry.bytes; entries.delete(key); }
  };
  return {
    has: key => entries.has(key),
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key); entries.set(key, entry);
      return entry.rows;
    },
    set(key, rows) {
      remove(key);
      const cost = estimateArtifactBytes(rows, maxBytes);
      if (cost > maxBytes) return;
      while (entries.size && (bytes + cost > maxBytes || entries.size >= maxEntries)) remove(entries.keys().next().value);
      entries.set(key, { rows, bytes: cost }); bytes += cost;
    },
    delete: remove,
    keys: () => entries.keys(),
    stats: () => ({ entries: entries.size, estimatedBytes: bytes, maxBytes }),
  };
}

// A large result is already durably chunked in IndexedDB. Do not allocate one
// enormous JSON string merely to discover it exceeds the fallback's small cap.
export function serializeArtifactFallback(rows, revision, maxChars) {
  const prefix = `{"format":"artifact-rows-v1","revision":${JSON.stringify(revision)},"rowCount":${rows.length},"rows":[`;
  let length = prefix.length + 2;
  const parts = [];
  for (const row of rows) {
    const part = JSON.stringify(row) ?? 'null';
    length += part.length + (parts.length ? 1 : 0);
    if (length > maxChars) return null;
    parts.push(part);
  }
  return length <= maxChars ? prefix + parts.join(',') + ']}' : null;
}
