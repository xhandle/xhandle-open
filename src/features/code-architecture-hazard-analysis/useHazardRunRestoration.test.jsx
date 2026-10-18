import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import useHazardRunRestoration from './useHazardRunRestoration';
import { createHazardRunRegistry } from './hazardRunRegistry';
global.IS_REACT_ACT_ENVIRONMENT = true;
let root, api, config, visible, frames;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
function Harness() {
  api = useHazardRunRestoration(config);
  frames.push({ state: api.status, run: api.scopeReady ? visible : null });
  return null;
}
const render = () => act(async () => root.render(<Harness/>));
const settle = callback => act(async () => { callback(); await Promise.resolve(); });
const changed = () => window.dispatchEvent(new CustomEvent('xhandle:code-architecture-hazard-analysis:changed', {detail:{projectId:config.projectId,repoId:config.repoId}}));
beforeEach(() => {
  root=createRoot(document.createElement('div'));visible=null;frames=[];
  config={projectId:'p',connectionId:'c',repoId:'r',registry:{current:createHazardRunRegistry()},pendingContextSave:{current:null},contextVersion:{current:0},
    read:jest.fn().mockResolvedValue(null),save:jest.fn().mockResolvedValue(),align:run=>run,
    publish:jest.fn(run=>{visible=run;}),getCurrentRun:()=>visible};
});
afterEach(()=>act(()=>root.unmount()));
test('delayed completed run is loading, never empty, until restored',async()=>{
  const d=deferred();config.read.mockReturnValue(d.promise);await render();expect(api.status).toBe('loading');
  const run={id:'large',generatedSheets:{Summary:Array.from({length:26279},()=>['cell'])}};
  await settle(()=>d.resolve(run));expect(api.status).toBe('loaded');expect(visible).toBe(run);expect(frames.some(f=>f.state==='empty')).toBe(false);
});
test('only a successful absent result is empty; retry reads storage only',async()=>{
  config.read.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);await render();expect(api.status).toBe('failed');
  await settle(()=>api.retry());expect(api.status).toBe('empty');expect(config.read).toHaveBeenCalledTimes(2);expect(config.save).not.toHaveBeenCalled();
});
test('failed refresh retains previously loaded results; later retry restores',async()=>{
  const first={id:'first'},second={id:'second'};
  config.read.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('busy')).mockResolvedValueOnce(second);
  await render();await settle(changed);expect(api.status).toBe('failed');expect(visible).toBe(first);
  await settle(()=>api.retry());expect(visible).toBe(second);expect(api.status).toBe('loaded');
});
test('out-of-order response cannot overwrite newer retry',async()=>{
  const old=deferred(),recent=deferred();config.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
  await render();await settle(()=>api.retry());await settle(()=>recent.resolve({id:'new'}));await settle(()=>old.resolve({id:'old'}));expect(visible.id).toBe('new');
});
test('switching scopes masks the previous result immediately and ignores departed reads',async()=>{
  config.read.mockResolvedValueOnce({id:'A'});await render();
  const old=deferred();config.read.mockReturnValueOnce(old.promise);await settle(changed);
  const next=deferred();config={...config,projectId:'b',repoId:'b',read:jest.fn(()=>next.promise)};frames=[];await render();
  expect(frames.every(f=>!f.run)).toBe(true);await settle(()=>old.resolve({id:'stale A'}));expect(visible).toBeNull();
  await settle(()=>next.resolve({id:'B'}));expect(visible.id).toBe('B');
});
test('context save failure does not hide the loaded result',async()=>{
  const run={id:'saved'};config.read.mockResolvedValue(run);config.align=r=>({...r,aligned:true});config.save.mockRejectedValue(new Error('quota'));
  await render();expect(visible).toBe(run);expect(api.status).toBe('loaded');expect(api.contextError).toBe('quota');
});
test('slow alignment save publishes original first and cannot overwrite intervening edits',async()=>{
  const run={id:'saved'},d=deferred();config.read.mockResolvedValue(run);config.align=r=>({...r,aligned:true});config.save.mockReturnValue(d.promise);
  await render();expect(visible).toBe(run);visible={...run,edited:true};await settle(()=>d.resolve());expect(visible.edited).toBe(true);
});
test('context version invalidation schedules a fresh read',async()=>{
  const d=deferred();config.read.mockReturnValueOnce(d.promise).mockResolvedValueOnce({id:'fresh'});await render();
  config.contextVersion.current++;await settle(()=>d.resolve({id:'stale'}));expect(visible.id).toBe('fresh');expect(config.read).toHaveBeenCalledTimes(2);
});
test('active generation publication wins over delayed restoration',async()=>{
  const d=deferred();config.read.mockReturnValue(d.promise);await render();const live=config.registry.current.start('p:c');live.run={id:'live'};
  await settle(()=>d.resolve({id:'old'}));expect(visible.id).toBe('live');expect(api.status).toBe('loaded');
});
test('unrelated storage changes do not reload and unmount removes listener',async()=>{
  await render();await settle(()=>window.dispatchEvent(new CustomEvent('xhandle:code-architecture-hazard-analysis:changed',{detail:{projectId:'other'}})));
  expect(config.read).toHaveBeenCalledTimes(1);
});
test('an intervening edit or explicit clear wins over a background read',async()=>{
  const run={id:'saved'};config.read.mockResolvedValueOnce(run);await render();
  const d=deferred();config.read.mockReturnValueOnce(d.promise);await settle(changed);
  visible={...run,edited:true};await settle(()=>d.resolve(run));expect(visible.edited).toBe(true);
  const e=deferred();config.read.mockReturnValueOnce(e.promise);await settle(changed);
  visible=null;await settle(()=>e.resolve(run));expect(visible).toBeNull();expect(api.status).toBe('empty');
});
test('successful context save publishes aligned results and stale failure cannot affect a new scope',async()=>{
  const d=deferred(),run={id:'saved'};config.read.mockResolvedValue(run);config.align=r=>({...r,aligned:true});config.save.mockReturnValue(d.promise);
  await render();await settle(()=>d.resolve());expect(visible.aligned).toBe(true);
  const e=deferred();config.save.mockReturnValue(e.promise);await settle(changed);
  config={...config,projectId:'new',repoId:'new',align:r=>r,read:jest.fn().mockResolvedValue({id:'new'})};await render();
  await settle(()=>e.reject(new Error('old save')));expect(visible.id).toBe('new');expect(api.contextError).toBe('');
});
test('a failed pending context save still permits restoring previous durable results',async()=>{
  const d=deferred();config.pendingContextSave.current={scope:'p:c',promise:d.promise};config.read.mockResolvedValue({id:'durable'});
  await render();expect(api.status).toBe('loading');expect(config.read).not.toHaveBeenCalled();
  await settle(()=>d.reject(new Error('context failed')));expect(visible.id).toBe('durable');expect(api.status).toBe('loaded');
});
test('unmount prevents late publication and removes the reload listener',async()=>{
  const d=deferred();config.read.mockReturnValue(d.promise);await render();
  const calls=config.publish.mock.calls.length;await act(async()=>root.unmount());root=createRoot(document.createElement('div'));
  await settle(()=>{changed();d.resolve({id:'late'});});
  expect(config.read).toHaveBeenCalledTimes(1);expect(config.publish).toHaveBeenCalledTimes(calls);
});
