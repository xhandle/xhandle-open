// Synthetic saved fixtures only. This module is injected before measurements, never into a normal profile.
const openArtifactDatabase=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('xhandle-design-artifacts',2);r.onupgradeneeded=()=>{for(const name of ['metadata','revisions','jobs','baselines','presentations']){if(r.result.objectStoreNames.contains(name))continue;const store=r.result.createObjectStore(name,{keyPath:'id'});store.createIndex('projectId','projectId');if(name!=='metadata')store.createIndex('artifactId','artifactId');}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
import {saveSafetyCase} from '../../../src/features/safety-case/safetyCaseStore.js';
import {createBlankSafetyCase,createSafetyCaseNode} from '../../../src/features/safety-case/safetyCaseTypes.js';
import {saveGeneratedReport} from '../../../src/features/project-hazard-analysis/generatedReportStorage.js';
import {fastHazardSheets} from '../../../src/features/code-architecture-hazard-analysis/fastHazardRunner.js';
import {saveCodeArchitectureHazardRun} from '../../../src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore.js';
import {normalizeCodeArchitectureHazardRun} from '../../../src/features/code-architecture-hazard-analysis/codeArchitectureHazardUtils.js';
import {CODE_HARA_COLUMNS} from '../../../src/features/code-architecture-hazard-analysis/codeArchitectureHara.js';
import {answer as hazardAnswer} from '../../../src/features/code-architecture-hazard-analysis/fastHazardTestFixtures.js';

// Exercise the production HARA sheet builder, storage and paged table together.
window.seedCodeHaraAudit=async({legacy=false}={})=>{
 const tableRows=Array.from({length:2},(_,index)=>({fromFunction:'Vehicle controller',controlAction:'Brake command',toFunction:'Brake actuator',
  guidePhrase:index?'Provided too late':'Not provided',operationalContextId:'crossing',operationalScenario:'Occupied pedestrian crossing',
  operationalMode:'Automated urban driving',operatingConditions:'Wet pavement; no human driver.',traceability:{traceId:'brake-code'}}));
 const assessments=tableRows.map((_,index)=>({...hazardAnswer('HARA',`HA-${index+1}`,'Brake command'),
  safetyGoal:'The vehicle shall prevent loss of braking at occupied crossings.',safeState:'Controlled standstill',
  ftti:index?'':'100 ms',fttiRationale:index?'':'The supplied crossing timing analysis establishes a 100 ms response interval.',
  itemDefinition:'Automated braking controller and brake actuator; no human driver.',gaps:index?'Establish timing evidence.':''}));
 const sheets=fastHazardSheets('HARA',{sheets:{'Functional Decomposition':[['Function'],['Vehicle controller']]},tableRows},assessments);
 if(legacy){
  const fields=['Function','Operational Scenario','Operational Mode','Operating Conditions','Guide Phrase','Guide Phrase Applicable','Malfunctioning Behavior','Hazardous Event','Severity','Exposure','Controllability','ASIL','Safety Goal','Safety Classification','Function (From)','Control Action','Function (To)','Operational Context ID','Trace ID'];
  const original=sheets.Summary;
  sheets.Summary=[fields,...original.slice(1).map(row=>fields.map(header=>row[original[0].indexOf(header)]??''))];
  delete sheets.HARA;delete sheets['Safety Goals'];
 }
 const run=normalizeCodeArchitectureHazardRun({id:legacy?'hara-code-columns-legacy':'hara-code-columns',projectId:'hara-code',repoId:'brakes',repoName:'brakes',
  hazardMethod:'HARA',runState:'complete',generatedSheets:sheets,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 await saveCodeArchitectureHazardRun(run);
 return {columns:CODE_HARA_COLUMNS,summary:sheets.Summary};
};
window.seedAuditExtras=async({assessmentRows=1000,requirementRows=2000})=>{
 localStorage.setItem('xhandle:req-projects',JSON.stringify([{id:'audit-folder',name:'Performance Designs',modules:[]}]));
 const db=await openArtifactDatabase(),tx=db.transaction(['metadata','revisions'],'readwrite');
 tx.done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
 const seed=(id,title,templateId,objects)=>{const config={templateId,title,projectId:'perf',workspaceType:'functional',folderId:'audit-folder',system:'Vehicle',sources:[],architectureSources:[]};const meta={id,title,config,projectId:'perf',workspaceType:'functional',folderId:'audit-folder',templateId,templateVersion:1,revision:1,sourceHash:'fixture',freshness:'current',updatedAt:new Date().toISOString()};tx.objectStore('metadata').put(meta);tx.objectStore('revisions').put({id:id+':1',artifactId:id,projectId:'perf',workspaceType:'functional',number:1,objects,sourceHash:'fixture',sources:{hash:'fixture',entries:[]},createdAt:meta.updatedAt});};
 const reqs=[{id:'audit-req:s2',kind:'section',sectionId:'s2',title:'Safety requirements',text:'',parentId:null,order:0}];
 for(let i=0;i<requirementRows;i++){const parent='audit-req:topic-'+Math.floor(i/20);if(i%20===0)reqs.push({id:parent,kind:'section',sectionId:'s2',title:'Command safety topic '+Math.floor(i/20),text:'',parentId:'audit-req:s2',order:i});reqs.push({id:'audit-req:r-'+i,kind:'requirement',sectionId:'s2',title:'Requirement '+i,text:'The controller shall reject command '+i+' when the command validity interval has expired.',parentId:parent,order:i+1,sourceIds:[],sourceEvidence:[]})}
 seed('audit-req','Audit Safety Requirements','safety-requirements',reqs);
 const htl=[{id:'audit-htl:s2',kind:'section',sectionId:'s2',title:'Hazard tracking list',text:'',order:0}];
 for(let i=0;i<assessmentRows;i++)htl.push({id:'audit-htl:row-'+i,kind:'hazard',sectionId:'s2',hazardTrackingRow:true,title:'Assessment '+i,text:'Recorded assessment',parentId:'audit-htl:s2',order:i+1,sourceIds:[],hazardTrackingRecordNumber:i%60+1,attributes:{Hazard:'Unintended actuator motion '+i%60,Function:'Control interface '+i%150,'Operational Scenario':'Urban route '+i%20,'Operational Mode':i%2?'Automatic':'Manual','Operating Conditions':'Recorded nominal operating conditions. '.repeat(3),'Guide Phrase':'Not provided','Guide Phrase Applicable':'Yes','Unsafe Control Action':'Expired motion command is accepted. '+i%4,Loss:'Physical injury','Causal Scenario':'A command arrives after its operating context changes. '.repeat(3),'Safety Constraint':'Reject commands after their validity interval expires.',Verification:'Fault injection','Safety Classification':'Critical'}});
 seed('audit-htl','Audit Hazard Tracking List','hazard-tracking-list',htl);
 await tx.done;db.close();
 const sc=createBlankSafetyCase({projectId:'perf',name:'Audit Safety Case'});sc.nodes=Array.from({length:300},(_,i)=>createSafetyCaseNode({id:'audit-sc-'+i,title:'Safety claim '+i,description:'The controller rejects expired commands. '.repeat(3),type:i%3?'claim':'evidence',position:{x:i%15*300,y:Math.floor(i/15)*180}}));sc.edges=sc.nodes.slice(1).map((n,i)=>({id:'sc-edge-'+i,source:sc.nodes[i].id,target:n.id,relationship:'supports'}));sc.rootNodeId=sc.nodes[0].id;await saveSafetyCase(sc);
 for(let i=0;i<10;i++)await saveGeneratedReport('perf',{title:'Audit report '+i,reportType:'Safety issue report',report:'# Audit report '+i+'\n\n'+Array.from({length:150},(_,j)=>'## Recorded safety concern '+j+'\n\nThe controller shall reject expired commands. This paragraph records the source and verification status.\n\n').join('')});
 const now=new Date().toISOString();
 localStorage.setItem('xhandle:requirements',JSON.stringify(Array.from({length:2000},(_,i)=>({id:'AUDIT-REQ-'+i,title:'Controller validity '+i,description:'The controller shall reject expired command '+i+'.',projectId:'audit-folder',folderId:'audit-folder',module:'System',kind:'requirement',status:'Proposed'}))));
 localStorage.setItem('xhandle:vnv-test-case-documents',JSON.stringify([{id:'audit-tests',name:'Audit Test Cases',projectId:'perf',sourceProjectId:'perf',requirements:Array.from({length:1000},(_,i)=>({id:'AUDIT-REQ-'+i,title:'Controller validity '+i,text:'Reject expired commands.'})),testCases:Array.from({length:1000},(_,i)=>({id:'TC-'+i,title:'Reject stale command '+i,requirementId:'AUDIT-REQ-'+i,status:'Draft',method:'Test',objective:'Verify stale-command rejection.',steps:['Submit an expired command.','Observe controller output.'],expectedResults:['The command is rejected.']})),createdAt:now,updatedAt:now}]));localStorage.setItem('xhandle:vnv-active-document-id','audit-tests');
 localStorage.setItem('xhc.threads',JSON.stringify([{id:'audit-thread',title:'Audit large thread',createdAt:Date.now(),updatedAt:Date.now(),messages:Array.from({length:80},(_,i)=>({id:'audit-msg-'+i,role:i%2?'assistant':'user',content:'Recorded safety discussion '+i+'\n\n'+('The controller must reject commands after expiration. Source evidence and verification remain linked.\n\n').repeat(10)}))}]));
 const programDb=await openArtifactDatabase(), programTx=programDb.transaction(['metadata','revisions'],'readwrite');const completed=new Promise((resolve,reject)=>{programTx.oncomplete=resolve;programTx.onabort=()=>reject(programTx.error)});const members=Array.from({length:20},(_,i)=>({id:'audit-doc-'+i,config:{templateId:'system-spec',title:'Audit document '+i,system:'Vehicle',projectId:'perf',workspaceType:'functional',folderId:'audit-folder',sources:[]}}));programTx.objectStore('metadata').put({id:'audit-engineering',recordType:'systems-engineering-project',title:'Audit Engineering Project',state:'accepted',version:1,folderId:'audit-folder',config:{system:'Vehicle',name:'Audit Engineering Project'},ownerProjects:[{id:'perf',workspaceType:'functional'}],members,updatedAt:now});for(const member of members){programTx.objectStore('metadata').put({id:member.id,programId:'audit-engineering',title:member.config.title,templateId:'system-spec',revision:1,config:member.config,updatedAt:now});programTx.objectStore('revisions').put({id:member.id+':1',artifactId:member.id,number:1,objects:Array.from({length:100},(_,i)=>({id:member.id+':'+i,kind:'requirement',title:'Recorded command '+i,text:'The controller shall reject expired commands.',order:i,sectionId:'s2',sourceIds:[],sourceEvidence:[]})),sources:{evidence:'Recorded evidence. '.repeat(50000),entries:[]}});}await completed;programDb.close();
 return {requirementObjects:reqs.length,htlRows:assessmentRows,htlGroups:60,safetyCaseNodes:300,reports:10};
};
