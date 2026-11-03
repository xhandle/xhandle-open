import 'fake-indexeddb/auto';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'crypto';
import {serialize,deserialize} from 'v8';
import {Blob} from 'buffer';
import {openDB} from 'idb';
import {TextDecoder} from 'util';
import {prepareHazardCsvImport,applyHazardCsvImport,discardHazardCsvImport} from './hazardCsvImport';
import {saveCodeArchitectureHazardRun,getCodeArchitectureHazardRunById,getLatestCodeArchitectureHazardRun} from './codeArchitectureHazardStore';
import {PAGED_HAZARD} from './hazardRowIndex';
import {openHazardSchema} from './hazardSchema';
import {HAZARD_CHUNKS,hazardChunkKey,hazardChunkDigest} from './hazardRunChunks';
import {toCsvText} from '../../lib/csv';
import {queryHazardRows} from './pagedHazardRows';
import {assignImportedHazardContext} from './codeHazardImportContext';
beforeEach(()=>{global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;global.TextDecoder=TextDecoder;global.structuredClone=value=>deserialize(serialize(value));Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});localStorage.clear();});
const headers=['Raw Analysis Row ID','Function (From)','Control Action','Function (To)','Guide Phrase','Hazard','Safety Classification','Safety Significant','Classification Resolution Status'];
const fixture=()=>({id:'csv-run',projectId:'project',repoId:'repo',hazardMethod:'STPA-Textbook',updatedAt:'2026-01-01',architectureRowsSnapshot:['evidence'],generatedSheets:{Summary:[headers,['one','Sensor','Send','Monitor','Not providing','','','', ''],['two','Sensor','Send','Monitor','Providing too late','retain me','','','']] ,Other:[['important'],['retained']]},userPreprocessing:{other:{values:{Hazard:'retain unknown assessment'}}},narrativeReviewInput:{text:'retained narrative'}});
const csv=(hazard='Completed external hazard')=>new Blob([toCsvText([headers,['one','Sensor','Send','Monitor','Not providing',hazard,'Physical safety relevance not established','Not established','']])]);
test.each([false,true])('stages changes without publication, then saves/reopens/undoes with evidence intact (saved=%s)',async saved=>{
 const run=fixture();if(saved)await saveCodeArchitectureHazardRun(run);
 const source=saved?await getLatestCodeArchitectureHazardRun({projectId:run.projectId},{workingSet:true,paged:true}):run;
 const preview=await prepareHazardCsvImport({run:source,file:csv()});expect(preview.changedRowCount).toBe(1);
 if(!saved)expect(await getCodeArchitectureHazardRunById(run.id)).toBeNull();
 else expect((await getCodeArchitectureHazardRunById(run.id)).generatedSheets.Summary[1][5]).toBe('');
 const result=await applyHazardCsvImport(preview.sessionId,{currentRun:source});expect(result.run[PAGED_HAZARD]).toBeTruthy();
 const imported=await getCodeArchitectureHazardRunById(run.id);
 expect(imported.generatedSheets.Summary[1][5]).toBe('Completed external hazard');expect(imported.generatedSheets.Summary[2]).toEqual(run.generatedSheets.Summary[2]);
 expect(imported.generatedSheets.Other).toEqual(run.generatedSheets.Other);expect(imported.architectureRowsSnapshot).toEqual(run.architectureRowsSnapshot);expect(imported.narrativeReviewInput).toEqual(run.narrativeReviewInput);
 expect(imported.userPreprocessing.one.values.Hazard).toBe('Completed external hazard');expect(imported.userPreprocessing.other).toEqual(run.userPreprocessing.other);
 const edits=await openDB('xhandle-hazard-csv-imports-v1');for(const table of ['sessions','baseline','updates','seen','preprocessing'])expect(await edits.count(table)).toBe(0);edits.close();
 const undo=await prepareHazardCsvImport({run:result.run,undo:true});await applyHazardCsvImport(undo.sessionId,{currentRun:result.run});
 const restored=await getCodeArchitectureHazardRunById(run.id);expect(restored.generatedSheets.Summary[1][5]).toBe('');expect(restored.userPreprocessing).toEqual(run.userPreprocessing);expect(restored.csvImportPreviousSummary).toBeNull();
});
test('equivalent draft copies remain applicable while real edits are rejected',async()=>{
 const run=fixture(),plan=await prepareHazardCsvImport({run,file:csv()});
 const copy={...structuredClone(run),id:'refreshed-draft-id'};await expect(applyHazardCsvImport(plan.sessionId,{currentRun:copy})).resolves.toHaveProperty('run');
 const next=fixture();next.id='second';const pending=await prepareHazardCsvImport({run:next,file:csv()});const changed=structuredClone(next);changed.generatedSheets.Summary[1][5]='a new edit';
 await expect(applyHazardCsvImport(pending.sessionId,{currentRun:changed})).rejects.toThrow('table changed');await discardHazardCsvImport(pending.sessionId);
});

