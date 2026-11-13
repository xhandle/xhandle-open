import {collectSafetyCaseEvidence as collect,VERIFICATION_DOCUMENTS_KEY} from './safetyCaseEvidenceSources';
import {openTraceabilityDB,createTraceabilityTransaction} from '../../components/utils/traceabilityDb';
jest.mock('../../components/utils/traceabilityDb',()=>({openTraceabilityDB:jest.fn(),createTraceabilityTransaction:jest.fn(),TRACEABILITY_STORES:{requirements:'Requirements'}}));
let rows;
beforeEach(()=>{
 localStorage.clear(); rows=[{id:'r',projectId:'p',title:'Requirement',version:1}];
 openTraceabilityDB.mockResolvedValue({});
 createTraceabilityTransaction.mockImplementation(()=>({store:{index:()=>({getAll:async()=>rows})},done:Promise.resolve()}));
});
const docs=value=>localStorage.setItem(VERIFICATION_DOCUMENTS_KEY,JSON.stringify(value));
const doc=(projectId='p',extra={})=>({id:'d',projectId,testCases:[{id:'t',requirementId:'r',status:'Pass',evidence:'log'}],...extra});
test('uses project requirements and canonical document/test IDs, without global mirrors',async()=>{
 docs([doc()]); localStorage.setItem('xhandle:vnv-center',JSON.stringify([{id:'unrelated',projectId:'p'}]));
 const result=await collect('p');
 expect(result.complete).toBe(true);
 expect(result.artifacts).toHaveLength(2);
 expect(result.artifacts.find(a=>a.type==='test_case')).toMatchObject({requirementId:'TraceabilityDB:Requirements:r',outcome:'passed'});
});
test('rejects foreign, unowned and conflicting owners, including nested tests',async()=>{
 rows.push({id:'foreign',projectId:'q'},{id:'unknown'});
 docs([doc('q'),doc(null),doc('p',{sourceProjectId:'q'}),doc('p',{testCases:[{id:'bad',projectId:'q',requirementId:'r'}]})]);
 const result=await collect('p'); expect(result.artifacts.map(a=>a.id)).toEqual(['TraceabilityDB:Requirements:r']);
});
test('does not cap an inventory at 500 and resolves distant explicit requirement targets',async()=>{
 rows=Array.from({length:651},(_,i)=>({id:'r'+i,projectId:'p',title:'R'+i}));
 docs([doc('p',{testCases:[{id:'t',requirementId:'r650',status:'Pass',evidence:'log'}]})]);
 const result=await collect('p');expect(result.artifacts).toHaveLength(652);
 expect(result.artifacts.find(a=>a.type==='test_case').requirementId).toBe('TraceabilityDB:Requirements:r650');
});
test('unreadable sources produce an incomplete snapshot; unknown targets stay untraced',async()=>{
 localStorage.setItem(VERIFICATION_DOCUMENTS_KEY,'{broken');
 expect((await collect('p')).complete).toBe(false);
 docs([doc('p',{testCases:[{id:'t',requirementId:'missing',status:'Pass',evidence:'log'}]})]);
 expect((await collect('p')).artifacts.find(a=>a.type==='test_case').requirementId).toBeNull();
 openTraceabilityDB.mockRejectedValueOnce(Error('offline'));
 expect((await collect('p')).complete).toBe(false);
});
test('duplicate stable test IDs are reported instead of silently binding to a different test',async()=>{
 docs([doc(),doc()]);expect((await collect('p')).complete).toBe(false);
});
