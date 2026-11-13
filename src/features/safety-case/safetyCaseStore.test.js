import 'fake-indexeddb/auto';
import {openDB} from 'idb';
import {IDBFactory} from 'fake-indexeddb';
import {serialize,deserialize} from 'v8';
import {openTraceabilityDB,createTraceabilityTransaction} from '../../components/utils/traceabilityDb';
import {saveSafetyCase,loadSafetyCase,loadSafetyCases,duplicateSafetyCase,deleteSafetyCase,updateSafetyCaseAutomation} from './safetyCaseStore';
import {collectSafetyCaseEvidence} from './safetyCaseEvidenceSources';
import {reconcileSafetyCaseEvidence} from './safetyCaseEvidenceAutomation';
import {startSafetyCaseEvidenceRuntime} from './safetyCaseEvidenceRuntime';
import {normalizeSafetyCase} from './safetyCaseTypes';
jest.mock('../../components/utils/traceabilityDb',()=>{
 const {openDB}=require('idb');
 return {TRACEABILITY_STORES:{safetyCases:'SafetyCases',requirements:'Requirements'},openTraceabilityDB:jest.fn(()=>openDB('CaseTest',1,{upgrade(db){const store=db.createObjectStore('SafetyCases',{keyPath:'id'});store.createIndex('by_project','projectId');const req=db.createObjectStore('Requirements',{keyPath:'id'});req.createIndex('by_project','projectId');}})),createTraceabilityTransaction:jest.fn((db,store,mode)=>db.transaction(store,mode))};
});
beforeEach(()=>{
 global.structuredClone=value=>deserialize(serialize(value));
 Object.defineProperty(window,'indexedDB',{configurable:true,value:new IDBFactory()});
 openTraceabilityDB.mockImplementation(()=>openDB('CaseTest',1,{upgrade(db){const store=db.createObjectStore('SafetyCases',{keyPath:'id'});store.createIndex('by_project','projectId');const req=db.createObjectStore('Requirements',{keyPath:'id'});req.createIndex('by_project','projectId');}}));
 createTraceabilityTransaction.mockImplementation((db,store,mode)=>db.transaction(store,mode));
 localStorage.clear();jest.spyOn(console,'warn').mockImplementation(()=>{});
});
afterEach(()=>jest.restoreAllMocks());
const auto={projectId:'p',complete:true,artifacts:[{id:'e',projectId:'p',revision:'one'}],allocations:[{nodeId:'n',artifactId:'e',state:'current'}],lastSyncedAt:'2026-11-06'};
const base=()=>normalizeSafetyCase({id:'c',projectId:'p',nodes:[{id:'n',type:'claim',title:'Manual argument'}]});

