export const architectureDashboardColumns = [
  ['name', 'Project'], ['folder', 'Folder'], ['repoCount', 'Connected sources'],
  ['activeRepoName', 'Active repo'], ['rowCount', 'Rows'], ['metrics', 'Metrics'], ['updatedAt', 'Updated'],
];
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const numeric = value => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
function compare(a, b, direction) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return (typeof a === 'number' ? a - b : collator.compare(String(a), String(b))) * direction;
}
export function groupArchitectureDashboard(rows, folders, sort) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const path = folder => {
    const labels = [], visited = new Set();
    while (folder && !visited.has(folder.id)) {
      visited.add(folder.id); labels.unshift(folder.name); folder = byId.get(folder.parentId);
    }
    return labels.join(' / ');
  };
  const groups = new Map();
  rows.forEach(row => {
    const folder = byId.get(row.folderId);
    const id = folder?.id || null;
    if (!groups.has(id)) groups.set(id, { id, name: folder ? path(folder) : 'Top level', rows: [] });
    groups.get(id).rows.push(row);
  });
  const direction = sort.direction === 'desc' ? -1 : 1;
  const value = row => {
    if (sort.key === 'updatedAt') return Number.isFinite(Date.parse(row.updatedAt)) ? Date.parse(row.updatedAt) : null;
    if (sort.key === 'rowCount' || sort.key === 'repoCount') return numeric(row[sort.key]);
    if (sort.key === 'metrics') return numeric(row.metrics?.durationMs);
    return row[sort.key] || null;
  };
  for (const group of groups.values()) group.rows.sort((a, b) => {
    const primary = sort.key === 'folder' ? 0 : compare(value(a), value(b), direction);
    const secondary = sort.key === 'metrics' ? compare(numeric(a.metrics?.aiCallCount), numeric(b.metrics?.aiCallCount), direction) : 0;
    return primary || secondary || collator.compare(a.name || '', b.name || '') || collator.compare(a.id, b.id);
  });
  return [...groups.values()].sort((a, b) => {
    if (a.id == null) return b.id == null ? 0 : 1;
    if (b.id == null) return -1;
    return collator.compare(a.name, b.name) * (sort.key === 'folder' ? direction : 1) || collator.compare(a.id, b.id);
  });
}
