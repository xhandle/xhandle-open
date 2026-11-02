const order = ['Systems', 'Subsystems', 'CSCI', 'CSC', 'CSU', 'Functions', 'Notes', 'Connections'];
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function diagramNavigatorGroups(entries) {
  const groups = new Map();
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.navigator || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const key = entry.navigator.group;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([label, items]) => ({
    id: `navigator-group:${label}`, label,
    entries: items.sort((a, b) => collator.compare(a.label, b.label)
      || collator.compare(a.navigator.context, b.navigator.context) || collator.compare(a.id, b.id)),
  }));
}

export function diagramNavigatorRows(groups, expanded) {
  const rows = [];
  groups.forEach((group, groupIndex) => {
    rows.push({ ...group, group: true, expanded: expanded.has(group.id), position: groupIndex + 1, size: groups.length });
    if (expanded.has(group.id)) group.entries.forEach((entry, index) => rows.push({
      ...entry, parentId: group.id, position: index + 1, size: group.entries.length,
    }));
  });
  return rows;
}
