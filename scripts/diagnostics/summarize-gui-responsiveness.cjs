// Emit compact numerical evidence; omit page bodies, thread content and raw traces.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = sorted.length;
  return { n, median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2 : null,
    min: sorted[0] ?? null, max: sorted[n - 1] ?? null,
    p95Estimate: n >= 5 ? sorted[Math.ceil(n * 0.95) - 1] : null };
}
const files = process.argv.slice(2);
if (!files.length) throw new Error('Usage: node scripts/diagnostics/summarize-gui-responsiveness.cjs /tmp/run.json ...');
const results = files.map(file => {
  const raw = fs.readFileSync(file);
  const data = JSON.parse(raw);
  const successful = data.samples.filter(sample => !sample.failure);
  const groups = [...new Set(successful.map(sample => sample.name))].map(name => {
    const samples = successful.filter(sample => sample.name === name);
    const reads = {};
    for (const sample of samples) for (const read of sample.reads || []) reads[read.store] = (reads[read.store] || 0) + 1;
    return { name, elapsedMs: stats(samples.map(sample => sample.elapsed)),
      inputToUsableMs: stats(samples.map(sample => sample.inputToUsableMs)),
      maxLongTaskMs: stats(samples.map(sample => Math.max(0, ...(sample.long || []).map(task => task.ms)))),
      dom: stats(samples.map(sample => sample.dom)), nodes: stats(samples.map(sample => sample.nodes)),
      edges: stats(samples.map(sample => sample.edges)), rows: stats(samples.map(sample => sample.rows)),
      reads, sampleReadCounts: samples.map(sample => sample.reads?.length || 0),
      gestures: samples.filter(sample => sample.gesture).map(sample => sample.gesture),
      sampleInputToUsableMs: samples.map(sample => sample.inputToUsableMs ?? null) };
  });
  return { file: path.resolve(file), sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    fixture: data.fixture, seed: data.seed, extras: data.extras, screen: data.screen, runtime: data.runtime,
    source: data.source, nativeMetadata: data.nativeMetadata, loadedMetadata: data.loadedMetadata,
    entryHashes: data.entryHashes, harnessHash: data.harnessHash, seederHash: data.seederHash,
    diagnosticOnly: data.diagnosticOnly, fatal: data.fatal || null,
    failedSamples: data.samples.filter(sample => sample.failure).map(({name, failure}) => ({name, failure})),
    pageErrors: data.errors, groups,
    memoryPhases: data.phases.filter(phase => phase.heap != null).map(phase => ({label: phase.label, heapBytes: phase.heap, processes: phase.processes})),
  };
});
process.stdout.write(JSON.stringify({ percentileMethod: 'Nearest rank; small-sample p95 estimates are uncertain; gesture frames are correlated, not independent trials.', runs: results }, null, 2) + '\n');