test('a stale editor save preserves newly committed automation; the background updater preserves manual edits',async()=>{
 const original=await saveSafetyCase(base());
 await updateSafetyCaseAutomation('c',()=>auto);
 await saveSafetyCase({...original,name:'User name',nodes:[{...original.nodes[0],title:'Unsaved wording now saved',linkedArtifactIds:['manual']}]});
 await updateSafetyCaseAutomation('c',latest=>({...latest.evidenceAutomation,complete:false}));
 const saved=await loadSafetyCase('c');
 expect(saved.name).toBe('User name');expect(saved.nodes[0]).toMatchObject({title:'Unsaved wording now saved',linkedArtifactIds:['manual']});
 expect(saved.evidenceAutomation).toMatchObject({...auto,complete:false});
});
test('normalization, JSON roundtrip and duplicate preserve automation and remap allocation node IDs',async()=>{
 await saveSafetyCase({...base(),evidenceAutomation:auto});
 const copy=await duplicateSafetyCase('c');
 expect(copy.evidenceAutomation.allocations[0].nodeId).toBe(copy.nodes[0].id);
 expect(copy.nodes[0].id).not.toBe('n');
 expect(normalizeSafetyCase(JSON.parse(JSON.stringify(copy))).evidenceAutomation).toEqual(copy.evidenceAutomation);
});
test('project filtering works without an index and deleted cases cannot be recreated by a pending sync',async()=>{
 await saveSafetyCase(base());await saveSafetyCase({...base(),id:'q',projectId:'q',sourceProjectId:'q'});
 expect((await loadSafetyCases('p')).map(c=>c.id)).toEqual(['c']);
 await deleteSafetyCase('c');
 expect(await updateSafetyCaseAutomation('c',()=>auto)).toBeNull();
 expect(await loadSafetyCase('c')).toBeNull();
});
test('double storage failure rejects and does not announce a saved case',async()=>{
 openTraceabilityDB.mockRejectedValueOnce(Error('database unavailable'));
 jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});
 const listener=jest.fn();window.addEventListener('xhandle:safety-case-updated',listener);
 try {await expect(saveSafetyCase(base())).rejects.toThrow('could not be saved');expect(listener).not.toHaveBeenCalled();}
 finally{window.removeEventListener('xhandle:safety-case-updated',listener);}
});
test('a durable local fallback remains loadable when IndexedDB recovers',async()=>{
 openTraceabilityDB.mockRejectedValueOnce(Error('offline'));
 const saved=await saveSafetyCase(base());
 expect(await loadSafetyCase(saved.id)).toMatchObject({id:'c'});
 expect((await loadSafetyCases('p')).map(c=>c.id)).toEqual(['c']);
});
test('automation waits for commit and never announces a failed transaction',async()=>{
 await saveSafetyCase(base());
 const listener=jest.fn();window.addEventListener('xhandle:safety-case-updated',listener);
 createTraceabilityTransaction.mockImplementationOnce(()=>({store:{get:async()=>base(),put:async()=>{}},done:Promise.reject(Error('commit failed'))}));
 try {await expect(updateSafetyCaseAutomation('c',()=>auto)).rejects.toThrow('commit failed');expect(listener).not.toHaveBeenCalled();}
 finally{window.removeEventListener('xhandle:safety-case-updated',listener);}
});


test('real source adapters and committed stores maintain evidence while the case view is closed',async()=>{
 const db=await openTraceabilityDB();
 await db.put('Requirements',{id:'r',projectId:'p',title:'Stop safely',version:1});
 const document={id:'d',projectId:'p',testCases:[{id:'t',requirementId:'r',status:'Pass',evidence:'Execution log'}]};
 localStorage.setItem('xhandle:vnv-test-case-documents',JSON.stringify([document]));
 const original=base();original.nodes[0].metadata.evidenceRole='verification';
 await saveSafetyCase(original);
 let stop;
 const waitForState=(state)=>new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{window.removeEventListener('xhandle:safety-case-updated',changed);reject(Error('No automatic evidence update'));},1500);
  function changed(event){if(event.detail.evidenceAutomation?.allocations?.some(item=>item.state===state)){clearTimeout(timeout);window.removeEventListener('xhandle:safety-case-updated',changed);resolve();}}
  window.addEventListener('xhandle:safety-case-updated',changed);
 });
 try{
  const first=waitForState('current');
  stop=startSafetyCaseEvidenceRuntime({debounceMs:1,intervalMs:60000});
  await first;
  let saved=await loadSafetyCase('c');expect(saved.evidenceAutomation.allocations).toHaveLength(1);
  expect(saved.nodes[0].title).toBe('Manual argument');
  document.testCases[0].status='Fail';
  const failed=waitForState('failed');
  localStorage.setItem('xhandle:vnv-test-case-documents',JSON.stringify([document]));
  window.dispatchEvent(new CustomEvent('xhandle:vnv-documents-updated'));
  await failed;
  saved=await loadSafetyCase('c');expect(saved.evidenceAutomation.allocations[0].state).toBe('failed');
  localStorage.setItem('xhandle:vnv-test-case-documents','[]');
  const snapshot=await collectSafetyCaseEvidence('p');
  await updateSafetyCaseAutomation('c',value=>reconcileSafetyCaseEvidence(value,snapshot));
  expect((await loadSafetyCase('c')).evidenceAutomation.allocations[0].state).toBe('missing');
 }finally{stop?.();}
});

test('malformed imported automatic state cannot crash the evidence UI',()=>{
 const value=normalizeSafetyCase({...base(),evidenceAutomation:{artifacts:{},allocations:'bad',errors:[{message:'bad'}]}});
 expect(value.evidenceAutomation).toMatchObject({artifacts:[],allocations:[],errors:['[object Object]'],complete:false});
});
