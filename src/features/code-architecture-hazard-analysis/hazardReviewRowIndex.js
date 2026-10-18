// Keep row references and compact keys, never copies of entire narrative rows.
// Hashes only select candidates: exact comparison prevents collision mislinks.
function cellText(value) {
  return JSON.stringify(value === undefined ? null : value) ?? 'null';
}
function fingerprint(row) {
  let hash = 2166136261;
  for (const cell of row) {
    const text = cellText(cell);
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    hash = Math.imul(hash ^ 31, 16777619);
  }
  return `${row.length}:${hash >>> 0}`;
}
function equalRows(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && cellText(a[i]) !== cellText(b[i])) return false;
  }
  return true;
}
export function createHazardReviewRowIndex(rows, headers = []) {
  const idColumn = headers.indexOf('Raw Analysis Row ID');
  const byId = new Map();
  let legacy = null;
  const append = (map, key, index) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(index);
  };
  rows.forEach((row, index) => {
    if (idColumn >= 0 && row?.[idColumn]) append(byId, row[idColumn], index);
  });
  return {
    find(row) {
      const id = idColumn >= 0 ? row[idColumn] : null;
      if (id && byId.has(id)) {
        const match = byId.get(id).find(index => equalRows(rows[index], row));
        if (match !== undefined) return match;
        return -1;
      }
      // Legacy/imported rows without stable IDs retain exact content matching.
      if (!legacy) {
        legacy = new Map();
        rows.forEach((candidate, index) => append(legacy, fingerprint(candidate || []), index));
      }
      return legacy.get(fingerprint(row))?.find(index => equalRows(rows[index] || [], row)) ?? -1;
    },
  };
}
