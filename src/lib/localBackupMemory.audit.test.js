// Prevention regressions for the memory investigation findings.
jest.mock('idb',()=>({openDB:jest.fn()}));
jest.mock('../components/utils/traceabilityDb',()=>({ensureTraceabilitySchema:jest.fn(),openTraceabilityDB:jest.fn()}));
jest.mock('../features/workspace-graph',()=>({WORKSPACE_GRAPH_DB_NAME:'graph',WORKSPACE_GRAPH_DB_VERSION:1,WORKSPACE_GRAPH_STORES:{projects:'projects'},openWorkspaceGraphDB:jest.fn()}));
let service,openDB,listeners;
beforeEach(()=>{
 jest.resetModules();localStorage.clear();listeners=[];
 openDB=require('idb').openDB;service=require('./localBackupService');
 for(const target of [window,document]){
  const original=target.addEventListener.bind(target);
  jest.spyOn(target,'addEventListener').mockImplementation((type,fn,...args)=>{listeners.push([target,type,fn]);original(type,fn,...args);});
 }
});
afterEach(()=>{for(const [target,type,fn] of listeners)target.removeEventListener(type,fn);jest.restoreAllMocks();delete document.visibilityState;delete window.showDirectoryPicker;});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('hiding dirty workspace with backups disabled/no folder performs no database reads',async()=>{
 localStorage.setItem('xhandle.backup.settings.v1',JSON.stringify({autoBackupEnabled:false}));
 await service.initializeLocalBackupRuntime();
 const now=Date.now();jest.spyOn(Date,'now').mockReturnValue(now+1000);
 window.dispatchEvent(new CustomEvent('xhandle:data-changed'));
 expect(service.getLocalBackupState().pendingChanges).toBe(true);
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
 document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('visibilitychange'));
 await flush();expect(openDB).not.toHaveBeenCalled();
 await service.backupNow({source:'visibility',silentIfUnavailable:true});expect(openDB).not.toHaveBeenCalled();
});
test('manual folder backup checks destination before reading any workspace store',async()=>{
 window.showDirectoryPicker=jest.fn();
 openDB.mockResolvedValue({get:jest.fn().mockResolvedValue(null),close:jest.fn()});
 await expect(service.backupNow()).rejects.toThrow('Choose a backup folder');
 expect(openDB).toHaveBeenCalledTimes(1);
 expect(openDB.mock.calls[0][0]).toBe('xHandleBackupConfig');
});
test('overlapping backups share one snapshot and close failed snapshot connections',async()=>{
 window.showDirectoryPicker=jest.fn();
 const handle={queryPermission:jest.fn().mockResolvedValue('granted')};
 let rejectRead;const read=jest.fn(()=>new Promise((resolve,reject)=>{rejectRead=reject;}));
 const close=jest.fn();
 openDB.mockImplementation(name=>Promise.resolve(name==='xHandleBackupConfig'?{get:async()=>handle,close:jest.fn()}:{objectStoreNames:{contains:()=>true},transaction:()=>({objectStore:()=>({getAll:read})}),close}));
 const first=service.backupNow({silentIfUnavailable:true});const second=service.backupNow({silentIfUnavailable:true});
 expect(second).toBe(first);await flush();expect(read).toHaveBeenCalledTimes(1);
 await expect(service.backupNow({mode:'download'})).rejects.toThrow('already running');
 rejectRead(new Error('fixture failure'));await first;expect(close).toHaveBeenCalledTimes(1);
 expect(service.getLocalBackupState().busy).toBe(false);
});
test('startup does not open or parse the backup file just to show folder status',async()=>{
 window.showDirectoryPicker=jest.fn();
 localStorage.setItem('xhandle.backup.settings.v1',JSON.stringify({autoBackupEnabled:false}));
 const handle={name:'fixture',queryPermission:async()=> 'granted',getFileHandle:jest.fn(()=>{throw new Error('Do not read snapshot during startup');})};
 const close=jest.fn();openDB.mockResolvedValue({get:async()=>handle,close});
 await service.initializeLocalBackupRuntime();
 expect(service.getLocalBackupState().folderConfigured).toBe(true);
 expect(handle.getFileHandle).not.toHaveBeenCalled();expect(close).toHaveBeenCalled();
});
