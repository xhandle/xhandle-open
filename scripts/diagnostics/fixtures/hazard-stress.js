import {runLiteAIAnalysis} from '../../../src/components/aiAnalysisLite';
import {runCodeArchitectureHazardAnalysis} from '../../../src/features/code-architecture-hazard-analysis/codeArchitectureHazardRunner';
import {getCodeArchitectureHazardRunById} from '../../../src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore';
import {saveProjectHazardAnalysisRecord,loadProjectHazardAnalysisRecord} from '../../../src/features/project-hazard-analysis/projectHazardAnalysisStorage';
import {saveRecoveryRecord,recoveryRecord} from '../../../src/lib/durableRecovery';
import {buildHazardOperationalContextPrompt} from '../../../src/features/project-hazard-analysis/hazardOperationalContexts';
import {storeAIProviderModelPreference} from '../../../src/lib/aiProviderConfig';
import {fetchLLMResponse} from '../../../src/components/aiAnalysisSTPA';
import {createProjectHazardCheckpoint} from '../../../src/features/project-hazard-analysis/projectHazardGenerationCheckpoint';
import {openCodeArchitectureHazardDB} from '../../../src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore';
window.hazardTransportProbe=()=>fetchLLMResponse('Rows: [{"id":"transport-probe"}]',{},[],'',{workflow:'hazard-row-generation'});

