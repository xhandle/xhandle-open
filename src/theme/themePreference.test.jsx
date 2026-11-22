import {createThemePreference,THEME_STORAGE_KEY} from './themePreference';
import fs from 'fs';
import vm from 'vm';

global.IS_REACT_ACT_ENVIRONMENT=true;
function fixture({saved=null,dark=false,blocked=false,legacy=false}={}) {
 const storage=new Map(saved===null?[]:[[THEME_STORAGE_KEY,saved]]),events=new Map();
 const media={matches:dark,addEventListener:jest.fn((_name,fn)=>events.set('media',fn)),removeEventListener:jest.fn(),addListener:jest.fn(fn=>events.set('media',fn)),removeListener:jest.fn()};
 if(legacy){delete media.addEventListener;delete media.removeEventListener;}
 const host={document,matchMedia:()=>media,localStorage:{getItem:jest.fn(key=>{if(blocked)throw Error('blocked');return storage.get(key)||null;}),setItem:jest.fn((key,value)=>{if(blocked)throw Error('blocked');storage.set(key,value);})},addEventListener:jest.fn((name,fn)=>events.set(name,fn)),removeEventListener:jest.fn(),xhandleDesktop:{setThemePreference:jest.fn(()=>Promise.resolve())}};
 return {host,media,events,storage,controller:createThemePreference(host)};
}
afterEach(()=>{document.documentElement.classList.remove('dark');document.documentElement.removeAttribute('data-theme');document.documentElement.style.colorScheme='';});
test('initial system resolution does not pin the OS choice and follows subsequent changes',()=>{
 const f=fixture({dark:true}),changed=jest.fn(),off=f.controller.subscribe(changed);
 expect(f.controller.getSnapshot()).toMatchObject({preference:'system',mode:'dark'});expect(f.host.localStorage.setItem).not.toHaveBeenCalled();
 f.media.matches=false;f.events.get('media')();expect(f.controller.getSnapshot().mode).toBe('light');expect(changed).toHaveBeenCalledTimes(1);
 expect(document.documentElement.dataset.theme).toBe('light');off();expect(f.media.removeEventListener).toHaveBeenCalled();
});
test.each(['light','dark'])('preserves legacy explicit %s preference until system is selected',saved=>{
 const f=fixture({saved,dark:saved==='light'}),off=f.controller.subscribe(()=>{});
 f.events.get('media')();expect(f.controller.getSnapshot().mode).toBe(saved);
 f.controller.setPreference('system');expect(f.storage.get(THEME_STORAGE_KEY)).toBe('system');expect(f.controller.getSnapshot().mode).not.toBe(saved);off();
});
test('storage changes and cleared preferences synchronize without writing back or feedback loops',()=>{
 const f=fixture({saved:'light'}),off=f.controller.subscribe(()=>{});
 f.storage.set(THEME_STORAGE_KEY,'dark');f.events.get('storage')({key:THEME_STORAGE_KEY});expect(f.controller.getSnapshot().mode).toBe('dark');
 expect(f.host.localStorage.setItem).not.toHaveBeenCalled();f.storage.clear();f.events.get('storage')({key:null});expect(f.controller.getSnapshot().preference).toBe('system');off();
});
test('unavailable storage still applies a manual choice and exposes a recoverable preference message',()=>{
 const f=fixture({blocked:true});expect(()=>f.controller.setPreference('dark')).not.toThrow();expect(document.documentElement.classList.contains('dark')).toBe(true);
 expect(f.controller.getSnapshot().error).toContain('could not save');
});
test('supports legacy OS listeners, missing APIs and stable snapshots',()=>{
 const f=fixture({legacy:true});const first=f.controller.getSnapshot(),off=f.controller.subscribe(()=>{});expect(f.media.addListener).toHaveBeenCalled();expect(f.controller.getSnapshot()).toBe(first);off();expect(f.media.removeListener).toHaveBeenCalled();
 const bare=createThemePreference(null);expect(bare.getSnapshot().mode).toBe('light');expect(()=>bare.setPreference('dark')).not.toThrow();
});
test('multiple subscribers share one OS subscription and native bridge receives only resolved preferences',()=>{
 const f=fixture(),a=f.controller.subscribe(()=>{}),b=f.controller.subscribe(()=>{});
 expect(f.media.addEventListener).toHaveBeenCalledTimes(1);f.controller.setPreference('dark');f.controller.setPreference('invalid');
 expect(f.host.xhandleDesktop.setThemePreference.mock.calls.map(([value])=>value)).toEqual(['system','dark','system']);a();expect(f.media.removeEventListener).not.toHaveBeenCalled();b();expect(f.media.removeEventListener).toHaveBeenCalledTimes(1);
});
test('first-paint bootstrap honors saved/system choices without writing to storage',()=>{
 const code=fs.readFileSync('public/theme-init.js','utf8');
 for(const [saved,dark,expected]of [['dark',false,true],['light',true,false],[null,true,true],[null,false,false],['system',true,true]]){
  const root={classList:{toggle:jest.fn()},setAttribute:jest.fn(),style:{}};const setItem=jest.fn();
  vm.runInNewContext(code,{document:{documentElement:root,querySelector:()=>null},window:{matchMedia:()=>({matches:dark})},localStorage:{getItem:()=>saved,setItem}});
  expect(root.classList.toggle).toHaveBeenCalledWith('dark',expected);expect(root.style.colorScheme).toBe(expected?'dark':'light');expect(setItem).not.toHaveBeenCalled();
 }
 expect(()=>vm.runInNewContext(code,{document:{documentElement:{classList:{toggle:()=>{}},setAttribute:()=>{},style:{}},querySelector:()=>null},window:{},get localStorage(){throw Error('blocked');}})).not.toThrow();
});
