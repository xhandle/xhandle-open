const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
// Run from the repository root. Only synthetic responses are used.
const root = process.cwd();
const parser = require(root + '/node_modules/@babel/parser');
const source = fs.readFileSync(root + '/src/components/generateFunctionalDecompositionFromGitHub.js', 'utf8');
const ast = parser.parse(source, {sourceType:'module',plugins:['jsx']});
function functions(names) {
  return ast.program.body.map(n => n.type === 'ExportNamedDeclaration' ? n.declaration : n)
    .filter(n => n?.type === 'FunctionDeclaration' && names.includes(n.id.name))
    .map(n => source.slice(n.start,n.end)).join('\n');
}
(async () => {
  const eligibility = fs.readFileSync(root + '/src/features/code-architecture-hazard-analysis/codeArchitectureHazardEligibility.js','utf8').replace(/export /g,'');
  const ctx = vm.createContext({}); vm.runInContext(eligibility,ctx);
  ctx.row = {from:'dispatch',to:'consume',fromFile:'src/main.py',toFile:'src/worker.py',action:'Call consume',fromDetails:'Runtime command delivery'};
  const first = vm.runInContext('classifyCodeArchitectureHazardEligibility(row)',ctx);
  ctx.row = {...ctx.row,toDetails:'A class member that processes runtime commands'};
  const second = vm.runInContext('classifyCodeArchitectureHazardEligibility(row)',ctx);
  assert.equal(first.hazardAnalysisEligibility,'Include'); assert.equal(second.hazardAnalysisEligibility,'Exclude');
  console.log('CONFIRMED prose-only change:',first.lifecyclePhase,'->',second.lifecyclePhase);
  ctx.row = {...ctx.row,toDetails:'',fromFile:'src/__init__.py'};
  assert.equal(vm.runInContext('classifyCodeArchitectureHazardEligibility(row)',ctx).lifecyclePhase,'Static Structure');
  console.log('CONFIRMED __init__.py runtime row excluded by structural rule');
  const dedupe = vm.createContext({});
  vm.runInContext(functions(['normalizeFunctionLabelForEvidence','dedupeFunctionalDecompositionRows']),dedupe);
  dedupe.rows = [{from:'Run',action:'Call consume',to:'consume',fromFile:'a.py',toFile:'a.py'}, {from:'Run',action:'Call consume',to:'consume',fromFile:'b.py',toFile:'b.py'}];
  assert.equal(vm.runInContext('dedupeFunctionalDecompositionRows(rows).length',dedupe),1);
  console.log('CONFIRMED distinct file-scoped relationships collapse');
  dedupe.rows[1] = {...dedupe.rows[0],action:'Invoke consume'};
  assert.equal(vm.runInContext('dedupeFunctionalDecompositionRows(rows).length',dedupe),2);
  console.log('CONFIRMED wording-only duplicate retained');
  const requests = [];
  const fetchCtx = vm.createContext({encodeURIComponent, encodeURI, atob, githubHeaders:()=>({}), jsonFetch:async url=>{
    requests.push(url);
    if(url.includes('/git/trees/feature')) throw Error('simulated acquisition error');
    return {truncated:true,tree:[{type:'blob',path:'src/main.py',sha:'x',size:20}]};
  }});
  vm.runInContext(functions(['listRepoFilesViaGitHub']),fetchCtx);
  assert.equal((await vm.runInContext("listRepoFilesViaGitHub('owner','repo',null,'feature')",fetchCtx)).length,1);
  assert(requests[1].includes('/git/trees/master'));
  console.log('CONFIRMED failed selected branch silently uses master and truncated inventory accepted');
  const content='def café():\n    return "车辆"\n';
  const decodeCtx=vm.createContext({atob,encodeURIComponent,encodeURI,githubHeaders:()=>({}),jsonFetch:async()=>({encoding:'base64',content:Buffer.from(content).toString('base64')})});
  vm.runInContext(functions(['fetchGitHubFileDirect']),decodeCtx);
  const decoded=await vm.runInContext("fetchGitHubFileDirect({owner:'o',repo:'r',path:'x.py',token:'synthetic',ref:'main',sha:'x'})",decodeCtx);
  assert.notEqual(decoded.content,content);
  console.log('CONFIRMED GitHub base64 path corrupts UTF-8 compared with File.text():',JSON.stringify(decoded.content));
  const local = fs.readFileSync(root+'/src/features/code-architecture-context/localCodeSource.js','utf8');
  const textPattern=local.split('\n').find(line=>line.startsWith('const TEXT_FILE ='));
  const extCtx=vm.createContext({});vm.runInContext(textPattern,extCtx);
  assert.equal(vm.runInContext("TEXT_FILE.test('src/main.c++')",extCtx),false);
  assert.equal(/\.(mjs|cjs|js|jsx|ts|tsx|py|c|cc|cp|cpp|cxx|c\+\+|h|hh|hpp|hxx|h\+\+|ipp|inl|tpp)$/i.test('src/main.c++'),true);
  console.log('CONFIRMED .c++ accepted by shared default selection but unavailable locally');
  console.log('7 isolated probes passed; all network responses synthetic.');
})().catch(error=>{console.error(error);process.exitCode=1;});
