#!/usr/bin/env node
// Complete local regression gate. Native shell remains owned by xhandle-desktop.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { files, fingerprint, cleanEnvironment, command, resultFromOutput, markdown } = require('./electron-regression-support.cjs');
const root = path.resolve(__dirname, '../..');
const value = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/diagnostics/run-electron-regression.cjs --desktop ../xhandle-desktop --playwright /path/to/playwright-core [--out /tmp/fresh-directory] [--only frontend,capacity,backend,native-node,native-python,build,fixtures,shell,workspace,hara,hazard-profile,platform-profile,design,artifact-generation,derivation,safety-inheritance,collaborator,worker]');
  process.exit(0);
}
if (+process.versions.node.split('.')[0] < 22) throw Error('Run this harness with Node 22 or newer.');
const desktop = fs.realpathSync(value('--desktop') || path.join(root, '../xhandle-desktop'));
const output = value('--out') ? path.resolve(value('--out')) : fs.mkdtempSync(path.join(os.tmpdir(), 'xhandle-electron-regression-'));
if (value('--out')) { if (fs.existsSync(output)) throw Error('Choose a fresh --out directory; existing results are never overwritten.'); fs.mkdirSync(output, { recursive: true }); }
const selected = value('--only')?.split(',');
const known = ['frontend','capacity','backend','native-node','native-python','build','fixtures','shell','workspace','hara','hazard-profile','platform-profile','design','artifact-generation','derivation','safety-inheritance','collaborator','worker'];
if (selected?.some(name => !known.includes(name))) throw Error('Unknown suite in --only. Use --help for suite names.');
const playwright = value('--playwright') || process.env.XHANDLE_PLAYWRIGHT_MODULE || require.resolve('playwright-core');
const electron = value('--electron') || require(path.join(desktop, 'node_modules/electron'));
const env = cleanEnvironment({ XHANDLE_PLAYWRIGHT_MODULE: playwright, PLAYWRIGHT_MODULE: playwright, NODE_OPTIONS: '--max-old-space-size=8192', ELECTRON_PATH: electron, BABEL_ENV: 'production' });
const source = fingerprint(root);
let interrupted = false;
process.once('SIGINT',()=>{interrupted=true;});process.once('SIGTERM',()=>{interrupted=true;});
const stage = path.join(output, 'desktop');
const report = { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, node: process.versions.node,
  source, desktopSource: fingerprint(desktop, ['electron', 'scripts']), electronVersion: require(path.join(desktop, 'node_modules/electron/package.json')).version,
  output, stage, partial: !!selected, suites: [], coverage: [
    'Full discovered frontend unit/component/storage suites; backend routing, streaming and provider compatibility; desktop security, recovery, staging, updater and release-validator tests.',
    'Real Electron native startup and persistence; populated navigation, diagram controls, column filters, large code/hazard tables, reports, safety case, System Test, search/settings/help and workspace data isolation.',
    'Projects HARA/STPA mechanics, deterministic ASIL, ratings, method preservation, workbook export and reload; Code HARA field parity, searchable multiselects, CSV, legacy blanks and persisted reload; CBA FHA menu removal.',
    'Design library/folder/artifact controls, dialogs, table/outline/document/traceability views, graph/edge behavior, requirement derivation with and without saved safety obligations, publication and source links.',
    'Collaborator current-view context across Projects, Code-Based Architecture, Design Management, System Test, Safety Case and Reports, including context-repair behavior.',
    'Large evidence capture/hash/layout workers must service input while processing. Live tests use the production renderer and isolated profiles. Provider responses and source data are synthetic.',
    'Historical design UI fixtures control source freshness for seeded drafts. The derivation and safety-inheritance suites separately exercise real freshness checks and joint publication.',
    'Manual-only or external coverage: real API model output quality, cloud authentication/GitHub permissions, OS-specific file dialogs, signed installers, notarization, live auto-update feeds, Windows and Linux runtime execution on this macOS host.',
  ] };
