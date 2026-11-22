import {withGeneratedCaseFamilies,relatedGeneratedContext,groupRelatedCorrections} from './generatedSiblingContext';
import {resultsFirstPrompt,generateFastHazards} from './resultsFirstHazardPipeline';
import {semanticReviewPrompt} from './fastHazardSemanticReview';
import {answer} from './fastHazardTestFixtures';
const a={id:'A',from:'Thermal controller',action:'Request heater isolation',to:'Isolation gate',context:{mode:'Heating'}};
const b={...a,id:'B',phrase:'Wrong order'};
const unrelated={...a,id:'C',context:{mode:'Maintenance'}};
const results=new Map([['A',{applicable:'Yes',uca:'Isolation request arrives before the current trip decision.',causalScenario:'Early delivery before the decision.'}],['B',{applicable:'Yes',uca:'Isolation request precedes the current trip decision.',causalScenario:'The call order is swapped.'}],['C',{applicable:'Yes',uca:'Unrelated maintenance case.'}]]);
test('split batches retain complete related UCA/scenario cases without unrelated contexts or source mutation',()=>{
 const input={repository:'Thermal bench'},before=JSON.stringify([input,a,b,unrelated]);
 const context=withGeneratedCaseFamilies(input,[a,b,unrelated],results);
 const projected=relatedGeneratedContext(context,[a]);
 expect(projected.relatedGuidePhraseCases.map(row=>row.id)).toEqual(['A','B']);
 expect(projected.relatedGuidePhraseCases[1].causalScenario).toBe(results.get('B').causalScenario);
 expect(projected.generatedCaseFamilies).toBeUndefined();
 expect(projected.relatedCaseFieldCoverage).toEqual(['id','phrase','applicable','uca','causalScenario']);
 expect(projected.relatedCaseFieldCoverage).not.toContain('verification');
 expect(JSON.stringify([input,a,b,unrelated])).toBe(before);
});
test('small-source STPA generation sees each complete phrase family before splitting at an arbitrary row count',async()=>{
 const keys=['xhandle.aiProvider.active','xhandle.aiProviderModel.anthropic'];
 const prior=keys.map(key=>localStorage.getItem(key));
 localStorage.setItem(keys[0],'anthropic');localStorage.setItem(keys[1],'claude-sonnet-5-5');
 try {
  const sources=['A','B'].flatMap(prefix=>Array.from({length:7},(_,index)=>({id:prefix+index,from:prefix,action:'Apply torque',to:'Actuator',reviewedApplicability:'Yes',reviewedRationale:'Reviewed source timing.'})));
  const generated=[];
  const request=jest.fn(async prompt=>{
   if(prompt.startsWith('Review the semantic consistency'))return JSON.parse(prompt.split('\nAssessments: ')[1]).map(row=>({id:row.source.id,issues:[]}));
   const rows=JSON.parse(prompt.split('\nRows: ')[1]);generated.push(rows.map(row=>row.id));return rows.map(row=>answer('STPA',row.id));
  });
  const result=await generateFastHazards({method:'STPA',sources,context:{sourceBehaviorEvidence:[{fact:'A retained trip inhibits torque.',quote:'return state.trip_latched'}]},request,onDiagnostic:()=>{},onMetrics:()=>{}});
  expect(result).toHaveLength(14);
  expect(generated.map(rows=>rows.length)).toEqual([7,7]);
  expect(generated[0].every(id=>id.startsWith('A'))).toBe(true);
  expect(generated[1].every(id=>id.startsWith('B'))).toBe(true);
 } finally {keys.forEach((key,index)=>prior[index]===null?localStorage.removeItem(key):localStorage.setItem(key,prior[index]));}
});
test('correction batches keep a complete seven-phrase family together across an interleaved unrelated case',()=>{
 const family=Array.from({length:7},(_,index)=>({source:{...a,id:'F'+index}}));
 const other={source:unrelated},entries=[...family.slice(0,3),other,...family.slice(3)],before=JSON.stringify(entries);
 const batches=groupRelatedCorrections(entries);
 expect(batches.map(batch=>batch.map(entry=>entry.source.id))).toEqual([family.map(entry=>entry.source.id),['C']]);
 expect(JSON.stringify(entries)).toBe(before);
});
test('production correction and review prompts receive sibling cases as generated output, without leaking the full index',()=>{
 const context=withGeneratedCaseFamilies({},[a,b,unrelated],results);
 for(const prompt of [resultsFirstPrompt('STPA',[a],context),semanticReviewPrompt('STPA',[{source:a,assessment:results.get('A')}],context)]) {
  expect(prompt).toContain('The call order is swapped.');
  expect(prompt).not.toContain('Unrelated maintenance case.');
  expect(prompt).not.toContain('generatedCaseFamilies');
 }
});
