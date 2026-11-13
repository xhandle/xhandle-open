export function functionalHierarchyRevision(rows) {
  let hash = 2166136261;
  for (const row of rows) for (const char of JSON.stringify([row.fromArchitecture, row.toArchitecture])) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
export const functionalDiagramStorageKey = (scope, rows) => `functional-v4:${scope}:${functionalHierarchyRevision(rows)}`;
