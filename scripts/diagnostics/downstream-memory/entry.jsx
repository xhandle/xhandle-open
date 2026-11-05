import React from 'react';
import {createRoot} from 'react-dom/client';
import Panel from '../../../src/features/code-architecture-assurance/EngineeringArtifactPanel';
import {ARTIFACT_DEFINITIONS} from '../../../src/features/code-architecture-assurance/artifactDefinitions';
import {DERIVE_BY_KIND} from '../../../src/features/code-architecture-assurance/artifactAI';
import {saveArtifactRowsAsync,loadArtifactRowsAsync,splitIds} from '../../../src/features/code-architecture-assurance/artifactUtils';
import {createRequirementCheckpoint} from '../../../src/features/code-architecture-transfer/requirementCheckpoint';
import {ActivityProvider} from '../../../src/components/activity/ActivityCenter';
import {ResultsReviewProvider} from '../../../src/features/results-review/ResultsReviewProvider';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async fn=>{const start=performance.now();while(!fn()){if(performance.now()-start>180000)throw Error('Timed out: '+document.body.innerText.slice(-800));await sleep(25);}};
let requests=0, nextId=0, root;
window.failures=[];
window.addEventListener('error',e=>window.failures.push(e.message));
window.addEventListener('unhandledrejection',e=>window.failures.push(String(e.reason?.stack||e.reason)));
window.fetch=async(url,opts={})=>{
 if(!String(url).endsWith('/api/chat'))throw Error('Unexpected external request '+url);
 const payload=JSON.parse(JSON.parse(opts.body).messages[1].content);requests++;
 const key=['sourceRequirements','draftCategories','softwareRequirementCategories','systemRequirementCategories','subsystemRequirementCategories','candidateSystemRequirements','candidateSubsystemRequirements','candidateDesignElements'].find(k=>Array.isArray(payload[k]));
 if(!key)throw Error('Unhandled synthetic AI task '+payload.task);
 const responseKey=Object.keys(payload.schema)[0],template=payload.schema[responseKey][0];
 const parent=Object.keys(template).find(k=>/^parent/.test(k));
 const rows=payload[key].map(row=>{
  const n=++nextId,parents=row[parent]||row.id;
  if(responseKey==='categories')return {id:'CAT-'+n,categoryName:'Observation '+n,categoryDescription:'Observe independent channel '+n,requirementIntent:'observe independent channel '+n,[parent]:parents};
  if(responseKey==='designElements')return {id:'DES-'+n,designElementName:'Observer'+n,description:'The observer coordinates independently timed channel '+n,[parent]:parents};
  return {id:'REQ-'+n,requirementText:'The system shall reject stale measurements for independent channel '+n,[parent]:parents};
 });
 await sleep(1);
 return {ok:true,json:async()=>({answer:JSON.stringify({[responseKey]:rows})})};
};
const kinds=['software-requirements','system-requirements','subsystem-requirements','design-elements'];
const parentFields={'system-requirements':'parentSwRequirement','subsystem-requirements':'parentSystemRequirement','design-elements':'parentRequirement'};
const sourceFields={'system-requirements':'softwareRequirements','subsystem-requirements':'systemRequirements','design-elements':'subsystemRequirements'};
async function runCase(kind,count){
 const project={id:kind+'-'+count,name:'Synthetic memory workspace'},repo={id:'repo',repoId:'repo',repoName:'synthetic'};
 let source=Array.from({length:count},(_,i)=>({id:'SRC-'+i,requirementText:'The software shall validate observation channel '+i,source:'functional-derived',
 rationale:'Evidence for source '+i+': '+('Synthetic retained engineering evidence. '.repeat(90)),
 sourceArchitectureRefs:[{traceId:'FD-'+i,fromFunction:'Sensor '+i,controlAction:'Observation '+i,toFunction:'Monitor '+i,mode:'edge'}],
 ...(i%13===0?{linkedHazards:'H-'+i,safetyContext:'Maintain validated observation confidence '+i}:{}),
 }));
 const sourceKind=ARTIFACT_DEFINITIONS[kind].sourceKind;
 for(const storedKind of kinds)if(storedKind!==kind)await saveArtifactRowsAsync(storedKind,project.id,repo.id,source);
 let peakHeap=0,maxDelay=0,last=performance.now();const started=last,initialRequests=requests;
 const timer=setInterval(()=>{const now=performance.now();maxDelay=Math.max(maxDelay,now-last-50);last=now;peakHeap=Math.max(peakHeap,performance.memory.usedJSHeapSize);},50);
 const render=()=>root.render(<ActivityProvider><ResultsReviewProvider mode="collaborator"><Panel kind={kind} project={project} repo={repo} cbaRows={[]}/></ResultsReviewProvider></ActivityProvider>);
 try{
 root=createRoot(document.getElementById('app'));render();
 const label=ARTIFACT_DEFINITIONS[kind].deriveButton;
 await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent===label&&!b.disabled));
 [...document.querySelectorAll('button')].find(b=>b.textContent===label).click();
 await wait(()=>document.body.innerText.includes('derived for review'));
 let rows=await loadArtifactRowsAsync(kind,project.id,repo.id);
 if(!rows.length)throw Error('No derived rows');
 const covered=new Set(rows.flatMap(r=>splitIds(r[parentFields[kind]])));
 if(source.some(r=>!covered.has(r.id)))throw Error('Missing parent trace coverage '+kind);
 if(rows.some(r=>/fallback/.test(r.source)))throw Error('Unexpected fallback drafts '+kind);
 const output=rows.map(r=>[r.requirementText||r.description,r[parentFields[kind]]]);
 const firstRequests=requests-initialRequests;
 root.unmount();root=createRoot(document.getElementById('app'));render();
 await wait(()=>document.querySelectorAll('tbody td').length>0);
 if(requests-initialRequests!==firstRequests)throw Error('Opening saved results unexpectedly called AI');
 const progress=()=>{};progress.requestCheckpoint=createRequirementCheckpoint(project.id,repo.id,kind);
 const checkpointStart=requests;
 let resumed=await DERIVE_BY_KIND[kind]({[sourceFields[kind]]:source,projectName:project.name,repoName:repo.repoName,onProgress:progress});
 if(requests!==checkpointStart)throw Error('Checkpoint reuse made new provider calls '+(requests-checkpointStart));
 if(JSON.stringify(resumed.map(r=>[r.requirementText||r.description,r[parentFields[kind]]]))!==JSON.stringify(output))throw Error('Checkpoint reuse changed engineering results');
 peakHeap=Math.max(peakHeap,performance.memory.usedJSHeapSize);
 const result={kind,count,sourceKind,resultRows:rows.length,parentsCovered:covered.size,requests:firstRequests,resumeRequests:requests-checkpointStart,elapsedMs:performance.now()-started,peakHeapMiB:peakHeap/1048576,maxEventLoopDelayMs:maxDelay};
 root.unmount();root=null;source=null;rows=null;resumed=null;
 return result;
 }finally{clearInterval(timer);root?.unmount();root=null;}
}
window.runCase=runCase;
window.retainedHeap=async()=>{for(let i=0;i<3;i++){window.gc?.();await sleep(100);}return performance.memory.usedJSHeapSize/1048576;};
