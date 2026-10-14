// Offline production-code verification. No provider requests or browser writes.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../../..');
const babel=require(path.join(root,'node_modules/@babel/core'));
const originalLoad=Module._load,originalJS=Module._extensions['.js'];
Module._load=function(request){
 if(request.endsWith('/aiAnalysisSTPA'))return {fetchLLMResponse:()=>{throw new Error('Live provider calls forbidden in verification');}};
 return originalLoad.apply(this,arguments);
};
Module._extensions['.js']=function(module,file){
 if(file.startsWith(path.join(root,'src/'))){
  const code=babel.transformSync(fs.readFileSync(file,'utf8'),{babelrc:false,configFile:false,plugins:[require.resolve(path.join(root,'node_modules/@babel/plugin-transform-modules-commonjs'))]}).code;
  module._compile(code,file);
 }else originalJS(module,file);
};
const local=new Map([['xhandle.aiProvider.active','anthropic'],['xhandle.aiProviderModel.anthropic','claude-haiku-5-5']]);
global.localStorage={getItem:key=>local.get(key) || null};
const {generateFastHazards}=require(path.join(root,'src/features/code-architecture-hazard-analysis/fastHazardPipeline'));
const {answer}=require(path.join(root,'src/features/code-architecture-hazard-analysis/fastHazardTestFixtures'));
const {buildClaudeRequestPayload}=require(path.join(root,'server/aiProviderPayloads'));
const rows=p=>JSON.parse(p.split('\nRows: ')[1]);
const reviewRows=p=>JSON.parse(p.split('\nAssessments: ')[1]);
const source=n=>Array.from({length:n},(_,i)=>({id:String(i),action:'Apply torque'}));
const options={method:'STPA',context:{analysisContext:'x'.repeat(27000)},sources:source(16)};
const report={kind:'Offline request-count verification; no measured provider latency or SLA'};
(async()=>{
 const originalInfo=console.info;console.info=()=>{};
 try{
  const payload=buildClaudeRequestPayload({model:'claude-haiku-5-5',body:{effort:'medium',temperature:0.3,max_tokens:24000},conversation:[{role:'user',content:'test'}]});
  assert.equal(payload.temperature,undefined);assert.deepEqual(payload.output_config,{effort:'medium'});
  report.haikuPayload={effort:payload.output_config.effort,temperaturePresent:'temperature' in payload,maxTokens:payload.max_tokens};
  const batches=[];
  await generateFastHazards({...options,request:async(p,settings)=>{batches.push({rows:rows(p).length,inputChars:p.length,maxTokens:settings.maxTokens});return rows(p).map(({id})=>answer('STPA',id));},reviewRequest:async p=>reviewRows(p).map(({source})=>({id:source.id,issues:[]}))});
  assert(batches.every(b=>b.rows>1 && b.inputChars>32000));
  report.largeSharedContext={rows:16,batches};
  const saved=new Map(),checkpoint={read:async key=>saved.get(JSON.stringify(key)),write:async(key,value)=>saved.set(JSON.stringify(key),value)};
  let generation=0,review=0;
  const attempts=new Map();
  const request=async p=>{generation++;return rows(p).map(({id})=>answer('STPA',id));};
  try{await generateFastHazards({...options,checkpoint,request,reviewRequest:async p=>{review++;reviewRows(p).forEach(({source})=>attempts.set(source.id,(attempts.get(source.id)||0)+1));return 'malformed';}});assert.fail('Expected bounded review failure');}
  catch(e){assert.equal(e.code,'COMPACT_HAZARD_INCOMPLETE');assert.equal(e.partialResults.length,0);}
  assert([...attempts.values()].every(count=>count===3));
  assert([...saved.values()].every(v=>v.kind==='pending-narrative-review'));
  report.malformedReviews={generationRequests:generation,reviewRequests:review,attemptsPerRow:Math.max(...attempts.values()),pendingCandidates:saved.size};
  const before=generation;
  const result=await generateFastHazards({...options,checkpoint,request,reviewRequest:async p=>reviewRows(p).map(({source})=>({id:source.id,issues:[]}))});
  assert.equal(generation,before);assert.equal(result.length,16);
  report.continue={additionalGenerationRequests:generation-before,accepted:result.length};
 }finally{console.info=originalInfo;}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
