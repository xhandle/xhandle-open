import { withWorkspaceGraphMigrationPaused as locked } from './workspaceGraphIndexLock';
afterEach(()=>{jest.useRealTimers();Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});});
test('cleanup waits for indexing and runs in order',async()=>{
 const calls:string[]=[];let release:()=>void=()=>{};
 const first=locked(async()=>{calls.push('index');await new Promise<void>(r=>{release=r;});calls.push('indexed');});
 await Promise.resolve();const second=locked(async()=>{calls.push('cleanup');});
 expect(calls).toEqual(['index']);release();await Promise.all([first,second]);expect(calls).toEqual(['index','indexed','cleanup']);
});
test('timed-out cleanup cannot run later after the cross-window lock releases',async()=>{
 jest.useFakeTimers();let grant:(value:any)=>void=()=>{};const operation=jest.fn(async()=>{});
 Object.defineProperty(navigator,'locks',{value:{request:(_name,run)=>new Promise((resolve,reject)=>{grant=()=>{try{resolve(run());}catch(error){reject(error);}};})},configurable:true});
 const pending=locked(operation,20);const rejected=expect(pending).rejects.toThrow(/still busy/);
 await Promise.resolve();jest.advanceTimersByTime(20);await rejected;
 try{grant(undefined);}catch(error){expect(error.message).toMatch(/no delayed cleanup/);}
 expect(operation).not.toHaveBeenCalled();
});
