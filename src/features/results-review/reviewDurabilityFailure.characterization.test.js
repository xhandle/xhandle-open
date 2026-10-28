import {webcrypto} from 'crypto';
import {createReviewActionQueue, commitReviewSource, needsDurableReviewAction, saveDurableReviewAction} from './reviewSourceCommit';
const source=require('fs').readFileSync(require('path').resolve(__dirname,'ResultsReviewProvider.js'),'utf8');
const ast=require('@babel/parser').parse(source,{sourceType:'module',plugins:['jsx']});
const bodies={},nodes=[ast];
while(nodes.length){const n=nodes.pop();if(!n||typeof n!=='object')continue;
 if(n.type==='VariableDeclarator' && ['updateReviewItem','applyAction','persist'].includes(n.id?.name))bodies[n.id.name]=source.slice(n.init.arguments[0].start,n.init.arguments[0].end);
 if(n.type==='JSXAttribute'&&n.name?.name==='onUpdateCurrentContent'){const fn=n.value.expression.alternate;bodies.drawer=source.slice(fn.start,fn.end);}
 for(const v of Object.values(n))if(Array.isArray(v))nodes.push(...v);else if(v&&typeof v==='object')nodes.push(v);
}

test.each([1,2])('review persistence failure at write %s rejects and recovers after reload',async failAt=>{
 Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});
 const originalContent={row:['HA-1','original'],rowIndex:0};
 let durableReview={id:'review',artifactType:'code_architecture_hazard_summary_table',sourceRunId:'run',originalContent,currentContent:originalContent};
 const reviewItemsRef={current:[durableReview]};
 let sourceRow=originalContent.row;
 const failure=jest.fn();
 const compile=(body,scope)=>Function(...Object.keys(scope),`return (${body})`)(...Object.values(scope));
 let writes=0,receipt,sourceWrites=0;
 const persist=compile(bodies.persist,{readOnly:false,reviewItemsRef,setReviewItems:jest.fn(),persistenceWriterRef:{current:async items=>{
  if(++writes===failAt)return {ok:false,message:'disk full',failure:'quota'};
  durableReview=JSON.parse(JSON.stringify(items[0]));return {ok:true,durability:'indexeddb'};
 }},setPersistenceFailure:failure});
 const deps={needsDurableReviewAction,saveDurableReviewAction,reviewItemsRef,reviewActionQueue:createReviewActionQueue(),commitReviewSource,readOnly:false,getReviewItemById:()=>reviewItemsRef.current[0],persist,dispatchReviewEvent:jest.fn(),createHistoryEntry:()=>({})};
 const update=compile(bodies.updateReviewItem,deps);
 const listener=event=>{
  const {previousContent,reviewItem,accept,operationId}=event.detail;
  if(receipt===operationId){accept(Promise.resolve());return;}
  if(JSON.stringify(previousContent.row)!==JSON.stringify(sourceRow))accept(Promise.reject(Error('The reviewed row no longer exists. Reload the review.')));
  else {sourceWrites++;receipt=operationId;sourceRow=reviewItem.currentContent.row;accept(Promise.resolve());}
 };
 window.addEventListener('xhandle:results-review:apply-source',listener);
 try {
  const updates={currentContent:{row:['HA-1','edit'],rowIndex:0}};
  await expect(update('review',updates,'update_current_content')).rejects.toThrow('disk full');
  expect(failure).toHaveBeenCalled();
  expect(sourceRow[1]).toBe(failAt===1?'original':'edit');
  expect(durableReview.currentContent.row[1]).toBe('original');
  expect(deps.dispatchReviewEvent).not.toHaveBeenCalled();
  reviewItemsRef.current=[durableReview];
  await expect(update('review',updates,'update_current_content')).resolves.toMatchObject({pendingSourceCommit:null});
  expect(sourceWrites).toBe(1);
  expect(durableReview.currentContent.row[1]).toBe('edit');
  expect(durableReview.originalContent.row[1]).toBe('original');
 }finally{window.removeEventListener('xhandle:results-review:apply-source',listener);}
});
