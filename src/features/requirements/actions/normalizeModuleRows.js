// Validate the whole batch before persistence, preserving caller identities and evidence.
export function validateModuleRows(rows, remainingRows, folderId, moduleId, moduleName) {
  const ids = new Set(remainingRows.map(r => r.id));
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) throw new Error('Duplicate object identity or an identity owned by another module.');
    ids.add(row.id);
  }
  const scoped = new Map([...remainingRows.filter(r => (r.folderId ?? r.projectId) === folderId && (r.moduleId ? r.moduleId === moduleId : r.module === moduleName)), ...rows].map(r => [r.id, r]));
  for (const row of rows) {
    const seen = new Set([row.id]);
    let parentId = row.parentId;
    while (parentId) {
      if (!scoped.has(parentId)) throw new Error('Parent object is outside this module or missing.');
      if (seen.has(parentId)) throw new Error('Object hierarchy contains a cycle.');
      seen.add(parentId); parentId = scoped.get(parentId).parentId;
    }
  }
}