test.each([false,true])('derived-row caches are regenerated rather than staged (saved=%s)',async saved=>{
 const run=fixture();run.summaryRows=[{row:run.generatedSheets.Summary[1],Hazard:'stale cached text'}];
 if(saved)await saveCodeArchitectureHazardRun(run);
 const plan=await prepareHazardCsvImport({run,file:csv()});
 const edits=await openDB('xhandle-hazard-csv-imports-v1');const session=await edits.get('sessions',plan.sessionId);edits.close();
 expect(session.root.payload.rowIndex.recordSummarySpans).toHaveLength(0);
 await applyHazardCsvImport(plan.sessionId,{currentRun:run});
 const imported=await getCodeArchitectureHazardRunById(run.id);expect(imported.summaryRows).toHaveLength(2);expect(imported.summaryRows[0].Hazard).toBe('Completed external hazard');expect(imported.generatedSheets.Other).toEqual(run.generatedSheets.Other);
});

test.each([false,true])('large evidence-only pages survive import, save, and undo (saved=%s)',async saved=>{
 const run=fixture();run.architectureRowsSnapshot=[{details:'Original architecture evidence '.repeat(12000)}];run.narrativeReviewInput={text:'Original narrative evidence '.repeat(10000)};
 if(saved)await saveCodeArchitectureHazardRun(run);
 const source=saved?await getLatestCodeArchitectureHazardRun({projectId:run.projectId},{workingSet:true,paged:true}):run;
 const plan=await prepareHazardCsvImport({run:source,file:csv()});
 const edits=await openDB('xhandle-hazard-csv-imports-v1'),session=await edits.get('sessions',plan.sessionId);edits.close();
 expect(session.root.payload.tableIndex.pages.length).toBeLessThan(session.root.payload.count);
 const applied=await applyHazardCsvImport(plan.sessionId,{currentRun:source});
 const imported=await getCodeArchitectureHazardRunById(run.id);expect(imported.generatedSheets.Summary[1][5]).toBe('Completed external hazard');expect(imported.architectureRowsSnapshot).toEqual(run.architectureRowsSnapshot);expect(imported.narrativeReviewInput).toEqual(run.narrativeReviewInput);
 const undo=await prepareHazardCsvImport({run:applied.run,undo:true});await applyHazardCsvImport(undo.sessionId,{currentRun:applied.run});
 const restored=await getCodeArchitectureHazardRunById(run.id);expect(restored.generatedSheets.Summary[1][5]).toBe('');expect(restored.architectureRowsSnapshot).toEqual(run.architectureRowsSnapshot);
});

