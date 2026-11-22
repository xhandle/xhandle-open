const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Execute the actual non-exported analysis stages, isolating only provider,
// storage and rendering boundaries. No real source or provider is contacted.
const source = fs.readFileSync(path.resolve(__dirname, '../../src/components/generateFunctionalDecompositionFromGitHub.js'), 'utf8');
const names = new Set(['throwIfAborted', 'deriveSystemUnderstanding', 'requestOpenAIProxyWithRetry',
  'generateNestedArchitectureAllocationPlan', 'generateArchitectureComponentDescriptions',
  'classifyArchitectureRows', 'ensureCodeArchitectureTraceIdsCooperative', 'buildCodeEvidenceForRows', 'sourceSnippetForFunction']);
const functions = [];
traverse(parse(source, { sourceType:'module', plugins:['jsx'] }), {
  FunctionDeclaration({node}) { if (names.has(node.id?.name)) functions.push(source.slice(node.start, node.end)); },
});
// Enrichment now lives in shared production data modules. Execute their actual
// declarations too; keep provider/storage boundaries isolated as before.
for (const [file, selected] of [
  ['src/features/code-architecture-context/finalizationBatches.js',['estimateJsonMemory','createByteCache','mapFinalizationBatches']],
  ['src/features/code-architecture-context/codeEvidenceEnrichment.js',['enrichCodeEvidenceRows']],
  ['src/features/code-architecture-storage/chunkedRecord.js',['freezeEvidence']],
]) {
  const text=fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');
  traverse(parse(text,{sourceType:'module'}),{FunctionDeclaration({node}){if(selected.includes(node.id?.name))functions.push(text.slice(node.start,node.end));}});
}
function fixture() {
  const requests = [], warnings = [];
  const context = {
    AbortController, DOMException, Error, Map, Set, WeakMap, WeakSet, JSON, performance, setTimeout, clearTimeout,
    console:{warn:(...args)=>warnings.push(args),info:()=>{}},
    MAX_SYSTEM_UNDERSTANDING_CHARS:3200, MAX_AI_ARCHITECTURE_ALLOCATION_ROWS:300,
    FUNCTIONAL_OUTPUT_TOKENS:4096, BULK_ANALYSIS_MODEL:'synthetic-model',
    backendURL:'/synthetic',ACCOUNT_ID:'synthetic',AI_RETRY_STATUSES:new Set(),
    formatUserAnalysisContext:()=>'',buildFallbackSystemUnderstanding:()=> 'fallback',
    compactRowsForArchitectureClassification:()=>[],parseStrictJsonFromText:JSON.parse,
    buildFallbackArchitectureDescriptions:()=>new Map(),compactComponentSummaryForDescriptions:()=>[],
    buildArchitectureAllocationMapFromPlan:()=>new Map(),inferArchitectureFallback:()=>({}),
    refineArchitectureAllocation:(_row,value)=>value,architectureDescriptionKey:()=>'',
    codeSourceProvenance:()=>({}),splitRelatedFiles:value=>value?[value]:[],selectSourceFunctionsForRow:()=>[],
    codeSourceIndexKey:(_source,file)=>file,IDB_STORES:{codeIndex:'code_index'},
    localStorage:{getItem:()=>null},idbGet:async()=>null,
    paceDecompositionRequest:async()=>{},buildAIAuthOpts:headers=>({headers}),
    sleep:async(_ms,signal)=>{if(signal?.aborted)throw signal.reason;},
    makeCodeArchitectureTraceId:prefix=>prefix,
  };
  context.requestOpenAIProxyJsonWithMetrics = options => {
    requests.push(options);
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    return new Promise((_resolve,reject)=>options.signal?.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  };
  vm.createContext(context);
  for(const code of functions)vm.runInContext(code,context);
  return {context,requests,warnings};
}
const tick = () => new Promise(resolve=>setImmediate(resolve));

test('Stop aborts repository understanding instead of falling back and continuing',async()=>{
  const {context,requests,warnings}=fixture(),controller=new AbortController();
  const pending=context.deriveSystemUnderstanding({repoContext:{readmeText:'Synthetic README'},signal:controller.signal});
  await tick();assert.equal(requests.length,1);assert.equal(requests[0].signal,controller.signal);
  controller.abort(new Error('Stopped by user'));
  await assert.rejects(pending,/Stopped by user/);assert.equal(warnings.length,0);
});
for(const stage of ['Nested architecture abstraction AI','Architecture component description AI']){
  test(`Stop during ${stage} prevents later classification work`,async()=>{
    const {context,requests,warnings}=fixture(),controller=new AbortController();
    const wait=context.requestOpenAIProxyJsonWithMetrics;
    context.requestOpenAIProxyJsonWithMetrics=options=>options.label===stage?wait(options):Promise.resolve({result:'{}'});
    const pending=context.classifyArchitectureRows({rows:[{from:'producer',to:'consumer',action:'Send data'}],bearer:'synthetic',signal:controller.signal});
    // Cooperative enrichment can yield through a timer before reaching AI.
    // Wait for the observable request rather than assuming a microtask count.
    const deadline=Date.now()+1000;
    while(!requests.length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,2));
    assert.equal(requests.length,1);assert.equal(requests[0].label,stage);
    assert.equal(requests[0].signal,controller.signal);
    controller.abort(new Error('Stopped by user'));
    await assert.rejects(pending,/Stopped by user/);assert.equal(warnings.length,0);
    assert.equal(requests.length,1);
  });
}
test('source evidence cancellation cannot fall through to a legacy storage record',async()=>{
  const {context}=fixture(),controller=new AbortController();let fallbackReads=0;
  context.idbGet=async(_store,_key,options)=>{assert.equal(options.signal,controller.signal);controller.abort(new Error('Stopped during evidence read'));throw controller.signal.reason;};
  context.localStorage.getItem=()=>{fallbackReads++;return null;};
  await assert.rejects(context.buildCodeEvidenceForRows({rows:[{fromFile:'source.py'}],signal:controller.signal}),/Stopped during evidence read/);
  assert.equal(fallbackReads,0);
});
test('settings changed while pacing cannot send source using the new provider',async()=>{
  const {context}=fixture();let changed=false,requests=0;
  context.paceDecompositionRequest=async()=>{changed=true;};
  context.fetch=async()=>{requests++;return {ok:true};};
  const error=Object.assign(new Error('Settings changed'),{code:'SOURCE_RUN_CHANGED'});
  const guard={check:()=>{if(changed)throw error;}};
  await assert.rejects(context.requestOpenAIProxyWithRetry({prompt:'Synthetic source',runGuard:guard}),{code:'SOURCE_RUN_CHANGED'});
  assert.equal(requests,0);
});
test('ordinary provider failure still permits deterministic context fallback',async()=>{
  const {context,warnings}=fixture();
  context.requestOpenAIProxyJsonWithMetrics=async()=>{throw new Error('Provider unavailable');};
  assert.equal(await context.deriveSystemUnderstanding({repoContext:{readmeText:'Synthetic README'}}),'fallback');
  assert.equal(warnings.length,1);
});
test('settings mismatch is fatal even in optional context/classification stages',async()=>{
  const {context}=fixture();
  context.requestOpenAIProxyJsonWithMetrics=async()=>{throw Object.assign(new Error('Settings changed'),{code:'SOURCE_RUN_CHANGED'});};
  for(const operation of [
    ()=>context.deriveSystemUnderstanding({repoContext:{readmeText:'Synthetic README'}}),
    ()=>context.generateNestedArchitectureAllocationPlan({rows:[{}],bearer:'synthetic'}),
    ()=>context.generateArchitectureComponentDescriptions([{}],'synthetic'),
  ])await assert.rejects(operation(),{code:'SOURCE_RUN_CHANGED'});
});
