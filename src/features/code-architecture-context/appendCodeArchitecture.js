import { reconcileArchitectureRows } from './codeRelationshipEvidence';

const fail = (message, code = 'SOURCE_APPEND_UNAVAILABLE') => Object.assign(new Error(message), { code });
const origin = row => row.grounding?.currentFile || row.relationshipEvidence?.fromFile || row.fromFile;

export function analyzedArchitecturePaths(base) {
  // A target reference is evidence of a dependency, not of analyzing that file.
  const manifest = base.run?.inputManifest || [];
  const ledgerPaths = Object.keys(base.run?.relationshipLedger || {});
  return new Set([
    ...manifest.map(file => file.path), ...ledgerPaths,
    // Complete manifests are authoritative even after an analyst edits a label
    // or displayed file path. Use row origins only for older saved formats.
    ...(manifest.length || ledgerPaths.length ? [] : base.rows.filter(row => row.lineage?.status !== 'historical').map(origin)),
  ].filter(Boolean));
}

export function assertArchitectureAppendDestination(base, scope, config) {
  if (base.rows?.some(row => row.lineage?.scope && row.lineage.scope !== scope)) throw fail('Saved analysis belongs to another project or repository.');
  const previous = base.metadata;
  if ((previous.owner && previous.owner.toLowerCase() !== String(config.owner || '').toLowerCase()) ||
      (previous.repo && previous.repo.toLowerCase() !== String(config.repo || '').toLowerCase()) ||
      (previous.sourceId && previous.sourceId !== config.sourceId)) throw fail('This connection points to a different source. Use a separate repository connection.');
}

export function planArchitectureAppend(base, selected, scope, config) {
  if (!base.hasAnalysis) throw fail('There is no saved analysis to append to. Start a new analysis.');
  assertArchitectureAppendDestination(base, scope, config);
  const paths = analyzedArchitecturePaths(base);
  if (!paths.size) throw fail('This saved analysis has no verifiable file manifest. Choose Replace analysis to rerun the selected files.');
  const files = selected.filter(file => !paths.has(file.path));
  if (!files.length) throw fail('All selected files have already been analyzed. Select additional file types to append, or choose Replace analysis to rerun them.', 'SOURCE_APPEND_NO_NEW_FILES');
  return { files, previousPaths: paths };
}

export async function verifyArchitectureAppendSource(base, previousPaths, { source, files, previousFiles, readText, digestText, signal }) {
  const oldSource = base.run?.source || base.metadata;
  const oldSnapshot = oldSource.snapshotId || base.metadata.commitSha;
  if (!oldSnapshot) throw fail('The saved analysis has no immutable source revision. Choose Replace analysis to establish one before appending.');
  if (oldSource.sourceType === 'local' || source.sourceType === 'local') {
    if (oldSource.sourceType !== source.sourceType || oldSource.sourceId !== source.sourceId) throw fail('The saved analysis belongs to another local source.');
    const manifest = new Map((base.run?.inputManifest || []).map(entry => [entry.path, entry]));
    for (const path of previousPaths) {
      const expected = manifest.get(path);
      if (!expected?.textDigest) throw fail(`Cannot verify earlier source ${path}. Choose Replace analysis.`);
      const read = await readText(path, signal);
      if ((read.textDigest || await digestText(read.content)) !== expected.textDigest) throw fail(`Previously analyzed file ${path} changed. Choose Replace analysis to refresh the source.`, 'SOURCE_APPEND_SOURCE_CHANGED');
    }
    return;
  }
  if (oldSnapshot === source.snapshotId) return;
  const current = new Map(files.map(file => [file.path, file]));
  const manifest = new Map((base.run?.inputManifest || []).map(file => [file.path, file]));
  // Analyses saved before blob IDs were recorded can still be verified using
  // their immutable Git tree. Never fetch the moving branch as the old source.
  const needsTree = [...previousPaths].some(path => !manifest.get(path)?.blobSha);
  const oldFiles = needsTree ? new Map((await previousFiles(oldSnapshot)).map(file => [file.path, file])) : null;
  for (const path of previousPaths) {
    const old = manifest.get(path), now = current.get(path), then = oldFiles?.get(path);
    const sha = old?.blobSha || then?.sha;
    if (!sha || !now?.sha || sha !== now.sha || (old?.entryKind || then?.entryKind || 'file') !== (now.entryKind || 'file')) {
      throw fail(`Previously analyzed file ${path} changed or was removed. Choose Replace analysis to refresh the source.`, 'SOURCE_APPEND_SOURCE_CHANGED');
    }
  }
}

