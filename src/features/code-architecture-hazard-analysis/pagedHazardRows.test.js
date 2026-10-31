import 'fake-indexeddb/auto';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'crypto';
import {serialize,deserialize} from 'v8';
import {sha256} from 'hash.js';
import {saveCodeArchitectureHazardRun,getLatestCodeArchitectureHazardRun,getCodeArchitectureHazardRunById,openCodeArchitectureHazardDB,resolveCodeArchitectureHazardRun,deletePagedHazardRow} from './codeArchitectureHazardStore';
import {queryHazardRows} from './pagedHazardRows';
import {PAGED_HAZARD} from './hazardRowIndex';
import {prepareHazardTableIndex} from './prepareHazardTableIndex';
import {buildCodeArchitectureHazardGroups} from './codeArchitectureHazardGrouping';
beforeEach(()=>{global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;global.structuredClone=v=>deserialize(serialize(v));Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});localStorage.clear();});
const fixture=()=>({id:'paged',projectId:'page',repoId:'r',runState:'complete',architectureRowsSnapshot:['evidence '.repeat(20000)],generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard','Operational Context ID'],...Array.from({length:1000},(_,i)=>['HA-'+i,`row ${i} `+'value '.repeat(100),i%2?'a':'b'])]},pendingAttempt:{runState:'incomplete',generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard'],['partial','saved partial']]}}});
const read=()=>getLatestCodeArchitectureHazardRun({projectId:'page'},{workingSet:true,paged:true});
test('cold descriptor and first page read bounded data without assembling all rows',async()=>{
 const run=fixture();await saveCodeArchitectureHazardRun(run);const get=jest.spyOn(IDBObjectStore.prototype,'get');
 try{
  const descriptor=await read();expect(descriptor[PAGED_HAZARD].total).toBe(1000);expect(descriptor.generatedSheets).toBeUndefined();expect(get.mock.instances.filter(s=>s.name==='hazardRunChunks')).toHaveLength(0);
  const page=await queryHazardRows(descriptor);expect(page.rows).toHaveLength(100);expect(page.rowIndices[99]).toBe(99);expect(page.rows[0][0]).toBe('HA-0');
  expect(get.mock.instances.filter(s=>s.name==='hazardRunChunks').length).toBeLessThan(20);
  expect((await queryHazardRows(descriptor,{offset:900})).rows[99][0]).toBe('HA-999');
 }finally{get.mockRestore();}
});
test('filter, option search, partial inspection and continuation use the complete saved source',async()=>{
 const run=fixture();await saveCodeArchitectureHazardRun(run);const descriptor=await read();
 const match=await queryHazardRows(descriptor,{operation:'query',search:'row 999',context:'a'});expect(match.indices).toEqual([999]);
 expect((await queryHazardRows(descriptor,{indices:match.indices})).rows[0][0]).toBe('HA-999');
 expect((await queryHazardRows(descriptor,{operation:'options',column:0,optionSearch:'HA-999'})).options).toEqual(['HA-999']);
 expect((await queryHazardRows(descriptor,{partial:true})).rows[0][0]).toBe('partial');
 expect(await resolveCodeArchitectureHazardRun(descriptor)).toMatchObject(run);
});
test('streamed row deletion preserves evidence, pending results, and absolute row identity',async()=>{
 const run=fixture();await saveCodeArchitectureHazardRun(run);const descriptor=await read();await deletePagedHazardRow(descriptor,901);
 const full=await getCodeArchitectureHazardRunById(run.id);
 expect(full.generatedSheets.Summary).toEqual(run.generatedSheets.Summary.filter((_,i)=>i!==902));
 expect(full.architectureRowsSnapshot).toEqual(run.architectureRowsSnapshot);expect(full.pendingAttempt).toEqual(run.pendingAttempt);
 await expect(queryHazardRows(descriptor)).rejects.toThrow('changed');
 const next=await read();expect(next[PAGED_HAZARD].total).toBe(999);
});
test('explicit legacy upgrade builds row coordinates without changing original data',async()=>{
 const run=fixture();await saveCodeArchitectureHazardRun(run);const db=await openCodeArchitectureHazardDB(),root=await db.get('hazardAnalysisRuns',run.id);delete root.payload.rowIndex;await db.put('hazardAnalysisRuns',root);
 await expect(read()).rejects.toHaveProperty('code','HAZARD_TABLE_UPGRADE_REQUIRED');await prepareHazardTableIndex(db,run.id);db.close();
 expect((await queryHazardRows(await read())).rows[0][0]).toBe('HA-0');expect(await getCodeArchitectureHazardRunById(run.id)).toMatchObject(run);
});

