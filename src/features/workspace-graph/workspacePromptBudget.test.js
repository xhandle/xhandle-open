import { fitWorkspacePromptSample, deduplicateWorkspacePromptSample } from './workspacePromptBudget';
import {fitWorkspaceReadEvidence} from './workspaceReadSession';

test('fits whole records and preserves a resolvable citation for every supplied artifact', () => {
  const artifacts=Array.from({length:36},(_,i)=>({id:'hazard-'+i,type:'code_architecture_hazard_row',summary:'s'.repeat(900),structuredDataSnippet:'x'.repeat(2200)}));
  const citations=artifacts.map(row=>({artifactId:row.id,title:row.id,sourceId:'run:summary:'+row.id}));
  const result=fitWorkspacePromptSample({relevantArtifacts:artifacts,citations,diagnostics:{huge:'x'.repeat(50000)}},14000);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(14000);
  expect(result.relevantArtifacts.length).toBeGreaterThan(0);
  expect(result.coverage.omittedRecords).toBeGreaterThan(0);
  for(const row of result.relevantArtifacts){
    expect(row.structuredDataSnippet).toHaveLength(2200);
    expect(result.citations.find(c=>c.artifactId===row.id)).toEqual(citations.find(c=>c.artifactId===row.id));
  }
});

test('a source missing citation metadata still has a source link and unrelated relationships are omitted',()=>{
  const result=fitWorkspacePromptSample({relevantArtifacts:[{id:'r',title:'Requirement'}],relationships:[{fromArtifactId:'other',toArtifactId:'else'}]},1000);
  expect(result.citations).toEqual([expect.objectContaining({artifactId:'r',title:'Requirement'})]);
  expect(result.relationships).toEqual([]);
});

test('only removes evidence present after the targeted read budget is applied',()=>{
 const row={id:'r',projectId:'p',title:'Record',updatedAt:'v1',content:'Evidence'};
 const citation={artifactId:'r',projectId:'p',title:'Record',sourceKey:'source:r'};
 const sample=fitWorkspacePromptSample({relevantArtifacts:[row],citations:[citation]},14000);
 const evidence={results:[{operation:'read',rows:[row],citations:[citation],coverage:{complete:false,state:'partial'}}]};
 const fitted=fitWorkspaceReadEvidence(evidence);
 const compact=deduplicateWorkspacePromptSample(sample,fitted);
 expect(compact.relevantArtifacts).toEqual([]);expect(compact.citations).toEqual([]);
 expect(compact.coverage).toEqual(sample.coverage);expect(fitted.results[0].coverage).toEqual(evidence.results[0].coverage);
 expect(sample.relevantArtifacts).toEqual([row]);
 const tooLarge={...row,extra:'x'.repeat(25000)};
 const omitted=fitWorkspaceReadEvidence({results:[{...evidence.results[0],rows:[tooLarge]}]});
 expect(omitted.results[0].rows).toEqual([]);
 expect(deduplicateWorkspacePromptSample(sample,omitted).relevantArtifacts).toEqual([row]);
});
test.each([
 {id:'r',projectId:'other',content:'Evidence',updatedAt:'v1'},
 {id:'r',projectId:'p',content:'Evidence',updatedAt:'v2'},
 {id:'r',projectId:'p',content:'Changed',updatedAt:'v1'},
 {id:'r',projectId:'p',updatedAt:'v1'},
])('keeps unique fields, conflicting revisions and different project evidence: %j',other=>{
 const row={id:'r',projectId:'p',content:'Evidence',updatedAt:'v1'};
 expect(deduplicateWorkspacePromptSample({relevantArtifacts:[row]},{results:[{rows:[other]}]}).relevantArtifacts).toEqual([row]);
});
test('keeps unique citation metadata and removes an overview only when its full evidence survived fitting',()=>{
 const overview={rows:[{from:'SENSOR',to:'BRAKE'}],sources:[{sourceKey:'saved'}],reason:'Partial sample'};
 const citation={artifactId:'r',projectId:'p',title:'Title',sourceKey:'unique-source'};
 const sample={diagnostics:{overview,migrationError:'Index incomplete'},citations:[citation]};
 const evidence={results:[{operation:'overview',excerpt:{text:JSON.stringify(overview)},citations:[{artifactId:'r',projectId:'p',title:'Title'}]}]};
 const compact=deduplicateWorkspacePromptSample(sample,fitWorkspaceReadEvidence(evidence));
 expect(compact.diagnostics).toEqual({migrationError:'Index incomplete'});expect(compact.citations).toEqual([citation]);
 expect(sample.diagnostics.overview).toBe(overview);
 const large={rows:[{from:'x'.repeat(12000)}]};
 const truncated=fitWorkspaceReadEvidence({results:[{operation:'overview',excerpt:{text:JSON.stringify(large)}}]});
 expect(deduplicateWorkspacePromptSample({diagnostics:{overview:large}},truncated).diagnostics.overview).toBe(large);
});
test('checks source revisions even when prompt projections omit revision fields',()=>{
 const projected={id:'r',projectId:'p',title:'Same title'};
 const sample={relevantArtifacts:[projected]};
 const fitted={results:[{rows:[{...projected,version:2}]}]};
 expect(deduplicateWorkspacePromptSample(sample,fitted,{originalRows:[{...projected,version:1}]}).relevantArtifacts).toEqual([projected]);
 expect(deduplicateWorkspacePromptSample(sample,fitted,{originalRows:[{...projected,version:2}]}).relevantArtifacts).toEqual([]);
});
