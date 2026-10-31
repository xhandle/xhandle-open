import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import useContinuousHazardRows,{HAZARD_ROW_CACHE_BYTES,HAZARD_ROW_CACHE_LIMIT} from './useContinuousHazardRows';
import requestHazardRows from './requestHazardRows';
import {PAGED_HAZARD} from './hazardRowIndex';
jest.mock('./requestHazardRows',()=>({__esModule:true,default:jest.fn()}));
global.IS_REACT_ACT_ENVIRONMENT=true;

const run={id:'continuous',[PAGED_HAZARD]:{revision:'one',generation:'first',total:2000}};
const layout={headers:['ID','Hazard'],total:2000};
const range=(start,count)=>Array.from({length:count},(_,i)=>start+i);
const page=(options,count=100,bytes)=>{
 const rowIndices=options.indices.slice(0,count);
 return {headers:layout.headers,rows:rowIndices.map(index=>['ID-'+index,'Hazard '+index]),rowIndices,
  rowBytes:rowIndices.map(()=>bytes||100),offset:0,nextOffset:rowIndices.length,total:options.indices.length};
};
let host,root,model,props;
function Probe(input){model=useContinuousHazardRows(input);return <div>{model.rowsByIndex.size}</div>;}
async function render(next={}){
 props={...props,...next};await act(async()=>root.render(<Probe {...props}/>));
}
async function settle(){
 await act(async()=>{for(let i=0;i<100;i++)await Promise.resolve();});
}
beforeEach(()=>{
 requestHazardRows.mockReset();requestHazardRows.mockImplementation(async(_run,options)=>page(options));
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
 props={run,layout,queryKey:'all',requestedRowIndices:[]};
});
afterEach(()=>{act(()=>root.unmount());host.remove();});

test('keeps stable immutable row snapshots across equivalent viewport and unrelated run updates',async()=>{
 await render({requestedRowIndices:range(0,150)});await settle();
 expect(model.rowsByIndex.size).toBe(150);expect(model.rowsByIndex.get(149)).toEqual(['ID-149','Hazard 149']);
 const snapshot=model.rowsByIndex,calls=requestHazardRows.mock.calls.length;
 await render({requestedRowIndices:range(0,150),run:{...run,reviewStatus:'reviewed'}});await settle();
 expect(requestHazardRows).toHaveBeenCalledTimes(calls);expect(model.rowsByIndex).toBe(snapshot);
 await render({requestedRowIndices:range(100,150)});await settle();
 expect(model.rowsByIndex).not.toBe(snapshot);expect(snapshot.has(249)).toBe(false);
 expect(model.rowsByIndex.get(249)[0]).toBe('ID-249');
});

test('loads every requested absolute index across short byte-limited pages with at most two workers',async()=>{
 let active=0,maximum=0;
 requestHazardRows.mockImplementation(async(_run,options)=>{
  active++;maximum=Math.max(maximum,active);await Promise.resolve();active--;return page(options,7);
 });
 const indices=[999,8,500,...range(20,137)];
 await render({requestedRowIndices:indices});await settle();
 expect([...model.rowsByIndex.keys()].sort((a,b)=>a-b)).toEqual([...indices].sort((a,b)=>a-b));
 expect(model.rowsByIndex.get(999)[0]).toBe('ID-999');expect(maximum).toBe(2);
 expect(requestHazardRows.mock.calls.length).toBeGreaterThan(2);
 expect(requestHazardRows.mock.calls.every(([,options])=>options.indices.length<=100&&options.offset===0)).toBe(true);
 expect(model.loading).toBe(false);expect(model.error).toBeNull();
});

test('aborts obsolete viewport requests and ignores late results from the old range and scope',async()=>{
 const pending=[];
 requestHazardRows.mockImplementation((_run,options)=>new Promise(resolve=>pending.push({options,resolve})));
 await render({requestedRowIndices:range(0,200)});await settle();expect(pending).toHaveLength(2);
 await render({requestedRowIndices:range(1000,200)});await settle();expect(pending).toHaveLength(4);
 expect(pending.slice(0,2).every(item=>item.options.signal.aborted)).toBe(true);
 await act(async()=>pending.slice(0,2).forEach(item=>item.resolve(page(item.options))));
 expect(model.rowsByIndex.size).toBe(0);
 await act(async()=>pending.slice(2,4).forEach(item=>item.resolve(page(item.options))));await settle();
 expect(model.rowsByIndex.has(1000)).toBe(true);expect(model.rowsByIndex.has(0)).toBe(false);
 await render({queryKey:'filtered',partial:true,requestedRowIndices:[7]});await settle();
 expect(model.rowsByIndex.size).toBe(0);expect(pending.at(-1).options.partial).toBe(true);
 const request=pending.at(-1);await render({run:{...run,[PAGED_HAZARD]:{...run[PAGED_HAZARD],revision:'two'}},requestedRowIndices:[9]});await settle();
 expect(request.options.signal.aborted).toBe(true);
 await act(async()=>request.resolve(page(request.options)));expect(model.rowsByIndex.size).toBe(0);
 const unmounted=pending.at(-1);act(()=>root.render(null));expect(unmounted.options.signal.aborted).toBe(true);
 await act(async()=>unmounted.resolve(page(unmounted.options)));expect(host.textContent).toBe('');
});

