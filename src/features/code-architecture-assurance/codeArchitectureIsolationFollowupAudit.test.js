// Regression coverage for the lifecycle gaps found in the follow-up audit.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import useScopedArchitectureRows from './useScopedArchitectureRows';
import { openCbaIndexedDB, readCbaRowsFromIndexedDB, writeCbaRowsToIndexedDB,
  prepareArchitecturePublication, recoverArchitecturePublication, flushArchitectureWrites, writeImportedArchitectureRunRecords } from './codeArchitectureStorage';
import { putRawRecord } from '../code-architecture-storage/chunkedRecord';
const fs=require('fs'), parser=require('@babel/parser'), traverse=require('@babel/traverse').default;
const source=fs.readFileSync('src/App.js','utf8');
let loadBody, baselineBody;
traverse(parser.parse(source,{sourceType:'module',plugins:['jsx']}),{
 FunctionDeclaration({node}){if(node.id?.name==='handleBaselineRepo')baselineBody=source.slice(node.start,node.end);},
 CallExpression({node}){
  if(node.callee.name!=='useEffect'||!node.arguments[0])return;
  const body=source.slice(node.arguments[0].start,node.arguments[0].end);
  if(body.includes('readCodeArchitectureRowsForRepo(')&&body.includes('setCbaLoading(true)'))loadBody=body;
 }
});
const A='cba:A:repoA',B='cba:B:repoB';
const oldRows=[{from:'Existing A results',lineage:{scope:A}}];
const original={indexedDB:global.indexedDB,clone:global.structuredClone,crypto:global.crypto,encoder:global.TextEncoder};
let root,api;
global.IS_REACT_ACT_ENVIRONMENT=true;
function Harness({scope}){api=useScopedArchitectureRows(scope);return null;}
const render=scope=>act(async()=>root.render(<Harness scope={scope}/>));
const makeFunction=(body,env)=>new Function(...Object.keys(env),`return (${body});`)(...Object.values(env));
beforeEach(()=>{
 global.indexedDB=new IDBFactory();global.structuredClone=v=>deserialize(serialize(v));global.crypto=webcrypto;global.TextEncoder=TextEncoder;
 root=createRoot(document.createElement('div'));
});
afterEach(()=>{
 act(()=>root.unmount());jest.restoreAllMocks();global.indexedDB=original.indexedDB;global.structuredClone=original.clone;
 global.crypto=original.crypto;global.TextEncoder=original.encoder;
});
async function seed(){const db=await openCbaIndexedDB();try{await putRawRecord(db,'copilot_baseline',A,oldRows);}finally{db.close();}}
test('publication waits for older saves already staging their rows',async()=>{
 await seed();
 let release,started;
 const waiting=new Promise(r=>{release=r;});const paused=new Promise(r=>{started=r;});
 const digest=webcrypto.subtle.digest.bind(webcrypto.subtle);
 jest.spyOn(webcrypto.subtle,'digest').mockImplementationOnce(async(...args)=>{started();await waiting;return digest(...args);});
 const oldEdit=[{from:'Pre-analysis edit',lineage:{scope:A}}];
 const pendingSave=writeCbaRowsToIndexedDB(A,oldEdit);await paused;
 const fresh=[{from:'New generated results',lineage:{scope:A}}];
 const checkpoint=`functional-decomposition-checkpoint:${A}:review`;
 const publishing=prepareArchitecturePublication(A,fresh,{fingerprint:'d'.repeat(64)},{selectedFiles:1},checkpoint,oldEdit)
   .then(()=>recoverArchitecturePublication(A,checkpoint));
 expect(await readCbaRowsFromIndexedDB(A)).toEqual(oldRows);
 release();expect(await pendingSave).toBe(true);
 await publishing;
 expect(await readCbaRowsFromIndexedDB(A)).toEqual(fresh);
});
test.each(['Publication failed', 'SOURCE_PUBLICATION_CONFLICT', 'AbortError'])('A/B/A after unsuccessful analysis reloads the saved results: %s',async failure=>{
 await seed();await render(A);await act(async()=>api.adoptRows(oldRows));
 const scopeRef={current:A},analysisScope={current:null},inFlight={current:false};
 let rejectRun,loading=false;
 const env={
  codeArchitectureAnalysisInFlightRef:inFlight,codeArchitectureAnalysisScopeRef:analysisScope,codeArchitectureScopeRef:scopeRef,
  activeCodeArchitectureProjectId:'A',codeArchitectureProjects:[{id:'A'}],activeCodeArchitectureProject:{id:'A'},
  activeCodeArchitectureRepo:{id:'repoA',owner:'owner',repo:'repo',selectedExtensions:['.py']},
  isLocalCodeSource:()=>false,codeArchitectureRowsKey:(p,r)=>`cba:${p}:${r}`,
  setSection(){},setCodeArchitectureWorkspaceTab(){},setCodeArchitectureFunctionalTableOpenKey(){},
  setHighlightedCodeArchitectureFunctionalRowIndex(){},setPendingCodeArchitectureDiagramTarget(){},setCodeArchitectureFunctionalReviewRunId(){},
  setCbaLoadingLabel(){},setCbaLoadingProgress(){},setCbaLoadError(){},setCbaLoading:value=>{loading=value;},
  flushArchitectureWrites,requestCbaReload:jest.fn(),
  beginCbaLoad:api.beginLoad,publishCbaTableData:api.publishRows,startActivity(){},finishActivity(){},
  generateFunctionalDecompositionFromGitHub:()=>new Promise((resolve,reject)=>{rejectRun=reject;}),
 };
 const run=makeFunction(baselineBody,env)().catch(error=>error);
 await act(async()=>{});
 expect(loading).toBe(true);
 await render(B);scopeRef.current=B;await render(A);scopeRef.current=A;
 const read=jest.fn();
 // Execute the actual loader: its analysis-in-flight branch returns before reading.
 makeFunction(loadBody,{...env,activeCodeArchitectureRowsKey:A,readCodeArchitectureRowsForRepo:read})();
 expect(read).not.toHaveBeenCalled();expect(api.rows).toEqual([]);
 await act(async()=>{rejectRun(Object.assign(new Error(failure),{code:failure,name:failure}));await run;});
 expect(loading).toBe(false);expect(inFlight.current).toBe(false);expect(analysisScope.current).toBe(null);
 expect(env.requestCbaReload).toHaveBeenCalledWith(A);
 // Execute the requested reload with the current visit's callbacks.
 let finishHydration;
 const hydrated=new Promise(resolve=>{finishHydration=resolve;});
 await act(async()=>{makeFunction(loadBody,{
  ...env,activeCodeArchitectureRowsKey:A,beginCbaLoad:api.beginLoad,adoptCbaTableData:rows=>{api.adoptRows(rows);finishHydration();},
  readCodeArchitectureRowsForRepo:async()=>({rows:await readCbaRowsFromIndexedDB(A),found:true}),
  requestAnimationFrame:callback=>callback(),ensureCodeArchitectureTraceIdsAsync:async rows=>rows,
  immutableFunctionalRowsAsync:async rows=>rows,setSelectedCbaElement(){},setActiveCodeArchitectureSelection(){},
 })();await hydrated;});
 expect(api.rows).toEqual(oldRows);expect(await readCbaRowsFromIndexedDB(A)).toEqual(oldRows);
});