test.each([false,true])('corrupted evidence-only pages still block publication (page digest recomputed=%s)',async recompute=>{
 const run=fixture();run.architectureRowsSnapshot=[{details:'original evidence '.repeat(20000)}];
 const plan=await prepareHazardCsvImport({run,file:csv()}),edits=await openDB('xhandle-hazard-csv-imports-v1'),session=await edits.get('sessions',plan.sessionId);edits.close();
 const tablePages=new Set(session.root.payload.tableIndex.pages.map(page=>page.sequence));
 const sequence=Array.from({length:session.root.payload.count},(_,i)=>i).find(i=>!tablePages.has(i));expect(sequence).toBeDefined();
 const db=await openHazardSchema(),page=await db.get(HAZARD_CHUNKS,hazardChunkKey(session.root.payload.generation,sequence));
 const offset=page.tokens.findIndex(token=>token[0]==='text');expect(offset).toBeGreaterThanOrEqual(0);page.tokens[offset]=['text','Corrupted evidence'];if(recompute)page.digest=hazardChunkDigest(page.tokens);await db.put(HAZARD_CHUNKS,page);db.close();
 await expect(applyHazardCsvImport(plan.sessionId,{currentRun:run})).rejects.toThrow('integrity verification');await discardHazardCsvImport(plan.sessionId);
 expect(await getCodeArchitectureHazardRunById(run.id)).toBeNull();
});
test('malformed files, duplicate IDs, cancellation and concurrent saves preserve prior results',async()=>{
 const run=fixture();await saveCodeArchitectureHazardRun(run);const source=await getLatestCodeArchitectureHazardRun({projectId:run.projectId},{workingSet:true,paged:true});
 await expect(prepareHazardCsvImport({run:source,file:new Blob(['id\n"broken'])})).rejects.toThrow('Invalid CSV');
 await expect(prepareHazardCsvImport({run:source,file:new Blob([toCsvText([headers,...[1,2].map(()=>['one','Sensor','Send','Monitor','Not providing','duplicate'])])])})).rejects.toThrow('repeats');
 const pending=await prepareHazardCsvImport({run:source,file:csv()});await saveCodeArchitectureHazardRun({...run,updatedAt:'2026-01-02'});
 await expect(applyHazardCsvImport(pending.sessionId,{currentRun:source})).rejects.toThrow('changed');await discardHazardCsvImport(pending.sessionId);
 const controller=new AbortController();controller.abort();await expect(prepareHazardCsvImport({run:source,file:csv(),signal:controller.signal})).rejects.toBeTruthy();
 expect((await getCodeArchitectureHazardRunById(run.id)).generatedSheets.Summary[1][5]).toBe('');
});

test('cancellation during apply and a disk-write failure never replace committed results',async()=>{
 const run=fixture();await saveCodeArchitectureHazardRun(run);const source=await getLatestCodeArchitectureHazardRun({projectId:run.projectId},{workingSet:true,paged:true});
 const first=await prepareHazardCsvImport({run:source,file:csv()}),controller=new AbortController();
 await expect(applyHazardCsvImport(first.sessionId,{currentRun:source,signal:controller.signal,onProgress:progress=>{if(progress.phase==='Saving imported results')controller.abort();}})).rejects.toHaveProperty('name','AbortError');
 await discardHazardCsvImport(first.sessionId);
 const second=await prepareHazardCsvImport({run:source,file:csv()});const original=IDBObjectStore.prototype.put;
 const failure=jest.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(...args){if(this.name==='hazardRunChunks')throw new DOMException('Synthetic disk full','QuotaExceededError');return original.apply(this,args);});
 try{await expect(applyHazardCsvImport(second.sessionId,{currentRun:source})).rejects.toHaveProperty('name','QuotaExceededError');}finally{failure.mockRestore();await discardHazardCsvImport(second.sessionId);}
 expect((await getCodeArchitectureHazardRunById(run.id)).generatedSheets.Summary[1][5]).toBe('');
});

test('missing IDs match unique context while ambiguous interfaces block all publication',async()=>{
 const run=fixture();run.generatedSheets.Summary=[['Raw Analysis Row ID','Function (From)','Control Action','Function (To)','Guide Phrase','Operational Context ID','Operational Scenario','Operational Mode','Operating Conditions','Hazard'],
 ['one','A','B','C','Late','one-context','Scenario','Mode','Conditions',''],['two','A','B','C','Late','two-context','Other','Mode','Conditions','']];
 const file=new Blob([toCsvText([run.generatedSheets.Summary[0],['external','A','B','C','Late','two-context','Other','Mode','Conditions','Completed']])]);
 const plan=await prepareHazardCsvImport({run,file});expect(plan.identityMatchedRowCount).toBe(1);await applyHazardCsvImport(plan.sessionId,{currentRun:run});
 const saved=await getCodeArchitectureHazardRunById(run.id);expect(saved.generatedSheets.Summary[2][9]).toBe('Completed');expect(saved.generatedSheets.Summary[1][9]).toBe('');
 const source=await getLatestCodeArchitectureHazardRun({projectId:run.projectId},{workingSet:true,paged:true});
 const ambiguous=new Blob(['Function (From),Control Action,Function (To),Guide Phrase,Hazard\nA,B,C,Late,Ambiguous']);
 await expect(prepareHazardCsvImport({run:source,file:ambiguous})).rejects.toThrow('multiple rows');
 expect((await getCodeArchitectureHazardRunById(run.id)).generatedSheets.Summary[2][9]).toBe('Completed');
});