const phrases=['Not providing the control action causes a hazard','Providing the control action causes a hazard','The control action is provided too early','The control action is provided too late','The control action is provided in the wrong order','The control action is stopped too soon','The control action is applied too long'];
const contexts=Array.from({length:3},(_,index)=>({id:'crossing-'+index,scenario:['Occupied urban crossing','Occupied rural crossing','Occupied school crossing'][index],mode:'Automated driving',conditions:'Wet pavement; frequent crossings; no human driver.',assumptions:'Supplied item timing analysis establishes 100 ms before crossing entry.'}));
const itemDefinition='Automated braking item: controller and brake actuator; frequent pedestrian crossings; no driver; supplied hazard timing analysis establishes 100 ms before crossing entry.';
const assert=(condition,message)=>{if(!condition)throw Error(message);};
let activeController;
window.cancelHazardStress=()=>activeController?.abort();
window.hazardStressCommittedAssessmentIds=async()=>{
 const db=await openCodeArchitectureHazardDB(),records=await db.getAll('generationCheckpoints');
 return [...new Set(records.flatMap(record=>Array.isArray(record.value)?record.value:[record.value]).filter(value=>value?.id&&(value.safetyConstraint||value.safetyRequirementsConstraints)).map(value=>value.id))];
};
window.hazardStress={state:'idle',probeClicks:0};
const probe=document.createElement('button');probe.textContent='Hazard stress responsiveness probe';probe.style='position:fixed;bottom:4px;right:4px;z-index:2147483647;background:#fff;border:1px solid #555;padding:8px';probe.onclick=()=>window.hazardStress.probeClicks++;document.body.appendChild(probe);
window.runHazardStress=async({area,method,interfaces=32,id=area+'-'+method+'-'+interfaces,cancelAt=0,previousRunId=null})=>{
 const controller=new AbortController(),started=performance.now();let outcome='running';activeController=controller;
 const state={state:'running',area,method,id,interfaces,expected:interfaces*contexts.length*phrases.length,progress:{},probeClicks:0,publications:0,stages:[],maxEventLoopGapMs:0,samples:0,peakHeapBytes:0};window.hazardStress=state;
 const gaps=[];state.worstGaps=[];state.phase="generation";let last=performance.now();
 const timer=setInterval(()=>{const now=performance.now();gaps.push(now-last);if(now-last>250){state.worstGaps.push({ms:now-last,phase:state.phase,progress:state.progress,heap:performance.memory?.usedJSHeapSize,at:new Date().toISOString()});state.worstGaps.sort((a,b)=>b.ms-a.ms);state.worstGaps.length=Math.min(10,state.worstGaps.length);}state.maxEventLoopGapMs=Math.max(state.maxEventLoopGapMs,now-last);last=now;state.samples++;state.peakHeapBytes=Math.max(state.peakHeapBytes,performance.memory?.usedJSHeapSize||0);},25);
 const progress=patch=>{state.progress=patch;if(cancelAt&&patch.completed>=cancelAt)controller.abort();};
 const functions=Array.from({length:interfaces},(_,index)=>({id:id+'-function-'+index,traceId:id+'-function-'+index,fromFunction:'Vehicle controller '+index,from:'Vehicle controller '+index,controlAction:'Brake command',action:'Brake command',toFunction:'Brake actuator',to:'Brake actuator',fromDetails:itemDefinition,controlDetails:'The brake actuator depends on the brake command to stop the vehicle at occupied crossings. The maintained command has a validity interval and ordered enable prerequisites.',toDetails:'The brake actuator applies commanded braking to stop the vehicle.',rowRef:index+1,hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual'}));
 try{
  localStorage.setItem('xhandle.aiProvider.active','anthropic');storeAIProviderModelPreference('anthropic','claude-haiku-5-5');
  let sheets,runId;
  if(area==='projects'){
   const rows=functions.flatMap((fn,index)=>phrases.flatMap((guidePhrase,phrase)=>contexts.map(context=>({...fn,guidePhrase,hazardContextId:context.id,operationalScenario:context.scenario,operationalMode:context.mode,operatingConditions:context.conditions,contextAssumptions:context.assumptions,hazardDraftIdentity:`${index}:guide:${phrase}:context:${context.id}`}))));
   const fields=['fromFunction','fromDetails','controlAction','controlDetails','toFunction','toDetails','hazardContextId','operationalScenario','operationalMode','operatingConditions','contextAssumptions','guidePhrase'];
   const headers=['Function (From)','Function (From) Details','Control Action','Control Action Details','Function (To)','Function (To) Details','Operational Context ID','Operational Scenario','Operational Mode','Operating Conditions','Context Assumptions','Guide Phrase'];
   let folders={},latestStage=null;
   const setFolders=async update=>{folders=typeof update==='function'?update(folders):update;state.publications++;await saveRecoveryRecord('hazard-run:'+id,{projectId:id,method,folders,responseRows:functions,contexts,latestStage,status:'in-progress'});};
   const generationCheckpoint=await createProjectHazardCheckpoint(id,method,{signal:controller.signal});
   sheets=await runLiteAIAnalysis({generationCheckpoint,tableRows:rows,sheets:{'Functional Decomposition':[headers,...rows.map(row=>fields.map(field=>row[field]))]},setFolders,currentFolder:'LiteProject',hazardMethod:method==='STPA'?'STPA-Textbook':'HARA',haraItemDefinition:itemDefinition,omitConsolidatedRequirement:true,operationalContext:buildHazardOperationalContextPrompt(contexts),signal:controller.signal,setProgress:progress,onStageComplete:async stage=>{state.stages.push({stage:stage.stage,rows:stage.rows?.length});latestStage=generationCheckpoint?{stage:stage.stage,rowCount:stage.rows?.length||0,checkpointed:true}:stage;if(stage.stage!=='hara-assessment')await setFolders(folders);}});
   state.phase="final-save";const saved=await saveProjectHazardAnalysisRecord(id,{analysisResult:sheets,methods:{[method==='STPA'?'STPA-Textbook':'HARA']:{analysisResult:sheets}}});assert(saved,'Projects final results were not saved');
   state.phase="reload";const reloaded=await loadProjectHazardAnalysisRecord(id);assert(reloaded?.analysisResult?.Summary?.length===state.expected+1,'Projects reload row count differs');
  }else{
   const previousRun=previousRunId?await getCodeArchitectureHazardRunById(previousRunId):null;
   const run=await runCodeArchitectureHazardAnalysis({projectId:id,repoMeta:{repoId:id+'-repo',repoName:'Braking '+id},cbaRows:functions,method:method==='STPA'?'STPA-Textbook':'HARA',operationalContexts:contexts,previousRun,signal:controller.signal,setProgress:progress});
   assert(run.runState==='complete','Code analysis did not reach a complete state');sheets=run.generatedSheets;runId=run.id;
   // The UI intentionally returns while large final writes continue. Wait for
   // committed metadata, then bypass the unsaved in-memory result on reload.
   const saveStarted=performance.now(),db=await openCodeArchitectureHazardDB();
   for(;;){const root=await db.get('hazardAnalysisRuns',run.id);if((root?.runState||root?.payload?.rowIndex?.metadata?.runState)==='complete')break;assert(performance.now()-saveStarted<240000,'Final save never committed');await new Promise(resolve=>setTimeout(resolve,100));}
   db.close();state.finalSaveWaitMs=performance.now()-saveStarted;
   const reloaded=await getCodeArchitectureHazardRunById(run.id,{committedOnly:true});assert(reloaded?.generatedSheets?.Summary?.length===state.expected+1,'Code committed reload row count differs');
  }
  state.phase="validation";const [headers,...rows]=sheets.Summary;
  assert(rows.length===state.expected,'Analysis dropped assessment rows');
  const column=(...names)=>names.map(name=>headers.indexOf(name)).find(index=>index>=0);
  const applicable=column('Guide Phrase Applicable'),hazard=column('Hazard','Hazards'),constraint=column('Safety Constraint','Safety Requirements/Constraints'),rawId=column('Raw Analysis Row ID','STPA ID');
  state.applicabilityCounts=Object.fromEntries([...new Set(rows.map(row=>row[applicable]))].map(value=>[value,rows.filter(row=>row[applicable]===value).length]));
  state.unresolvedSample=rows.filter(row=>!['Yes','No'].includes(row[applicable])).slice(0,2).map(row=>Object.fromEntries(headers.map((header,i)=>[header,row[i]])));
  const rationale=column('Guide Phrase Applicability Rationale');
  assert(rows.every(row=>['Yes','No','Needs Review'].includes(row[applicable])&&row[rationale]),'An assessment has no applicability decision or explanation');
  assert(rows.every(row=>row[applicable]==='No'||(row[hazard]&&row[constraint])),'Applicable rows have missing hazards or constraints');
  if(rawId!==undefined)assert(new Set(rows.map(row=>row[rawId])).size===rows.length,'Assessment identities are not unique');
  if(method==='HARA'){
   for(const name of ['Severity','Exposure','Controllability','ASIL','Safety Goal','Fault Tolerant Time Interval'])assert(rows.every(row=>row[applicable]==='No'||row[headers.indexOf(name)]),'HARA omitted '+name);
   assert(rows.every(row=>row[applicable]==='No'||row[headers.indexOf('ASIL')]==='ASIL D'),'Deterministic ASIL is inconsistent');
   state.safetyGoals=sheets['Safety Goals']?.length-1;
  }
  const basis=column('Assessment Basis');state.assumptionFallbackRows=basis===undefined?0:rows.filter(row=>/Assumption-based/i.test(row[basis])).length;
  state.rows=rows.length;state.runId=runId;outcome='complete';
 }catch(error){
  outcome=controller.signal.aborted?'cancelled':'failed';state.error={name:error.name,message:error.message,code:error.code};
  if(area==='projects'){const recovery=await recoveryRecord('hazard-run:'+id);state.recovery={rows:Math.max(0,(recovery?.folders?.LiteProject?.Summary?.length||1)-1),stage:recovery?.latestStage?.stage};}
  else state.recovery={runId:error.recoveryRun?.id,rows:error.recoveryRun?.validatedAssessments||0};
 }finally{
  const db=await openCodeArchitectureHazardDB();state.checkpointCount=await db.count('generationCheckpoints');
  if(outcome==='cancelled'){
   // A served response may still be in flight or fail validation. Recovery is
   // required to reuse committed assessments, not every provider response.
   state.committedAssessmentIds=await window.hazardStressCommittedAssessmentIds();
  }
  clearInterval(timer);gaps.sort((a,b)=>a-b);state.p95EventLoopGapMs=gaps[Math.min(gaps.length-1,Math.floor(gaps.length*.95))]||0;state.elapsedMs=performance.now()-started;
  state.state=outcome;
 }
 return state;
};
