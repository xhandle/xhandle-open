// Read-only audit of production functions. No provider requests or browser writes.
const fs=require('fs'),path=require('path'),Module=require('module');
const root=path.resolve(__dirname,'../../..');
const babel=require(path.join(root,'node_modules/@babel/core'));
const originalLoad=Module._load,originalJS=Module._extensions['.js'];
Module._load=function(request,parent,isMain){
 if(request.endsWith('/aiAnalysisSTPA'))return {fetchLLMResponse:()=>{throw new Error('Live provider calls forbidden in audit');}};
 return originalLoad.apply(this,arguments);
};
Module._extensions['.js']=function(module,file){
 if(file.startsWith(path.join(root,'src/features/code-architecture-hazard-analysis/'))){
  const code=babel.transformSync(fs.readFileSync(file,'utf8'),{babelrc:false,configFile:false,plugins:[require.resolve(path.join(root,'node_modules/@babel/plugin-transform-modules-commonjs'))]}).code;
  module._compile(code,file);
 }else originalJS(module,file);
};
const {generateFastHazards,fastHazardPrompt}=require(path.join(root,'src/features/code-architecture-hazard-analysis/fastHazardPipeline'));
const {semanticReviewPrompt}=require(path.join(root,'src/features/code-architecture-hazard-analysis/fastHazardSemanticReview'));
const {answer}=require(path.join(root,'src/features/code-architecture-hazard-analysis/fastHazardTestFixtures'));
const {buildClaudeRequestPayload}=require(path.join(root,'server/aiProviderPayloads'));
const assert=require('assert');
const report={};
const model=buildClaudeRequestPayload({model:'claude-haiku-5-5',body:{effort:'medium',temperature:0.3,max_tokens:14000},conversation:[{role:'user',content:'test'}]});
report.haikuPayload={model:model.model,effort:model.output_config||null,temperature:model.temperature};
assert.equal(model.output_config,undefined);assert.equal(model.temperature,0.3);
const rows=p=>JSON.parse(p.split('\nRows: ')[1]);
const source=n=>Array.from({length:n},(_,i)=>({id:String(i),action:'Apply torque'}));
async function failedReview(n){
 let generation=0,review=0;
 try{await generateFastHazards({method:'STPA',sources:source(n),context:{},request:async p=>{generation++;return rows(p).map(({id})=>answer('STPA',id));},reviewRequest:async()=>{review++;return 'malformed';}});}catch(e){assert.equal(e.code,'COMPACT_HAZARD_INCOMPLETE');return {rows:n,generation,review,accepted:e.partialResults.length};}
 throw new Error('Invalid reviews must not pass');
}
async function tailBarrier(){
 let release,entered;const tail=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});
 const progress=[],sourceRows=source(16);
 let reviewCalls=0;
 const pending=generateFastHazards({method:'STPA',sources:sourceRows,context:{},onProgress:p=>progress.push(p.completed),
 request:async p=>rows(p).map(({id})=>({...answer('STPA',id),extraNarrative:'x'.repeat(3200)})),
 reviewRequest:async p=>{reviewCalls++;const data=JSON.parse(p.split('\nAssessments: ')[1]);if(reviewCalls===2){entered();await tail;}return data.map(({source})=>({id:source.id,issues:[]}));}});
 await ready;const acceptedWhileTailWaits=Math.max(...progress);release();await pending;
 return {reviewCalls,acceptedWhileTailWaits,acceptedAfterTail:Math.max(...progress)};
}
(async()=>{
 const originalInfo=console.info;console.info=()=>{};
 try{
 const forcedSizes=[];
 await generateFastHazards({method:'STPA',sources:source(16),context:{analysisContext:'x'.repeat(27000)},
 request:async p=>{forcedSizes.push({rows:rows(p).length,chars:p.length});return rows(p).map(({id})=>answer('STPA',id));},
 reviewRequest:async p=>JSON.parse(p.split('\nAssessments: ')[1]).map(({source})=>({id:source.id,issues:[]}))});
 report.oversizedSharedContext={rows:16,generationCalls:forcedSizes.length,minPromptChars:Math.min(...forcedSizes.map(x=>x.chars)),batchSizes:forcedSizes.map(x=>x.rows)};
 assert.equal(forcedSizes.length,16);assert(forcedSizes.every(x=>x.rows===1 && x.chars>32000));
 report.reviewFailureSingleton=await failedReview(1);
 report.reviewFailureBatch=await failedReview(16);
 report.reviewTailBarrier=await tailBarrier();
 assert.equal(report.reviewFailureSingleton.generation,3);assert.equal(report.reviewFailureSingleton.review,6);
 assert.equal(report.reviewTailBarrier.acceptedWhileTailWaits,0);
 const csvPath=process.argv[2];
 if(csvPath && fs.existsSync(csvPath)){
  const Papa=require(path.join(root,'node_modules/papaparse'));
  const {data,meta}=Papa.parse(fs.readFileSync(csvPath,'utf8'),{header:true,skipEmptyLines:true});
  const fields={uca:'Unsafe Control Action',loss:'Loss',hazard:'Hazard',causalScenario:'Causal Scenario',causalFactor:'Causal Factor',safetyConstraint:'Safety Constraint',softwareRequirement:'Software Safety Requirement',verification:'Verification',applicable:'Guide Phrase Applicable',applicabilityRationale:'Guide Phrase Applicability Rationale',classification:'Safety Classification',classificationRationale:'Safety Significance Rationale',assumptions:'Assumptions',assessedAction:'Assessed Control Action',causalBasis:'Causal Assessment Basis',causalEvidence:'Causal Evidence / Assumption',evidenceQuote:'Causal Evidence Quote',executionDependency:'Execution Dependency',executionEvidenceQuote:'Execution Evidence Quote',operatorDependency:'Operator Dependency',operatorContextQuote:'Operator Context Quote'};
  const entries=data.map((r,i)=>({source:{id:String(i),from:r['Function (From)'],action:r['Control Action'],to:r['Function (To)'],phrase:r['Guide Phrase'],context:{scenario:r['Operational Scenario'],mode:r['Operational Mode'],conditions:r['Operating Conditions'],assumptions:r['Context Assumptions']}},assessment:{id:String(i),...Object.fromEntries(Object.entries(fields).map(([key,header])=>[key,r[header]]))}}));
  const yes=entries.filter(e=>e.assessment.applicable==='Yes'),size=arr=>JSON.stringify(arr.map(e=>e.assessment)).length;
  const sizes=yes.map(e=>size([e])).sort((a,b)=>a-b);
  let batches=[],batch=[];
  for(const e of entries){if(batch.length && (batch.length>=16 || fastHazardPrompt('STPA',[...batch.map(x=>x.source),e.source],{}).length>32000)){batches.push(batch);batch=[];}batch.push(e);}if(batch.length)batches.push(batch);
  const reviewSizes=batches.flatMap(group=>{const result=[];let batch=[];for(const e of group){if(batch.length && (batch.length>=24 || semanticReviewPrompt('STPA',[...batch,e],{}).length>60000)){result.push(batch.length);batch=[];}batch.push(e);}if(batch.length)result.push(batch.length);return result;});
  report.csv={rows:entries.length,columns:meta.fields.length,yes:yes.length,no:entries.length-yes.length,assessmentJSONChars:{min:sizes[0],median:sizes[Math.floor(sizes.length/2)],max:sizes.at(-1)},sixteenApplicableOutputChars:size(yes.slice(0,16)),first16ReviewPromptChars:semanticReviewPrompt('STPA',yes.slice(0,16),{}).length,emptyGenerationPromptChars:fastHazardPrompt('STPA',[],{}).length,generationBatchSizes:batches.map(b=>b.length),reviewBatchSizes:reviewSizes,limitation:'Reconstruction omits original code evidence and shared organization context absent from this export. Sizes are not the live run or exact token counts.'};
 }
 }finally{console.info=originalInfo;}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