function save() { fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(path.join(output, 'report.md'), markdown(report)); }
async function suite(id, name, run) {
  if(interrupted)throw Error('Regression run interrupted; remaining suites were not run.');
  if (selected && !selected.includes(id) && !(['build','fixtures'].includes(id) && selected.some(name => !['frontend','capacity','backend','native-node','native-python'].includes(name)))) return;
  const item = { id, name, status: 'running', durationMs: 0, log: path.join(output, `${id}.log`) }; report.suites.push(item); save();
  console.log(`START ${id}: ${name}`); const started = Date.now();
  const heartbeat = setInterval(() => console.log(`RUNNING ${id}: ${Math.round((Date.now()-started)/1000)} s`), 30000);
  try { await run(item); item.status = 'passed'; }
  catch (error) { item.status = 'failed'; item.error = error.stack || String(error); console.error(`FAIL ${id}: ${error.message}`); }
  finally { clearInterval(heartbeat); item.durationMs = Date.now() - started; save(); console.log(`${item.status.toUpperCase()} ${id}: ${(item.durationMs/1000).toFixed(1)} s`); }
  if(interrupted)throw Error('Regression run interrupted; remaining suites were not run.');
}
async function execute(item, executable, args, options = {}) {
  const result = await command(executable, args, { cwd: root, env, log: item.log, ...options });
  if (result.timedOut || result.interrupted || result.exitCode !== 0) throw Error(`${result.timedOut ? 'Timed out' : result.interrupted ? 'Interrupted' : `Exit ${result.exitCode}${result.signal ? ` (${result.signal})` : ''}`}. ${result.error || ''} See ${item.log}\n${result.tail.slice(-5000)}`);
  if (result.blockedEgress) throw Error('A live fixture attempted nonlocal network access. See '+item.log);
  return result;
}
const node = process.execPath;
const diagnostic = name => path.join(__dirname, name);
async function live(item, name, extra = []) {
  if (!fs.existsSync(path.join(stage, 'stage/renderer/index.html'))) throw Error('Production build unavailable; this suite was not run.');
  const result = await execute(item, node, [diagnostic(name), '--stage', stage, '--electron', electron, ...extra], { timeoutMs: 360000 });
  item.evidence = resultFromOutput(result.tail);
  if (!item.evidence) throw Error('The diagnostic did not write a result with successful assertions.');
}
(async () => {
  save(); console.log('REPORT '+path.join(output, 'report.json'));
  await suite('frontend', 'All frontend unit, component and integration tests', async item => {
    const json = path.join(output, 'frontend-results.json');
    await execute(item, node, [path.join(root,'node_modules/react-app-rewired/bin/index.js'), 'test', '--watch=false', '--runInBand', '--testTimeout=30000', '--json', '--outputFile='+json], { env: { ...env, BABEL_ENV: 'test' }, timeoutMs: 1200000 });
    const data = JSON.parse(fs.readFileSync(json));
    item.counts = { suites: data.numTotalTestSuites, tests: data.numTotalTests, passed: data.numPassedTests, failed: data.numFailedTests, pending: data.numPendingTests };
    item.evidence = { file: json }; if (!data.success || !data.numTotalTests) throw Error('Frontend tests did not report a successful nonempty run.');
  });
  await suite('backend', 'All backend and installed-parser tests', async item => {
    const inputs = [...files(path.join(root,'server'), file => /\.test\.(?:c?js)$/.test(file)), ...files(path.join(root,'scripts'), file => /\.test\.cjs$/.test(file))];
    const result = await execute(item, node, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...inputs], { timeoutMs: 360000 });
    item.testFiles = inputs.map(file => path.relative(root,file)); item.counts = result.tail.match(/# (?:tests|pass|fail|skipped) \d+/g);
  });
  await suite('capacity', 'Large archive validation and synthetic legacy roundtrip', async item => {
    const benchmark = path.join(output, 'synthetic-legacy-project.json');
    const rows = Array.from({length:400},(_,index)=>({traceId:'TRACE-'+index,fromFunction:'Producer '+index,toFunction:'Consumer '+index,controlAction:'Command '+index,fromDetails:'Recorded synthetic function evidence. '.repeat(1000)}));
    fs.writeFileSync(benchmark,JSON.stringify({type:'xhandle-code-architecture-project',project:{id:'regression-archive',name:'Synthetic archive',activeRepoId:'repo'},repos:[{repo:{id:'repo',repoId:'repo',repoName:'synthetic'},rows,analysis:{artifactRows:{}}}]}));
    const json = path.join(output, 'capacity-results.json');
    await execute(item,node,[path.join(root,'node_modules/react-app-rewired/bin/index.js'),'test','--watch=false','--runInBand','--json','--outputFile='+json,'src/features/code-architecture-transfer/projectArchive.checksum-compatibility.test.js','src/features/code-architecture-transfer/projectArchive.benchmark.test.js'],{env:{...env,BABEL_ENV:'test',XHANDLE_INTERNAL_CHECKSUM_LARGE:'1',XHANDLE_EXPORT_BENCHMARK_FILE:benchmark},timeoutMs:480000});
    const data=JSON.parse(fs.readFileSync(json));item.counts={tests:data.numTotalTests,passed:data.numPassedTests,pending:data.numPendingTests};item.evidence={file:json};if(!data.success||data.numPendingTests)throw Error('Capacity checks must execute without skipped tests.');
  });
  await suite('native-node', 'Desktop native security, recovery, update and staging tests', async item => {
    const inputs = files(path.join(desktop,'test'), file => /\.test\.cjs$/.test(file));
    const result = await execute(item, node, ['--test','--test-concurrency=1','--test-reporter=tap',...inputs], { cwd: desktop, timeoutMs: 240000 });
    item.testFiles = inputs.map(file => path.relative(desktop,file)); item.counts = result.tail.match(/# (?:tests|pass|fail|skipped) \d+/g);
  });
  await suite('native-python', 'Desktop release validation tests', async item => { await execute(item, 'python3', ['-m','unittest','discover','-s','test','-p','*_test.py'], { cwd: desktop, timeoutMs: 120000 }); });
  await suite('build', 'Fresh production renderer and native runtime staging', async item => {
    fs.mkdirSync(path.join(stage,'stage'), { recursive:true });
    fs.cpSync(path.join(desktop,'electron'),path.join(stage,'electron'),{recursive:true});
    fs.copyFileSync(path.join(desktop,'package.json'),path.join(stage,'package.json'));
    fs.symlinkSync(path.join(desktop,'node_modules'),path.join(stage,'node_modules'),process.platform==='win32'?'junction':'dir');
    const backend=path.join(stage,'stage/backend');require(path.join(desktop,'scripts/stage-backend-runtime.cjs')).stageBackendRuntime(root,backend);
    fs.copyFileSync(path.join(desktop,'electron/backend.cjs'),path.join(backend,'desktop-backend.cjs'));
    fs.symlinkSync(path.join(root,'node_modules'),path.join(backend,'node_modules'),process.platform==='win32'?'junction':'dir');
    for(const name of ['icon.png','notices'])if(fs.existsSync(path.join(desktop,'stage',name)))fs.cpSync(path.join(desktop,'stage',name),path.join(stage,'stage',name),{recursive:true,dereference:true});
    fs.writeFileSync(path.join(stage,'build-metadata.json'),JSON.stringify({desktopVersion:require(path.join(desktop,'package.json')).version,reviewWorkingTree:true,reviewDescription:'Isolated comprehensive Electron regression',regressionSource:source}));
    await execute(item,node,[path.join(root,'node_modules/react-app-rewired/bin/index.js'),'build'],{env:{...env,CI:'false',BUILD_PATH:path.join(stage,'stage/renderer'),PUBLIC_URL:'/',GENERATE_SOURCEMAP:'false'},timeoutMs:600000});
    item.renderer=fingerprint(path.join(stage,'stage/renderer'),['.']);
  });
  await suite('fixtures','Build synthetic workspace fixtures',async item=>{
    const fixtureDir=path.join(output,'fixtures');
    const result=await execute(item,node,[diagnostic('build-desktop-gui-audit-fixtures.cjs'),fixtureDir],{env:{...env,PERF_RELATIONSHIP_COUNT:'320'},timeoutMs:180000});
    const next=await command(node,[diagnostic('build-collaborator-current-view-fixture.cjs'),fixtureDir],{cwd:root,env,log:path.join(output,'fixtures-current-view.log'),timeoutMs:120000});
    if(next.exitCode!==0||next.timedOut)throw Error(next.tail.slice(-3000));
    require('./electron-regression-support.cjs').stageFixtureWorkers(fixtureDir,stage);item.details=result.tail.slice(-400);
  });
  await suite('shell','Native protocol, preload, backend and persisted reload smoke',async item=>{
    const result=await execute(item,electron,[stage,'--smoke-test'],{timeoutMs:120000});
    if(!/persistent|smoke/i.test(result.tail))throw Error('Native smoke produced no verification output.');item.details=result.tail.slice(-2000);
  });
  await suite('workspace','Populated cross-area interactions and large-project responsiveness',async item=>live(item,'electron-workspace-regression.cjs',['--fixtures',path.join(output,'fixtures')]));
  await suite('hara','Projects and Code-Based Architecture HARA',async item=>live(item,'verify-project-hara.cjs',['--fixtures',path.join(output,'fixtures')]));
  await suite('hazard-profile','Enabled and disabled organization profiles in both hazard areas',async item=>live(item,'verify-hazard-organization-profile.cjs'));
  await suite('platform-profile','Platform-wide organization context, opt-outs and request preparation performance',async item=>live(item,'verify-platform-organization-profile.cjs'));
  await suite('design','Design library, artifacts, traceability matrix and diagrams',async item=>live(item,'verify-design-derivation-matrix.cjs'));
  await suite('artifact-generation','Artifact evidence recovery, long project completion and accepted persistence',async item=>{
    const result=await execute(item,node,[diagnostic('verify-artifact-evidence-kinds.cjs'),'--electron',electron,'--build',path.join(stage,'stage/renderer')],{timeoutMs:180000});
    item.evidence=resultFromOutput(result.tail);
    if(!item.evidence)throw Error('Artifact generation diagnostic did not produce successful assertions.');
  });
  await suite('derivation','Projects/code/mixed derivation without hazard analysis',async item=>live(item,'verify-design-derivation-matrix.cjs',['--requirement-direction-only']));
  await suite('safety-inheritance','Saved hazard obligations and downstream safety significance',async item=>live(item,'verify-design-derivation-matrix.cjs',['--requirement-direction-only','--safety-inheritance']));
  await suite('collaborator','Current-view context across every populated work area',async item=>live(item,'verify-collaborator-current-view.cjs',['--fixtures',path.join(output,'fixtures')]));
  await suite('worker','Large source capture, checksums and layout keep input responsive',async item=>{
    const result=await execute(item,electron,[diagnostic('verify-artifact-worker-responsiveness.cjs')],{env:{...env,XHANDLE_AUDIT_BUILD_DIR:path.join(stage,'stage/renderer')},timeoutMs:180000});
    if(!result.tail.includes('PASS background capture'))throw Error('No successful worker responsiveness assertions.');item.details=result.tail.slice(-3000);
  });
  report.finishedAt=new Date().toISOString();report.finalSource=fingerprint(root);report.sourceChanged=report.finalSource.sha256!==source.sha256;
  report.status=report.suites.some(item=>item.status!=='passed')||report.sourceChanged?'failed':selected?'passed (partial selection)':'passed';
  if(report.sourceChanged)report.coverage.push('Application source changed during the run; results do not certify the final working tree. Run again.');
  save();console.log('RESULT '+path.join(output,'report.json')+' '+report.status);if(report.status==='failed')process.exitCode=1;
})().catch(error=>{report.status='failed';report.fatal=error.stack;save();console.error(error);process.exitCode=1;});
