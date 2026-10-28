import {sha256} from 'hash.js';
import {createValueAssembler} from '../code-architecture-transfer/archiveValueStream';
export const PAGED_HAZARD = '__xhandlePagedHazard';
const containers=new Set(['object','array','string','map','set','binary']);
const fields=new Set(['id','projectId','repoId','repoName','hazardMethod','runState','totalAssessments','validatedAssessments','failureMessage','pipelineVersion','architectureSnapshotHash','functionalModelSnapshotHash','analysisAbstraction','createdAt','updatedAt','reviewStatus','finalSavePending','finalSaveStatus','organizationProfileProvenance','operationalContexts','selectedOperationalContextId']);
const detailFields=new Set(['csvImportPreviousSummary','narrativeReview']);
const digest=value=>sha256().update(JSON.stringify(value)).digest('hex');
// Retain coordinates, never result cells. Only the header and small scalar
// metadata fields are assembled while traversing the authoritative stream.
export function createHazardRowIndex(){
 const stack=[],spans=[],metadata={};let capture=null,headers=[],pending=false;const partial={headers:null,spans:[],metadata:{}};let narrative=false;const details={},omittedMetadata=[];
 const done=()=>{const p=stack.at(-1);if(p){if(p.type==='object'){p.key=null;p.expectKey=true;}else p.count++;}};
 return {
  add(token,sequence,offset){
   const type=token[0],parent=stack.at(-1),container=containers.has(type);
   const key=parent?.type==='object' && parent.expectKey;
   const path=parent?[...parent.path,parent.type==='object'?parent.key:parent.count]:[];
   const partialPath=path[0]==='pendingAttempt'?path.slice(1):null;
   const selectedPath=partialPath||path;
   if(!capture && !key && ((selectedPath.length===1 && fields.has(selectedPath[0])) || (selectedPath.length===3 && selectedPath[0]==='generatedSheets' && selectedPath[1]==='Summary' && selectedPath[2]===0))){capture={assembler:createValueAssembler(),depth:0,field:selectedPath.length===1?selectedPath[0]:null,partial:Boolean(partialPath),bytes:0};}
   if(!key && path.length===1 && path[0]==='narrativeReviewInput' && container)narrative=true;
   if(!key && path.length===1 && path[0]==='pendingAttempt' && type==='object')pending=true;
   if(capture){
    capture.bytes+=JSON.stringify(token).length;
    if(capture.bytes>65536)capture.oversized=true;
    if(!capture.oversized)capture.assembler.add(token);
    if(container)capture.depth++;else if(type==='end')capture.depth--;
    if(!capture.depth){if(!capture.oversized){const value=capture.assembler.finish();if(capture.field)(capture.partial?partial.metadata:metadata)[capture.field]=value;else if(capture.partial)partial.headers=value;else headers=value;}if(capture.oversized && capture.field && !capture.partial)omittedMetadata.push(capture.field);capture=null;}
   }
   if(container){stack.push({type,path:key?parent.path:path,isKey:key,text:'',expectKey:true,count:0,start:[sequence,offset]});}
   else if(type==='text' && parent?.isKey)parent.text+=token[1];
   else if(type==='end'){
    const frame=stack.pop();if(!frame)throw Error('Invalid hazard row index structure.');
    if(frame.isKey){const object=stack.at(-1);object.key=frame.text;object.expectKey=false;}
    else{
     if(frame.path.length===1 && detailFields.has(frame.path[0]))details[frame.path[0]]=[...frame.start,sequence,offset+1];
     if(frame.path.length===4 && frame.path[0]==='pendingAttempt' && frame.path[1]==='generatedSheets' && frame.path[2]==='Summary' && typeof frame.path[3]==='number' && frame.path[3]>0 && frame.type==='array')partial.spans.push([...frame.start,sequence,offset+1]);
     if(frame.path.length===3 && frame.path[0]==='generatedSheets' && frame.path[1]==='Summary' && typeof frame.path[2]==='number' && frame.path[2]>0 && frame.type==='array')spans.push([...frame.start,sequence,offset+1]);
     done();
    }
   }else if(!['text','bytes'].includes(type))done();
  },
  finish(sourceDigest){const data={version:2,sourceDigest,metadata,headers,spans,pending,partial,narrative,details,omittedMetadata};return {...data,digest:digest(data)};},
 };
}
export function validateHazardRowIndex(payload){
 const index=payload?.rowIndex;
 if(!index || index.version!==2 || index.sourceDigest!==payload.digest)throw Error('Saved table needs a row storage upgrade.');
 const {digest:checksum,...data}=index;
 if(checksum!==digest(data) || !Array.isArray(index.spans) || !Array.isArray(index.headers))throw Error('Saved table row index is damaged or unavailable.');
 const validateSpans=spans=>{
  if(!Array.isArray(spans))throw Error('Invalid saved row coordinates.');
  let previous=[-1,-1];
  for(const span of spans){
   if(!Array.isArray(span)||span.length!==4||span.some(n=>!Number.isSafeInteger(n)||n<0)||span[0]<previous[0]||(span[0]===previous[0]&&span[1]<previous[1])||span[2]>=payload.count||span[2]<span[0]||(span[2]===span[0]&&span[3]<=span[1]))throw Error('Invalid saved row coordinates.');
   previous=[span[2],span[3]];
  }
 };
 validateSpans(index.spans);
 validateSpans(index.partial?.spans);
 for(const span of Object.values(index.details || {}))validateSpans([span]);
 if(index.partial?.spans?.length && !Array.isArray(index.partial.headers))throw Error('Invalid partial table header.');
 return index;
}