export function appendArchitectureRows(previous, incoming, scope) {
  // Reuse the established evidence/node identity rules for new rows, but keep
  // every earlier row's original status instead of retiring unselected files.
  const oldIds = new Set(previous.map(row => row.traceId).filter(Boolean));
  const identity = row => row.integrationEvidence?.relationshipId || row.canonicalRelationshipId || JSON.stringify([row.fromFile, row.from, row.action, row.toFile, row.to]);
  const oldRelationships = new Set(previous.filter(row => row.lineage?.status !== 'historical').map(identity));
  const endpoints = row => JSON.stringify([row.relationshipEvidence?.fromFile || row.fromFile, row.relationshipEvidence?.from || row.from,
    row.relationshipEvidence?.toFile || row.toFile, row.relationshipEvidence?.to || row.to]);
  const existingLinks = [...previous.filter(row => row.lineage?.status !== 'historical'), ...incoming.filter(row => !row.integrationEvidence)];
  const linksByEndpoints = new Map(), addedIntegrationIds = new Set();
  for (const old of existingLinks) {
    const key = endpoints(old), ids = linksByEndpoints.get(key) || new Set();
    ids.add(old.integrationEvidence?.relationshipId || '*'); linksByEndpoints.set(key,ids);
  }
  incoming = incoming.filter(row => {
    if (!row.integrationEvidence) return true;
    const id = row.integrationEvidence.relationshipId, ids = linksByEndpoints.get(endpoints(row));
    if (ids?.has('*') || ids?.has(id) || addedIntegrationIds.has(id)) return false;
    addedIntegrationIds.add(id); return true;
  });
  const activeNodes = new Map();
  const endpoint = (row,side) => JSON.stringify([row.relationshipEvidence?.[`${side}File`] || row[`${side}File`],row.relationshipEvidence?.[side] || row[side]]);
  for (const old of previous.filter(row => row.lineage?.status !== 'historical')) for (const side of ['from','to']) {
    const id = old[`${side}NodeId`]; if (!id) continue;
    const key=endpoint(old,side), ids=activeNodes.get(key)||new Set();ids.add(id);activeNodes.set(key,ids);
  }
  const reconciled = reconcileArchitectureRows(incoming, previous, scope).slice(0, incoming.length).map(row => {
    for (const side of ['from','to']) {
      const ids=activeNodes.get(endpoint(row,side));
      if (ids?.size === 1) row[`${side}NodeId`] = [...ids][0];
    }
    return row;
  });
  return [...previous.map(row => ({ ...row, lineage: row.lineage ? { ...row.lineage } : undefined })),
    ...reconciled.filter(row => !oldIds.has(row.traceId) && !oldRelationships.has(identity(row)))];
}

export function mergeArchitectureManifests(base, inputManifest, ledger, source) {
  const previousManifest = base.run?.inputManifest || [];
  const merged = new Map(previousManifest.map(file => [file.path, { ...file, source: file.source || base.run.source }]));
  for (const file of inputManifest) merged.set(file.path, { ...file, source });
  return {
    inputManifest: [...merged.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    relationshipLedger: Object.fromEntries(Object.entries({ ...(base.run?.relationshipLedger || {}), ...ledger }).map(([path,file]) => [path,{...file}])),
    legacyCoverageUnknown: !base.run?.inputManifest || Boolean(base.run?.legacyCoverageUnknown),
  };
}