// Export and import must agree on legacy IDs even across page/batch boundaries.
test.each(['missing','blank'])('legacy %s IDs survive export, import, reopen and exact Undo',async mode=>{
 const run=fixture();
 run.generatedSheets.Summary=[headers,...Array.from({length:205},(_,i)=>[mode==='blank'&&i%2===0?'kept-'+i:'','Sensor '+i,'Send','Monitor','Not providing',i===204?'  original spaces  ':'','','',i===203?'Needs Review':''])];
 if(mode==='missing')run.generatedSheets.Summary=run.generatedSheets.Summary.map(row=>row.slice(1));
 run.architectureRowsSnapshot=['original evidence '.repeat(10000)];
 await saveCodeArchitectureHazardRun(run);
 const source=await getLatestCodeArchitectureHazardRun({projectId:run.projectId,repoId:run.repoId},{workingSet:true,paged:true});
 const exported=[];
 for(let offset=0;offset<205;){const page=await queryHazardRows(source,{offset,limit:100});if(!exported.length)exported.push(page.headers);exported.push(...page.rows);offset=page.nextOffset;}
 const ids=exported.slice(1).map(row=>row[exported[0].indexOf('Raw Analysis Row ID')]);
 const edited=exported.map(row=>[...row]);edited[205][edited[0].indexOf('Hazard')]='Completed external result';
 const plan=await prepareHazardCsvImport({run:source,file:new Blob([toCsvText(edited)])});
 const applied=await applyHazardCsvImport(plan.sessionId,{currentRun:source});
 const saved=await getCodeArchitectureHazardRunById(run.id);
 expect(saved.generatedSheets.Summary.slice(1).map(row=>row[saved.generatedSheets.Summary[0].indexOf('Raw Analysis Row ID')])).toEqual(ids);
 expect(saved.generatedSheets.Summary[205][saved.generatedSheets.Summary[0].indexOf('Hazard')]).toBe('Completed external result');
 expect(saved.architectureRowsSnapshot).toEqual(run.architectureRowsSnapshot);
 const undo=await prepareHazardCsvImport({run:applied.run,undo:true});await applyHazardCsvImport(undo.sessionId,{currentRun:applied.run});
 const restored=await getCodeArchitectureHazardRunById(run.id);
 expect(restored.generatedSheets.Summary).toEqual(run.generatedSheets.Summary);
 expect(restored.userPreprocessing).toEqual(run.userPreprocessing);
});

test.each([false,true])('streaming context assignment matches the previous policy (ambiguous=%s)',async ambiguous=>{
 const run=fixture(),contexts=[{id:'ctx-1',scenario:'Urban operation',mode:'Autonomous',conditions:'Dry'}];
 if(ambiguous)contexts.push({id:'ctx-2',scenario:'Highway',mode:'Manual'});
 run.operationalContexts=contexts;
 run.generatedSheets.Summary[0]=[...run.generatedSheets.Summary[0]];
 run.generatedSheets.Summary[0].push('Operational Context ID','Operational Scenario','Operational Mode');
 run.generatedSheets.Summary.slice(1).forEach(row=>row.push('context-unspecified','Unspecified scenario','Unspecified mode'));
 const plan=await prepareHazardCsvImport({run,file:csv(),operationalContexts:contexts});await applyHazardCsvImport(plan.sessionId,{currentRun:run,operationalContexts:contexts});
 const saved=await getCodeArchitectureHazardRunById(run.id);
 const expected=assignImportedHazardContext({...saved,generatedSheets:{Summary:[run.generatedSheets.Summary[0],...saved.generatedSheets.Summary.slice(1).map((row,i)=>{const copy=row.slice(0,run.generatedSheets.Summary[0].length);for(const field of ['Operational Context ID','Operational Scenario','Operational Mode']){const column=run.generatedSheets.Summary[0].indexOf(field);copy[column]=run.generatedSheets.Summary[i+1][column];}return copy;})]}},contexts);
 expect(saved.generatedSheets.Summary).toEqual(expected.generatedSheets.Summary);
 if(ambiguous)expect(saved.userPreprocessingConflicts).toEqual([]);
 else{
  expect(saved.userPreprocessing.one.basis['Operational Scenario']).toBe('Unspecified scenario');
  expect(saved.userPreprocessing.one.context['Operational Context ID']).toBe('ctx-1');
  expect(saved.userPreprocessingConflicts).toContain('one: Operational context changed; imported assessments require review.');
 }
});