test('complete layout keeps first-seen grouping and absolute source order without retaining result cells',async()=>{
 const run=fixture();
 run.generatedSheets.Summary=[['Raw Analysis Row ID','From Function','Action','Target Function','Hazard','Operational Context ID'],
  ['a','Plan','Command','Control','private evidence A','normal'],
  ['b','Control','Feedback','Plan','private evidence B','normal'],
  ['c',' plan ',' command ','control','private evidence C','degraded'],
  ['d','Control','Feedback','Plan','private evidence D','degraded']];
 await saveCodeArchitectureHazardRun(run);const descriptor=await read();
 const layout=await queryHazardRows(descriptor,{operation:'layout'});
 const page=await queryHazardRows(descriptor);
 const expected=buildCodeArchitectureHazardGroups(page.headers,page.rows.map((row,rowIndex)=>({row,rowIndex})))
  .map(({key,label,rowCount,items})=>({key:sha256().update(key).digest('hex'),label,rowCount,rowIndices:items.map(item=>item.rowIndex)}));
 expect(layout.groups).toEqual(expected);
 expect(layout.groups.map(group=>group.rowIndices)).toEqual([[0,2],[1,3]]);
 expect(layout.indices).toEqual([0,1,2,3]);expect(layout.total).toBe(4);
 expect(layout.rows).toBeUndefined();expect(JSON.stringify(layout)).not.toContain('private evidence');
 const selected=await queryHazardRows(descriptor,{operation:'layout',context:'degraded',search:'private evidence',filters:{4:['private evidence C']}});
 expect(selected.indices).toEqual([2]);expect(selected.groups[0].rowIndices).toEqual([2]);
 expect((await queryHazardRows(descriptor,{operation:'layout',search:'absent'})).groups).toEqual([]);
 const partial=await queryHazardRows(descriptor,{operation:'layout',partial:true});
 expect(partial.total).toBe(1);expect(partial.indices).toEqual([0]);
 expect(JSON.stringify(partial)).not.toContain('saved partial');
});

test('remote grouping retains full identity but only bounded previews for unusually long control actions',async()=>{
 const run=fixture(),prefix='Very long action '.repeat(10000);
 run.generatedSheets.Summary=[['Raw Analysis Row ID','From Function','Action','Target Function','Hazard'],
  ['a','Plan',prefix+'suffix A','Control','first evidence'],
  ['b','Plan',prefix+'suffix B','Control','second evidence'],
  ['c',' plan ',(prefix+'suffix A').toUpperCase(),'control','third evidence']];
 await saveCodeArchitectureHazardRun(run);const descriptor=await read();
 const layout=await queryHazardRows(descriptor,{operation:'layout'});
 expect(layout.groups.map(group=>group.rowIndices)).toEqual([[0,2],[1]]);
 expect(new Set(layout.groups.map(group=>group.key)).size).toBe(2);
 for(const group of layout.groups){expect(group.key).toMatch(/^[a-f0-9]{64}$/);expect(group.label).toHaveLength(512);expect(group.label.endsWith('…')).toBe(true);}
 expect(layout.groups[0].label).toBe(layout.groups[1].label);
 expect(JSON.stringify(layout).length).toBeLessThan(3000);
 expect(layout.metadataBytes).toBeLessThan(5000);
 const page=await queryHazardRows(descriptor,{indices:[1]});
 expect(page.rows[0][2]).toBe(prefix+'suffix B');
});

test('explicit index pages honor the byte-limited prefix and expose per-row estimates',async()=>{
 const run=fixture();run.generatedSheets.Summary=[['Raw Analysis Row ID','Hazard'],
  ...Array.from({length:4},(_,i)=>['large-'+i,'x'.repeat(300000)])];
 await saveCodeArchitectureHazardRun(run);const descriptor=await read();
 const first=await queryHazardRows(descriptor,{indices:[3,1,2],limit:3});
 expect(first.rowIndices).toEqual([3]);expect(first.nextOffset).toBe(1);
 expect(first.rowBytes[0]).toBeGreaterThan(600000);
 const next=await queryHazardRows(descriptor,{indices:[3,1,2],offset:first.nextOffset,limit:3});
 expect(next.rowIndices).toEqual([1]);expect(next.nextOffset).toBe(2);
});
