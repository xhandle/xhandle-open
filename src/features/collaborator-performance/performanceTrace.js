/* global globalThis */
// Renderer-local, bounded numeric telemetry. Never store prompts, answers, IDs of
// projects/records, source paths, credentials or provider error messages.
const reports=[];
const stages=new Set(['context','readPolicy','readPlanning','readExecution','prompt','firstProgress','firstToken','firstVisibleAnswer']);
const workflows=new Set(['collaborator.context-turn','collaborator.context-repair','collaborator.answer','collaborator.request','collaborator.read-plan','collaborator.continuation','collaborator.functional','collaborator.title']);
export const collaboratorWorkflow=value=>workflows.has(value)?value:'collaborator.request';
const duration=value=>Number.isFinite(value)&&value>=0?Math.round(value*10)/10:null;
const identifier=value=>typeof value==='string'&&/^[a-z0-9_.:/-]{1,128}$/i.test(value)?value:null;
export function getCollaboratorPerformanceReports(){return JSON.parse(JSON.stringify(reports));}
export function clearCollaboratorPerformanceReports(){reports.length=0;}
export function createCollaboratorPerformanceTrace({now=()=>performance.now()}={}){
 const start=now(),traceId='ct-'+(globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-local`);
 const report={traceId,durations:{},marks:{},requests:[],readCacheHits:0};let finished=false;
 const mark=name=>{if(stages.has(name)&&report.marks[name]==null)report.marks[name]=duration(now()-start);};
 const timing=({stage,durationMs,cacheHit}={})=>{if(stages.has(stage)&&duration(durationMs)!=null)report.durations[stage]=(report.durations[stage]||0)+duration(durationMs);if(stage==='readExecution'&&cacheHit)report.readCacheHits++;};
 const measure=async(stage,operation)=>{const begin=now();try{return await operation();}finally{timing({stage,durationMs:now()-begin});}};
 const request=(workflow)=>{
  const row={workflow:collaboratorWorkflow(workflow),startMs:duration(now()-start)};
  if(report.requests.length<8)report.requests.push(row);
  return {headers:headers=>{
    row.headersMs=duration(now()-start);
    row.requestId=identifier(headers?.get?.('x-ai-request-id'));
    const provider=headers?.get?.('x-ai-provider-used');row.provider=['openai','claude','gemini'].includes(provider)?provider:null;
    row.model=identifier(headers?.get?.('x-ai-model-used'));
    const effort=headers?.get?.('x-ai-effort-used');row.effort=['low','medium','high','xhigh','automatic','minimal','none'].includes(effort)?effort:null;
   },server:value=>{if(!value||typeof value!=='object')return;const safe={};for(const key of ['timeToFirstTokenMs','providerStartOffsetMs','providerTimeToFirstTokenMs','elapsedMs','inputTextChars','outputTextChars'])if(duration(value[key])!=null)safe[key]=duration(value[key]);row.server=safe;},token:()=>{mark('firstToken');if(row.firstTokenMs==null)row.firstTokenMs=duration(now()-start);},finish:status=>{if(row.completeMs!=null)return;row.completeMs=duration(now()-start);row.status=['completed','failed','canceled','timeout'].includes(status)?status:'failed';}};
 };
 const finish=(status='completed')=>{if(finished)return;finished=true;report.status=['completed','failed','canceled','clarified'].includes(status)?status:'failed';report.totalMs=duration(now()-start);reports.push(JSON.parse(JSON.stringify(report)));if(reports.length>30)reports.shift();};
 return {traceId,mark,timing,measure,request,finish};
}
