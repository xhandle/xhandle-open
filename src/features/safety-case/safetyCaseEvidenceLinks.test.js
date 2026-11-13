import 'fake-indexeddb/auto';
import {loadLinkableSafetyCaseEvidence as load,getLastEvidenceScanDiagnostics} from './safetyCaseEvidenceLinks';
import {buildSafetyCaseProjectContext} from './safetyCaseProjectContext';
let oldIndexedDB;
beforeEach(()=>{localStorage.clear();oldIndexedDB=Object.getOwnPropertyDescriptor(window,'indexedDB');Object.defineProperty(window,'indexedDB',{configurable:true,value:undefined});});
afterEach(()=>{if(oldIndexedDB)Object.defineProperty(window,'indexedDB',oldIndexedDB);else delete window.indexedDB;});
const set=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
const flat=groups=>groups.flatMap(g=>g.artifacts);

test('empty project does not fall back to unrelated workspace evidence',async()=>{
 set('xhandle:requirements',[{id:'foreign',projectId:'q',title:'Foreign'}]);
 set('xhandle:risk-register',[{id:'risk',projectId:'q',title:'Wrong risk'}]);
 expect(flat(await load({projectId:'p'}))).toEqual([]);
 expect(getLastEvidenceScanDiagnostics().fallbackToWorkspace).toBe(false);
 expect(buildSafetyCaseProjectContext('p').hazards).toEqual([]);
});
test('nested projectData children cannot override explicit foreign ownership with inherited context',async()=>{
 set('xhandle.projectData',{p:{responseRows:[{id:'good',fromFunction:'Allowed'},{id:'bad',projectId:'q',fromFunction:'Foreign'}]}});
 const artifacts=flat(await load({projectId:'p'}));
 expect(artifacts.some(a=>a.rawId==='good')).toBe(true);
 expect(artifacts.some(a=>a.rawId==='bad')).toBe(false);
});
test('unowned evidence is withheld for selected projects; manual workspace browsing remains available',async()=>{
 set('xhandle:requirements',[{id:'unknown',title:'Unowned'}]);
 expect(flat(await load({projectId:'p'}))).toHaveLength(0);
 expect(flat(await load())).toEqual(expect.arrayContaining([expect.objectContaining({rawId:'unknown'})]));
});
test('architecture context is filtered and not silently repopulated from a foreign project',()=>{
 set('cba:example',[{id:'a',projectId:'q'},{id:'b',projectId:'p'}]);
 expect(buildSafetyCaseProjectContext('p').codeArchitecture.map(a=>a.id)).toEqual(['b']);
});

test('IndexedDB wrappers cannot supply foreign or conflicting nested evidence',async()=>{
 const {IDBFactory}=require('fake-indexeddb');
 const {openDB}=require('idb');
 const {serialize,deserialize}=require('v8');
 const previousClone=global.structuredClone;
 global.structuredClone=value=>deserialize(serialize(value));
 Object.defineProperty(window,'indexedDB',{configurable:true,value:new IDBFactory()});
 try {
  const db=await openDB('scoped-evidence',1,{upgrade(db){db.createObjectStore('requirements',{keyPath:'id'});}});
  await db.put('requirements',{id:'wrapper',projectId:'p',value:[{id:'good',title:'Allowed'},{id:'bad',projectId:'q',title:'Foreign'}]});
  await db.put('requirements',{id:'conflict',projectId:'q',value:[{id:'conflicting',projectId:'p',title:'Conflicting parent'}]});
  const artifacts=flat(await load({projectId:'p'}));
  expect(artifacts.some(a=>a.rawId==='good')).toBe(true);
  expect(artifacts.some(a=>['bad','conflicting'].includes(a.rawId))).toBe(false);
  db.close();
 }finally{global.structuredClone=previousClone;}
});
