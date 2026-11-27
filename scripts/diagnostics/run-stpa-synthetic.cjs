#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {command, cleanEnvironment} = require('./electron-regression-support.cjs');
const root = path.resolve(__dirname, '../..');
const index = process.argv.indexOf('--out');
if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/diagnostics/run-stpa-synthetic.cjs [--out /tmp/fresh-directory]\nOffline synthetic STPA pipeline, artifact, table, evidence, recovery and compatibility checks. No Electron or API credentials required.');
  process.exit(0);
}
if (index >= 0 && !process.argv[index + 1]) throw Error('--out requires a fresh output directory.');
const output = index >= 0 ? path.resolve(process.argv[index + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'xhandle-stpa-synthetic-'));
if (index >= 0) { if (fs.existsSync(output)) throw Error('Choose a fresh --out directory.'); fs.mkdirSync(output, {recursive:true}); }
const json = path.join(output, 'jest-results.json'), log = path.join(output, 'tests.log');
const feature = 'src/features/code-architecture-hazard-analysis/';
const suites = [
  'stpaSyntheticHarness.test.js', 'stpaReviewRegression.test.js', 'stpaCompletionPolicy.test.js', 'stpaTableColumns.test.js', 'CodeArchitectureHazardSummaryTable.test.jsx',
  'haulageSourceConsistency.test.js',
  'requirementTextPolicy.test.js',
  'sourceBehaviorEvidence.test.js',
  'sourceConformanceReview.test.js',
  'generatedSiblingContext.test.js',
  'automaticRationaleCorrection.test.js',
  'fastHazardSemanticReview.test.js',
  '../hazard-eval/functionalQualityScoring.test.js',
  '../hazard-eval/functionalViewSnapshot.test.js',
  '../hazard-eval/functionalQualityContract.test.js',
  '../hazard-eval/functionalQualityCitationRepair.test.js',
  '../hazard-eval/functionalQualityAdjudication.test.js',
  '../hazard-eval/functionalQualityTransport.test.js',
  'codeHazardImportContext.test.js',
  'resultsFirstHazardPipeline.test.js', 'fastHazardQuality.test.js', 'hazardGrounding.test.js',
  'hazardFieldContract.test.js', 'hazardPromptPayload.test.js', 'hazardAutomaticRecovery.test.js',
  'assumptionHazardFallback.test.js',
  'fastHazardRunner.test.js',
];
const started = Date.now();
(async()=>{
  const result = await command(process.execPath, [path.join(root,'node_modules/react-app-rewired/bin/index.js'), 'test', '--watch=false', '--runInBand', '--testTimeout=15000', '--json', '--outputFile='+json, '--runTestsByPath', ...suites.map(file=>feature+file)], {
    cwd:root, log, timeoutMs:120000,
    env:cleanEnvironment({CI:'true', BABEL_ENV:'test', NODE_OPTIONS:'--max-old-space-size=4096 --require '+JSON.stringify(path.join(__dirname,'stpa-offline-guard.cjs'))}),
  });
  const data = fs.existsSync(json) ? JSON.parse(fs.readFileSync(json, 'utf8')) : null;
  const ok = result.exitCode === 0 && !result.timedOut && !result.interrupted && !result.blockedEgress && data?.success === true && data.numTotalTests > 0 && data.numPendingTests === 0 && data.numTotalTestSuites === suites.length;
  const throughputMatch = result.tail.match(/\[stpa-synthetic-throughput\]\s+(\{[^\n]*\})/);
  const report = {ok,kind:'offline-synthetic-stpa',elapsedMs:Date.now()-started,liveProviderCalls:0,network:'blocked',
    throughput:throughputMatch ? JSON.parse(throughputMatch[1]) : null,
    counts:data?{suites:data.numTotalTestSuites,tests:data.numTotalTests,passed:data.numPassedTests,failed:data.numFailedTests,pending:data.numPendingTests}:null,
    checks:ok?['Real screening/generation with synthetic providers','Four control domains and all four UCA categories','Artifact validation and source identity','Targeted correction and 320-row cache/resume','Partial failures, cancellation and provider rejection','STPA columns, copy and source trace links','HARA/FHA compatibility']:[],
    errors:ok?[]:[result.timedOut?'Harness timed out':result.interrupted?'Harness interrupted':'Synthetic STPA checks failed; see tests.log and jest-results.json'],
    limits:['Deterministic provider fixtures test pipeline behavior, not live model output quality or completeness of a customer safety analysis.'],
    evidence:{json,log},
  };
  const file=path.join(output,'result.json');fs.writeFileSync(file,JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok,elapsedMs:report.elapsedMs,counts:report.counts}));console.log('RESULT '+file);
  if(!ok){console.error(result.tail.slice(-6000));process.exitCode=1;}
})().catch(error=>{console.error(error);process.exitCode=1;});
