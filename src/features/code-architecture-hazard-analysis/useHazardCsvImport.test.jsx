import 'fake-indexeddb/auto';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'crypto';
import {serialize,deserialize} from 'v8';
import {TextDecoder} from 'util';
import {Blob} from 'buffer';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import useHazardCsvImport,{useHazardCsvImportOwner} from './useHazardCsvImport';
import {getCodeArchitectureHazardRunById} from './codeArchitectureHazardStore';
import {isHazardCsvImportBusy} from './hazardCsvActivity';
jest.mock('./createHazardCsvImportWorker',()=>({__esModule:true,default:jest.fn()}));
function inlineWorker(){
 const {createHazardCsvWorkerEndpoint}=jest.requireActual('./hazardCsvWorkerProtocol');
 const worker={onmessage:null,onerror:null,terminated:false};
 const receive=createHazardCsvWorkerEndpoint(data=>{if(!worker.terminated)queueMicrotask(()=>worker.onmessage?.({data}));});
 worker.postMessage=data=>receive({data});worker.terminate=()=>{worker.terminated=true;};return worker;
}
global.IS_REACT_ACT_ENVIRONMENT=true;
let root,host,api;
const run={id:'ui-csv',projectId:'ui-project',repoId:'repo',generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard'],['one','']]}};
function Harness({contexts}){api=useHazardCsvImport(run.projectId,run.repoId,contexts);return <span>{api.message}</span>;}
beforeEach(()=>{require('./createHazardCsvImportWorker').default.mockImplementation(inlineWorker);global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;global.TextDecoder=TextDecoder;global.structuredClone=value=>deserialize(serialize(value));Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>{await api?.cancel();root.unmount();});host.remove();});
test('validation requires Apply, survives same-scope remount, and reports durable completion',async()=>{
 await act(async()=>root.render(<Harness/>));
 await act(async()=>api.prepare(new Blob(['Raw Analysis Row ID,Hazard\r\none,Externally completed']),run));
 expect(api.status).toBe('ready');expect(isHazardCsvImportBusy(run.projectId,run.repoId)).toBe(true);
 expect(await getCodeArchitectureHazardRunById(run.id)).toBeNull();
 await act(async()=>{root.render(<Harness key="remount"/>);});
 expect(api.status).toBe('ready');
 await act(async()=>api.apply({...run,generatedSheets:{Summary:run.generatedSheets.Summary.map(row=>[...row])}},async operation=>operation.apply(),null));
 expect(api.status).toBe('complete');expect(api.message).toContain('Saved CSV updates');expect(isHazardCsvImportBusy(run.projectId,run.repoId)).toBe(false);
 expect((await getCodeArchitectureHazardRunById(run.id)).generatedSheets.Summary[1][1]).toBe('Externally completed');
});
test('canceling a validated import releases ownership and keeps drafts unpublished',async()=>{
 await act(async()=>root.render(<Harness/>));await act(async()=>api.prepare(new Blob(['Raw Analysis Row ID,Hazard\none,Completed']),run));
 await act(async()=>api.cancel());expect(api.status).toBe('canceled');expect(isHazardCsvImportBusy(run.projectId,run.repoId)).toBe(false);
 expect(await getCodeArchitectureHazardRunById(run.id)).toBeNull();
});

test('a worker failure while awaiting Apply becomes a visible, retryable error',async()=>{
 await act(async()=>root.render(<Harness/>));await act(async()=>api.prepare(new Blob(['Raw Analysis Row ID,Hazard\none,Completed']),run));
 const worker=require('./createHazardCsvImportWorker').default.mock.results.at(-1).value;
 await act(async()=>worker.onerror({message:'Synthetic CSV worker stopped'}));
 expect(api.status).toBe('error');expect(api.message).toContain('worker stopped');expect(isHazardCsvImportBusy(run.projectId,run.repoId)).toBe(false);
});


test('workspace contexts reach the worker and a changed configuration blocks Apply',async()=>{
 const contexts=[{id:'urban',scenario:'Urban operation',mode:'Autonomous'}];
 await act(async()=>root.render(<Harness contexts={contexts}/>));
 await act(async()=>api.prepare(new Blob(['Raw Analysis Row ID,Hazard\none,Completed']),run));
 await act(async()=>root.render(<Harness contexts={[{...contexts[0],scenario:'Highway'}]}/>));
 await act(async()=>api.apply(run,async operation=>operation.apply(),null));
 expect(api.status).toBe('error');expect(api.message).toContain('contexts changed');
 expect(await getCodeArchitectureHazardRunById(run.id)).toBeNull();
 await act(async()=>root.render(<Harness contexts={contexts}/>));
 await act(async()=>api.prepare(new Blob(['Raw Analysis Row ID,Hazard\none,Completed']),run));
 await act(async()=>api.apply(run,async operation=>operation.apply(),null));
 expect(api.status).toBe('complete');
 const saved=await getCodeArchitectureHazardRunById(run.id);
 expect(saved.generatedSheets.Summary[1][saved.generatedSheets.Summary[0].indexOf('Operational Context ID')]).toBe('urban');
 expect(saved.userPreprocessingConflicts).toHaveLength(1);
});

