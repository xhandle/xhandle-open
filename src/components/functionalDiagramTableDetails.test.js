import { applyTableContainerDetails, rowsWithDiagramDetails, editFunctionalEntityDetails } from './functionalDiagramTableDetails';
const boxes=[{id:'sys',elementType:'system',label:'Vehicle',description:'Vehicle description',descriptionUserEdited:true},
  {id:'sub',parentNode:'sys',label:'Planning',description:'Planning description',descriptionUserEdited:true}];
const nodes=[{id:'f',parentNode:'sub',data:{label:'Plan',description:'Plan description'}},
  {id:'t',data:{label:'Act',description:'Act description'}}];
const rows=[{system:'Vehicle',subsystem:'Planning',fromFunction:'Plan',fromDetails:'Plan description',toFunction:'Act',toDetails:'Act description'},
  {system:'',subsystem:'',fromFunction:'Act',fromDetails:'',toFunction:'Plan',toDetails:'Outdated plan'}];

test('fills container details and consistent function descriptions without replacing labels or unrelated columns',()=>{
 const next=rowsWithDiagramDetails(rows,nodes,boxes);
 expect(next[0]).toEqual({...rows[0],systemDetails:'Vehicle description',subsystemDetails:'Planning description'});
 expect(next[1]).toEqual({...rows[1],fromDetails:'Act description',toDetails:'Plan description'});
 expect(rowsWithDiagramDetails(next,nodes,boxes)).toBe(next);
});

test('table changes override saved container text; initial saved diagram descriptions backfill stale table values',()=>{
 const previous=[{...rows[0],systemDetails:'Old system',subsystemDetails:'Old subsystem'}];
 expect(applyTableContainerDetails(boxes,previous,null)).toBe(boxes);
 const next=[{...previous[0],subsystemDetails:'New subsystem'}];
 expect(applyTableContainerDetails(boxes,next,previous)[1].description).toBe('New subsystem');
 expect(applyTableContainerDetails(boxes,[{...previous[0],subsystemDetails:''}],previous)[1].description).toBe('');
 const fresh=boxes.map(box=>({...box,descriptionUserEdited:false}));
 expect(applyTableContainerDetails(fresh,previous,null)[0].description).toBe('Old system');
});

test('editing a function description updates source and receiver occurrences including self-loops',()=>{
 const input=[...rows,{fromFunction:'Plan',toFunction:'Plan',fromDetails:'Old',toDetails:'Old'}];
 const next=editFunctionalEntityDetails(input,0,'fromDetails','Updated');
 expect(next[0].fromDetails).toBe('Updated');
 expect(next[1].toDetails).toBe('Updated');
 expect(next[2]).toMatchObject({fromDetails:'Updated',toDetails:'Updated'});
 expect(next[0].toDetails).toBe('Act description');
});

test('subsystem detail edits stay scoped to their system',()=>{
 const input=[rows[0],{...rows[0],system:'Other'}];
 expect(editFunctionalEntityDetails(input,0,'subsystemDetails','Updated')).toEqual([{...rows[0],subsystemDetails:'Updated'},input[1]]);
});
