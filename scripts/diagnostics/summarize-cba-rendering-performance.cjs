// Compact results from full production App runs; keep traces and profiles in /tmp.
// node scripts/diagnostics/summarize-cba-rendering-performance.cjs /tmp/run-directory output.json
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.resolve(process.argv[2]);
const target = path.resolve(process.argv[3]);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const buildsByHash = new Map(fs.readdirSync(directory).filter(name => name.endsWith('-build')).flatMap(name => {
  const manifest = path.join(directory, name, 'asset-manifest.json');
  return fs.existsSync(manifest) ? [[hash(manifest), path.join(directory, name)]] : [];
}));
const phase = sample => sample && ({
  elapsedMs: sample.elapsed, dom: sample.dom, nodes: sample.nodes, edges: sample.edges,
  handles: sample.handles, rows: sample.rows, heapBytes: sample.heap,
  viewport: sample.viewport, pane: sample.pane, dpr: sample.dpr, visibility: sample.visibility,
  focused: sample.focused, commits: sample.commits?.length,
  longTasks: sample.long && {
    count: sample.long.length,
    totalMs: sample.long.reduce((sum, task) => sum + task.duration, 0),
    maxMs: Math.max(0, ...sample.long.map(task => task.duration)),
  },
  frames: sample.frames, over25ms: sample.over25ms, activeInputMs: sample.activeInputMs,
  firstRafAfterInputMs: sample.firstRafAfterInputMs,
  memoryBefore: sample.memoryBefore, memoryAfterInput: sample.memoryAfterInput, memorySettled: sample.memorySettled,
  trustedInputCount: sample.inputEvents?.filter(event => event.trusted).length,
  transformChanged: sample.transformChanged, intermediateTransforms: sample.transformSamples && new Set(sample.transformSamples).size,
  zoomScaleChanges: sample.zoomScaleChanges, traced: sample.traced, settled: sample.settled,
  traceCostsMs: sample.traceCostsMs, reads: sample.reads?.length, writes: sample.writes?.length,
  storageWrites: sample.storage?.filter(item => item.name === 'setItem').length,
  scrollBefore: sample.before, scrollAfter: sample.after,
  scrollChanges: sample.scrollChanges,
});
const runs = {};
for (const filename of fs.readdirSync(directory).filter(name => /^(baseline|final|verified|intermediate|isolate|functional|semantic)-.*\.json$/.test(name) && !/\.(trace|rendering-checks|initial-diagram|manual-diagram|before-node-drag|after-node-drag|restored-node-drag)\.json$/.test(name) && (!name.endsWith('.partial.json') || !fs.existsSync(path.join(directory, name.replace(/(?:\.json)?\.partial\.json$/, '.json'))))).sort()) {
  const file = path.join(directory, filename);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw.methodology) continue;
  const runtime = raw.runtime?.versions || { chrome: raw.runtime?.chrome };
  const gpu = raw.runtime?.gpu || raw.runtime?.systemInfo?.gpu?.featureStatus;
  const baseRawFile = file.replace(/\.partial\.json$/, '');
  const checksFile = baseRawFile + '.rendering-checks.json';
  const savedChecks = raw.cbaRenderingChecks || (fs.existsSync(checksFile) ? JSON.parse(fs.readFileSync(checksFile, 'utf8')) : null);
  const checks = savedChecks && { ...savedChecks };
  if (checks?.crossingRoute) checks.crossingRoute = { ...checks.crossingRoute, path: undefined };
  runs[filename.replace(/\.json(?:\.partial\.json)?$/, '')] = {
    rawFile: file, rawSHA256: hash(file), build: raw.build, manifestSHA256: raw.buildHash,
    retainedBuildPath: buildsByHash.get(raw.buildHash),
    partial: filename.endsWith('.partial.json'),
    failure: filename.endsWith('.partial.json') && fs.existsSync(baseRawFile + '.error.txt')
      ? { file: baseRawFile + '.error.txt', message: fs.readFileSync(baseRawFile + '.error.txt', 'utf8').slice(0, 700) }
      : undefined,
    entryAssetHashes: raw.entryAssetHashes, seederSHA256: raw.seederHash, harnessHashes: raw.harnessHashes,
    methodology: raw.methodology, runtime, gpu, hardware: raw.hardware,
    workspace: raw.workspace,
    // The legacy raw header estimates two relationships per function. Dense
    // variants report their actual seeded count in cbaFixture instead.
    fixture: { ...raw.fixture, relationships: raw.cbaFixture?.architectureRows ?? raw.fixture.relationships },
    cbaFixture: raw.cbaFixture, fixtureStorage: raw.fixtureStorage,
    isolation: raw.isolation, cold: phase(raw.cold), graph: phase(raw.cbaGraphCounts || raw.finalGraph),
    gestures: Object.fromEntries(Object.entries(raw).filter(([key]) => /^(cbaPan|cbaZoom|pan|zoom)\d+$/.test(key)).map(([key, sample]) => [key, phase(sample)])),
    tableEntry: phase(raw.openFunctionalTable), tableScroll: phase(raw.tableScroll),
    cbaSwitches: raw.cbaSwitches?.map(sample => ({ view: sample.view, ...phase(sample) })),
    cbaScroll: raw.cbaScroll && Object.fromEntries(Object.entries(raw.cbaScroll).map(([key, sample]) => [key, phase(sample)])),
    switches: raw.switches?.map(sample => ({ view: sample.tab, ...phase(sample) })),
    heapAfterGC: raw.heapAfterDiagnosticGC, navigationHeapAfterGC: raw.navigationHeapAfterGC,
    domCounters: raw.domCounters, processMemory: raw.processMetrics?.map(({ type, memory }) => ({ type, memory })),
    geometryPreserved: raw.cbaGestureGeometryPreserved, geometryComparison: raw.cbaGestureGeometry, semantics: raw.cbaSemantics,
    renderingChecks: checks, verification: raw.verification, portVerification: raw.portVerification,
    functionalPaint: raw.functionalPaint,
    errors: raw.errors,
  };
}
const sourceFile = path.join(directory, 'source-identity.json');
const result = {
  description: 'Synthetic full-production-App measurements on the identified local host, not customer M4 validation. rAF intervals are not a guarantee of display presentation FPS. Isolation runs deliberately change presentation and are diagnostic only.',
  generatedAt: new Date().toISOString(),
  sourceIdentity: fs.existsSync(sourceFile) ? JSON.parse(fs.readFileSync(sourceFile, 'utf8')) : null,
  runs,
};
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(result, null, 2) + '\n');
console.log(target);
