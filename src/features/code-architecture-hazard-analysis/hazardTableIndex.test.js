import {createHazardTableIndex,validateHazardTableIndex} from './hazardTableIndex';
import {streamValue,createValueAssembler} from '../code-architecture-transfer/archiveValueStream';
import {compactHazardRun} from './hazardWorkingSet';
import {hazardChunkDigest} from './hazardRunChunks';
test.each([1,2,7,31])('token-range index handles keys and skipped values spanning pages of %i tokens',async size=>{
 const run={id:'run',projectId:'p',repoId:'r',architectureRowsSnapshot:[{text:'evidence'}],
  narrativeReviewInput:'review',pendingAttempt:{architectureRowsSnapshot:[],narrativeReviewInput:null,pendingAttempt:{narrativeReviewInput:{x:1}},generatedSheets:{Summary:[['a'],['b']]}},
  unrelated:{architectureRowsSnapshot:['must retain']},generatedSheets:{Summary:[['ID'],['1']],Detail:[['all']]}};
 const tokens=[];for await(const token of streamValue(run))tokens.push(token);
 const pages=[],builder=createHazardTableIndex();
 for(let start=0;start<tokens.length;start+=size){const page=tokens.slice(start,start+size),seq=pages.length;pages.push(page);page.forEach((t,i)=>builder.add(t,seq,i));builder.page(seq,hazardChunkDigest(page));}
 const index=builder.finish('source-checksum');validateHazardTableIndex({digest:'source-checksum',count:pages.length,tableIndex:index});
 const assembler=createValueAssembler();for(const page of index.pages)for(const [from,to] of page.ranges)for(const token of pages[page.sequence].slice(from,to))assembler.add(token);
 const paths=[];expect(assembler.finish()).toEqual(compactHazardRun(run,paths));expect(index.paths).toEqual(paths);
});
