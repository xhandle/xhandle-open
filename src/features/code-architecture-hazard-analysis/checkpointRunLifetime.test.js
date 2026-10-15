import {createHazardRunRegistry} from './hazardRunRegistry';
import {resilientHazardCheckpoint} from './resilientHazardCheckpoint';
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
test('finished run retries cannot overwrite a regenerated checkpoint for identical inputs',async()=>{
 jest.useFakeTimers();
 try{
  const registry=createHazardRunRegistry(),store=new Map(),first=registry.start('project:repo');
  let fail=true;
  const write=jest.fn(async(key,value)=>{if(fail){fail=false;throw new Error('transient');}store.set(key.id,value);});
  const oldCache=resilientHazardCheckpoint({write},{signal:first.controller.signal});
  await oldCache.write({id:'same-input'},'old');await tick();
  expect(await oldCache.flush()).toMatchObject({unsaved:true});registry.finish('project:repo',first);
  const second=registry.start('project:repo');store.clear();
  const newCache=resilientHazardCheckpoint({write:async(key,value)=>store.set(key.id,value)},{signal:second.controller.signal});
  await newCache.write({id:'same-input'},'new');await newCache.flush();
  jest.advanceTimersByTime(60000);await tick();
  expect(store.get('same-input')).toBe('new');expect(write).toHaveBeenCalledTimes(1);
  registry.close();
 }finally{jest.clearAllTimers();jest.useRealTimers();}
});
