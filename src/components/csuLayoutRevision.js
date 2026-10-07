// Geometry/topology only: full source evidence and descriptions are deliberately
// excluded. Keep endpoint allocations because Functional nodes can cross CSUs.
export function csuLayoutRevision(rows) {
  return JSON.stringify((rows || []).map(row => [
    row.fromNodeId, row.toNodeId, row.edgeId,
    row.fromFunction || row.from, row.toFunction || row.to,
    row.controlAction || row.action, row.fromFile, row.toFile,
    row.functionalModel?.internal,
    ...[row.architecture, row.fromArchitecture, row.toArchitecture].flatMap(arch => [
      arch?.subsystem, arch?.csci, arch?.csc, arch?.csu,
    ]),
  ]));
}