test.each([false,true])('durable notification waits for cleanup and survives worker failure=%s',async failure=>{
 const result={run:{...run,__xhandlePagedHazard:{revision:'saved'}},changedRowCount:1};let request;
 const worker={terminate:jest.fn(),postMessage:message=>{
  if(message.operation==='prepare'||message.operation==='discard')queueMicrotask(()=>worker.onmessage({data:{id:message.id,type:'result',result:message.operation==='prepare'?{changedRowCount:1,conflictCount:0}: {}}}));
  if(message.operation==='apply'){request=message;queueMicrotask(()=>worker.onmessage({data:{id:message.id,type:'committed',result}}));}
 }};
 require('./createHazardCsvImportWorker').default.mockReturnValueOnce(worker);
 await act(async()=>root.render(<Harness/>));
 await act(async()=>api.prepare(new Blob(['Raw Analysis Row ID,Hazard\none,Completed']),run));
 let applying,completed=false;
 await act(async()=>{applying=api.apply(run,async operation=>{const saved=await operation.apply();completed=true;return saved;},null);await new Promise(resolve=>setTimeout(resolve,0));});
 expect(api.status).toBe('saving');expect(completed).toBe(false);
 await act(async()=>{
  if(failure)worker.onerror({message:'Worker stopped after publication'});
  else worker.onmessage({data:{id:request.id,type:'result',result}});
  await applying;
 });
 expect(completed).toBe(true);expect(api.status).toBe('complete');
});

test('selected filename and size remain available through validation and completion',async()=>{
 await act(async()=>root.render(<Harness/>));
 const file=new Blob(['Raw Analysis Row ID,Hazard\none,Completed']);Object.defineProperty(file,'name',{value:'completed-results(1).csv'});
 await act(async()=>api.prepare(file,run));
 expect(api.sourceFile).toEqual({name:'completed-results(1).csv',bytes:file.size});
 await act(async()=>api.apply(run,async operation=>operation.apply(),null));
 expect(api.sourceFile.name).toBe('completed-results(1).csv');
 const saved=await getCodeArchitectureHazardRunById(run.id);
 await act(async()=>api.prepare(null,saved,true));
 expect(api.sourceFile).toBeNull();
 await act(async()=>api.apply(saved,async operation=>operation.apply(),saved));
 expect(api.message).toBe('Restored the hazard table from before the last CSV import.');
});

test('import survives a presentation gap longer than a render tick without a Cancel click',async()=>{
 function Workspace({show}){useHazardCsvImportOwner(run.projectId,run.repoId);return show?<Harness/>:<div>Refreshing table</div>;}
 await act(async()=>root.render(<Workspace show/>));
 await act(async()=>api.prepare(new Blob(['Raw Analysis Row ID,Hazard\none,Completed']),run));
 expect(api.status).toBe('ready');
 await act(async()=>root.render(<Workspace show={false}/>));
 await act(async()=>new Promise(resolve=>setTimeout(resolve,30)));
 await act(async()=>root.render(<Workspace show/>));
 expect(api.status).toBe('ready');
});

test('validation survives a hidden table while file reading is in flight',async()=>{
 function Workspace({show}){useHazardCsvImportOwner(run.projectId,run.repoId);return show?<Harness/>:null;}
 const file=new Blob(['Raw Analysis Row ID,Hazard\none,Completed']),slice=file.slice.bind(file);let release;
 file.slice=(...args)=>({arrayBuffer:()=>new Promise(resolve=>{release=()=>slice(...args).arrayBuffer().then(resolve);})});
 await act(async()=>root.render(<Workspace show/>));let preparing;
 await act(async()=>{preparing=api.prepare(file,run);for(let n=0;n<100&&!release;n++)await new Promise(resolve=>setTimeout(resolve,2));});
 expect(release).toBeDefined();
 const worker=require('./createHazardCsvImportWorker').default.mock.results.at(-1).value;
 await act(async()=>root.render(<Workspace show={false}/>));await act(async()=>new Promise(resolve=>setTimeout(resolve,30)));
 expect(worker.terminated).toBe(false);expect(isHazardCsvImportBusy(run.projectId,run.repoId)).toBe(true);
 await act(async()=>{release();await preparing;});await act(async()=>root.render(<Workspace show/>));
 expect(api.status).toBe('ready');expect(await getCodeArchitectureHazardRunById(run.id)).toBeNull();
});

test('leaving the owning workspace stops its worker and releases storage ownership',async()=>{
 function Workspace(){useHazardCsvImportOwner(run.projectId,run.repoId);return <Harness/>;}
 await act(async()=>root.render(<Workspace/>));await act(async()=>api.prepare(new Blob(['Raw Analysis Row ID,Hazard\none,Completed']),run));
 const worker=require('./createHazardCsvImportWorker').default.mock.results.at(-1).value;
 await act(async()=>root.render(null));
 for(let n=0;n<50&&!worker.terminated;n++)await act(async()=>new Promise(resolve=>setTimeout(resolve,5)));
 expect(worker.terminated).toBe(true);expect(isHazardCsvImportBusy(run.projectId,run.repoId)).toBe(false);
 expect(await getCodeArchitectureHazardRunById(run.id)).toBeNull();
 await act(async()=>root.render(<Harness/>));expect(api.message).toContain('workspace closed');
});

test('rapid replacement file selections create only the latest replacement worker',async()=>{
 await act(async()=>root.render(<Harness/>));
 await act(async()=>api.prepare(new Blob(['Raw Analysis Row ID,Hazard\none,First']),run));
 const factory=require('./createHazardCsvImportWorker').default,before=factory.mock.calls.length;
 await act(async()=>Promise.all([api.prepare(new Blob(['Raw Analysis Row ID,Hazard\none,Obsolete']),run),api.prepare(new Blob(['Raw Analysis Row ID,Hazard\none,Latest']),run)]));
 expect(factory.mock.calls.length-before).toBe(1);expect(api.status).toBe('ready');
 await act(async()=>api.apply(run,async operation=>operation.apply(),null));
 expect((await getCodeArchitectureHazardRunById(run.id)).generatedSheets.Summary[1][1]).toBe('Latest');
});