test('a save delayed before its baseline read cannot overtake newer publication',async()=>{
 await seed();
 let release,started;
 const waiting=new Promise(r=>{release=r;});const paused=new Promise(r=>{started=r;});
 const open=indexedDB.open.bind(indexedDB);
 jest.spyOn(indexedDB,'open').mockImplementationOnce((...args)=>{
  const request=open(...args);
  Object.defineProperty(request,'onsuccess',{configurable:true,set(callback){
   request.addEventListener('success',event=>{started();waiting.then(()=>callback(event));});
  }});
  return request;
 });
 const oldEdit=[{from:'Older pending edit',lineage:{scope:A}}];
 const pendingSave=writeCbaRowsToIndexedDB(A,oldEdit);await paused;
 const fresh=[{from:'New generated results',lineage:{scope:A}}];
 const checkpoint=`functional-decomposition-checkpoint:${A}:delayed-open`;
 const publishing=prepareArchitecturePublication(A,fresh,{fingerprint:'e'.repeat(64)},{selectedFiles:1},checkpoint,oldEdit)
  .then(()=>recoverArchitecturePublication(A,checkpoint));
 expect(await readCbaRowsFromIndexedDB(A)).toEqual(oldRows);
 release();expect(await pendingSave).toBe(true);
 await publishing;
 expect(await readCbaRowsFromIndexedDB(A)).toEqual(fresh);
});

test('a blocked project save does not block another project and imports follow older saves',async()=>{
 await seed();let release,started;
 const waiting=new Promise(resolve=>{release=resolve;});const paused=new Promise(resolve=>{started=resolve;});
 const open=indexedDB.open.bind(indexedDB);
 jest.spyOn(indexedDB,'open').mockImplementationOnce((...args)=>{
  const request=open(...args);
  Object.defineProperty(request,'onsuccess',{configurable:true,set(callback){
   request.addEventListener('success',event=>{started();waiting.then(()=>callback(event));});
  }});return request;
 });
 const pending=writeCbaRowsToIndexedDB(A,[{from:'Old edit'}]);await paused;
 const imported=[{from:'Imported final rows'}];
 const importing=writeImportedArchitectureRunRecords(A,[],imported);
 expect(await writeCbaRowsToIndexedDB(B,[{from:'Independent project'}])).toBe(true);
 expect(await readCbaRowsFromIndexedDB(A)).toEqual(oldRows);
 release();await pending;await importing;await flushArchitectureWrites(A);
 expect(await readCbaRowsFromIndexedDB(A)).toEqual(imported);
});
test('a rejected database open does not poison the scope write queue',async()=>{
 jest.spyOn(indexedDB,'open').mockImplementationOnce(()=>{throw new Error('Injected storage failure');});
 await expect(writeCbaRowsToIndexedDB(A,oldRows)).rejects.toThrow('Injected storage failure');
 expect(await writeCbaRowsToIndexedDB(A,oldRows)).toBe(true);
 await flushArchitectureWrites(A);
 expect(await readCbaRowsFromIndexedDB(A)).toEqual(oldRows);
});