test('evicts old rows at the count bound and reloads reverse-scroll misses',async()=>{
 await render({requestedRowIndices:range(0,200)});await settle();
 await render({requestedRowIndices:range(200,200)});await settle();expect(model.rowsByIndex.size).toBe(400);
 await render({requestedRowIndices:range(400,200)});await settle();
 expect(model.cacheStats.rows).toBe(HAZARD_ROW_CACHE_LIMIT);expect(model.rowsByIndex.has(0)).toBe(false);
 const before=requestHazardRows.mock.calls.length;
 await render({requestedRowIndices:range(0,30)});await settle();
 expect(requestHazardRows.mock.calls.length).toBeGreaterThan(before);expect(model.rowsByIndex.get(0)[0]).toBe('ID-0');
 expect(model.cacheStats.rows).toBeLessThanOrEqual(HAZARD_ROW_CACHE_LIMIT);
});

test('the byte cap preserves viewport priority and does not continuously refetch evicted prefetch',async()=>{
 requestHazardRows.mockImplementation(async(_run,options)=>page(options,1,6*1024*1024));
 await render({requestedRowIndices:range(0,150),requiredRowIndices:[0]});await settle();
 expect(model.rowsByIndex.has(0)).toBe(true);expect(model.rowsByIndex.has(1)).toBe(true);
 expect(model.cacheStats.bytes).toBeLessThanOrEqual(HAZARD_ROW_CACHE_BYTES);
 expect(model.loading).toBe(false);expect(model.error).toBeNull();
 const count=requestHazardRows.mock.calls.length;expect(count).toBeLessThan(10);
 await render({requestedRowIndices:range(0,150),requiredRowIndices:[0]});await settle();
 expect(requestHazardRows).toHaveBeenCalledTimes(count);
 await render({requestedRowIndices:range(150,150),requiredRowIndices:[150]});await settle();
 expect(model.rowsByIndex.has(150)).toBe(true);expect(model.rowsByIndex.has(0)).toBe(false);
 expect(model.cacheStats.bytes).toBeLessThanOrEqual(HAZARD_ROW_CACHE_BYTES);
});

test('reports required rows that cannot fit, while retaining readable rows and offering a useful recovery',async()=>{
 requestHazardRows.mockImplementation(async(_run,options)=>page(options,1,6*1024*1024));
 await render({requestedRowIndices:range(0,150),requiredRowIndices:[0,1,2]});await settle();
 expect(model.rowsByIndex.has(0)).toBe(true);expect(model.cacheStats.bytes).toBeLessThanOrEqual(HAZARD_ROW_CACHE_BYTES);
 expect(model.loading).toBe(false);expect(model.error.message).toMatch(/Narrow the table filters or export/);
 await render({requestedRowIndices:[2],requiredRowIndices:[2]});await settle();
 expect(model.rowsByIndex.has(2)).toBe(true);expect(model.error).toBeNull();
});

test('failed reads keep cached rows, stop automatic retry, and retry explicitly without changing snapshots unnecessarily',async()=>{
 await render({requestedRowIndices:range(0,20)});await settle();const snapshot=model.rowsByIndex;
 requestHazardRows.mockRejectedValueOnce(new Error('Saved page unavailable'));
 await render({requestedRowIndices:range(0,40)});await settle();
 expect(model.rowsByIndex).toBe(snapshot);expect(model.error.message).toBe('Saved page unavailable');expect(model.loading).toBe(false);
 const count=requestHazardRows.mock.calls.length;await settle();expect(requestHazardRows).toHaveBeenCalledTimes(count);
 await act(async()=>model.retry());await settle();
 expect(model.rowsByIndex.size).toBe(40);expect(model.error).toBeNull();
});

test('rejects a zero-progress page instead of spinning and starts no requests before layout is available',async()=>{
 await render({layout:null,requestedRowIndices:[4]});await settle();expect(requestHazardRows).not.toHaveBeenCalled();
 requestHazardRows.mockResolvedValue({rows:[],rowIndices:[],nextOffset:0});
 await render({layout});await settle();
 expect(requestHazardRows).toHaveBeenCalledTimes(1);expect(model.error.message).toMatch(/invalid or empty range/);expect(model.loading).toBe(false);
});
