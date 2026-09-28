import { openDB } from 'idb';
import { openRecoveryDatabase, recoveryRecord, saveRecoveryRecord, deleteProjectRecovery } from './durableRecovery';
jest.mock('idb', () => ({ openDB: jest.fn() }));
afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });
test('late connections close without running after a timeout', async () => {
 jest.useFakeTimers();
 let connect; const close=jest.fn();
 openDB.mockImplementation(()=>new Promise(resolve=>{connect=resolve;}));
 const request=openRecoveryDatabase('test',1,{},10);
 const rejected=expect(request).rejects.toThrow('timed out');
 await Promise.resolve(); jest.advanceTimersByTime(10); await rejected;
 connect({close}); await Promise.resolve(); await Promise.resolve();
 expect(close).toHaveBeenCalled();
});
test('checkpoint survives a new connection and keeps a snapshot', async () => {
 const disk=new Map();
 openDB.mockImplementation(async()=>({close:jest.fn(),transaction:()=>({done:Promise.resolve(),store:{get:async k=>disk.get(k),put:async(v,k)=>disk.set(k,v)}})}));
 const value={responseRows:[{controlAction:'Stop'}]};
 const saved=saveRecoveryRecord('decomposition:p',value);
 value.responseRows[0].controlAction='Changed';
 await saved;
 expect(await recoveryRecord('decomposition:p')).toEqual({responseRows:[{controlAction:'Stop'}]});
});
test('stalled transaction aborts and rejects rather than holding queue',async()=>{
 jest.useFakeTimers();const abort=jest.fn();
 openDB.mockResolvedValue({close:jest.fn(),transaction:()=>({abort,done:Promise.resolve(),store:{put:()=>new Promise(()=>{})}})});
 const request=recoveryRecord('p',{});const rejected=expect(request).rejects.toThrow('timed out');
 for(let i=0;i<10;i++)await Promise.resolve();
 jest.advanceTimersByTime(10000);await rejected;expect(abort).toHaveBeenCalled();
});
test('coalesces many queued snapshots to latest while storage is stalled',async()=>{
 let release;const values=[];
 openDB.mockImplementation(async()=>({close:jest.fn(),transaction:()=>({done:Promise.resolve(),store:{put:async value=>{values.push(value.n);if(values.length===1)await new Promise(resolve=>{release=resolve;});}}})}));
 const first=saveRecoveryRecord('queue-bound',{n:0});
 for(let i=0;i<10;i++)await Promise.resolve();
 const pending=[];for(let n=1;n<=100;n++)pending.push(saveRecoveryRecord('queue-bound',{n}));
 expect(new Set(pending).size).toBe(1);
 release();await Promise.all([first,...pending]);
 expect(values).toEqual([0,100]);
});

test('deletion drains queued writes and rejects late checkpoints', async () => {
 const disk=new Map(); let release;
 openDB.mockImplementation(async()=>({close:jest.fn(),transaction:()=>({done:Promise.resolve(),store:{
 put:async(v,k)=>{if(v.n===1)await new Promise(resolve=>{release=resolve;});disk.set(k,v);},
 delete:async k=>disk.delete(k), get:async k=>disk.get(k)
 }})}));
 const first=saveRecoveryRecord('decomposition:deleted',{n:1});
 for(let i=0;i<10;i++)await Promise.resolve();
 const second=saveRecoveryRecord('decomposition:deleted',{n:2});
 const deletion=deleteProjectRecovery('deleted');
 await expect(saveRecoveryRecord('hazard-run:deleted',{})).rejects.toThrow('deleted');
 release();await Promise.all([first,second,deletion]);
 expect(disk.size).toBe(0);
});
