import {createReviewActionQueue, commitReviewSource, needsDurableReviewAction, saveDurableReviewAction} from './reviewSourceCommit';
const source=require('fs').readFileSync(require('path').resolve(__dirname,'ResultsReviewProvider.js'),'utf8');
const ast=require('@babel/parser').parse(source,{sourceType:'module',plugins:['jsx']});
const bodies={},nodes=[ast];
while(nodes.length){const n=nodes.pop();if(!n||typeof n!=='object')continue;
 if(n.type==='VariableDeclarator' && ['updateReviewItem','applyAction'].includes(n.id?.name))bodies[n.id.name]=source.slice(n.init.arguments[0].start,n.init.arguments[0].end);
 if(n.type==='JSXAttribute'&&n.name?.name==='onUpdateCurrentContent'){const fn=n.value.expression.alternate;bodies.drawer=source.slice(fn.start,fn.end);}
 for(const v of Object.values(n))if(Array.isArray(v))nodes.push(...v);else if(v&&typeof v==='object')nodes.push(v);
}
test('drawer edits and approval emit their immediate pre-edit content while retaining the original',async()=>{
 const originalContent={row:['HA-1','original'],rowIndex:0};
 let items=[{id:'review',originalContent,currentContent:originalContent}];
 const dispatchReviewEvent=jest.fn();
 const reviewItemsRef={get current(){return items;}};
 const deps={needsDurableReviewAction,saveDurableReviewAction,reviewItemsRef,reviewActionQueue:createReviewActionQueue(),commitReviewSource,readOnly:false,getReviewItemById:id=>items.find(item=>item.id===id),persist:async change=>{items=change(items);},dispatchReviewEvent,createHistoryEntry:()=>({})};
 const compile=(body,scope)=>Function(...Object.keys(scope),`return (${body})`)(...Object.values(scope));
 const updateReviewItem=compile(bodies.updateReviewItem,deps),applyAction=compile(bodies.applyAction,deps);
 const drawer=compile(bodies.drawer,{updateReviewItem});
 const first={row:['HA-1','first'],rowIndex:0},second={row:['HA-1','second'],rowIndex:0},approved={row:['HA-1','approved'],rowIndex:0};
 await drawer('review',first);await drawer('review',second);await applyAction('review','approve_with_modifications',{currentContent:approved});
 expect(dispatchReviewEvent).toHaveBeenCalledTimes(3);
 expect(dispatchReviewEvent.mock.calls.map(([,event])=>event.previousContent)).toEqual([originalContent,first,second]);
 expect(dispatchReviewEvent.mock.calls.map(([,event])=>event.action)).toEqual(['update_current_content','update_current_content','approve_with_modifications']);
 expect(items[0].originalContent).toBe(originalContent);expect(items[0].currentContent).toBe(approved);
});