test('changed configured contexts reject Apply without publishing; new scenario requires review',async()=>{
 const run=fixture(),contexts=[{id:'ctx-1',scenario:'Urban',mode:'Autonomous'}];
 run.operationalContexts=contexts;
 run.generatedSheets.Summary[0]=[...run.generatedSheets.Summary[0]];
 run.generatedSheets.Summary[0].push('Operational Context ID','Operational Scenario','Operational Mode');
 run.generatedSheets.Summary.slice(1).forEach(row=>row.push('ctx-1','Old scenario','Autonomous'));
 const plan=await prepareHazardCsvImport({run,file:csv(),operationalContexts:contexts});
 await expect(applyHazardCsvImport(plan.sessionId,{currentRun:run,operationalContexts:[{...contexts[0],scenario:'Changed while pending'}]})).rejects.toThrow('contexts changed');
 expect(await getCodeArchitectureHazardRunById(run.id)).toBeNull();
 await applyHazardCsvImport(plan.sessionId,{currentRun:run,operationalContexts:contexts});
 const saved=await getCodeArchitectureHazardRunById(run.id);
 expect(saved.generatedSheets.Summary[1][saved.generatedSheets.Summary[0].indexOf('Operational Scenario')]).toBe('Urban');
 expect(saved.userPreprocessing.one.basis['Operational Scenario']).toBe('Old scenario');
 expect(saved.userPreprocessingConflicts).toHaveLength(1);
});

test('Undo restores every cell verbatim, including status and whitespace, then clears its snapshot',async()=>{
 const run=fixture();run.generatedSheets.Summary[1][8]='';run.generatedSheets.Summary[2][8]='Needs Review';run.generatedSheets.Summary[2][5]='  original spaces  ';
 const plan=await prepareHazardCsvImport({run,file:csv()});const applied=await applyHazardCsvImport(plan.sessionId,{currentRun:run});
 const undo=await prepareHazardCsvImport({run:applied.run,undo:true});await applyHazardCsvImport(undo.sessionId,{currentRun:applied.run});
 const restored=await getCodeArchitectureHazardRunById(run.id);
 expect(restored.generatedSheets.Summary).toEqual(run.generatedSheets.Summary);
 expect(restored.userPreprocessing).toEqual(run.userPreprocessing);
 expect(restored.csvImportPreviousSummary).toBeNull();expect(restored.csvImportPreviousPreprocessing).toBeNull();
});

test('importing the same completed CSV again proposes no changes and preserves its Undo snapshot',async()=>{
 const run=fixture(),file=csv();const plan=await prepareHazardCsvImport({run,file});
 const applied=await applyHazardCsvImport(plan.sessionId,{currentRun:run});
 const first=await getCodeArchitectureHazardRunById(run.id);
 const repeated=await prepareHazardCsvImport({run:applied.run,file});
 expect(repeated.changedRowCount).toBe(0);expect(repeated.changedColumns).toEqual([]);
 await discardHazardCsvImport(repeated.sessionId);
 const stillSaved=await getCodeArchitectureHazardRunById(run.id);
 expect(stillSaved.generatedSheets.Summary).toEqual(first.generatedSheets.Summary);
 expect(stillSaved.csvImportPreviousSummary).toEqual(run.generatedSheets.Summary);
});
