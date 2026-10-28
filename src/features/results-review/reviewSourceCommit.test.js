import {commitReviewSource,createReviewActionQueue} from './reviewSourceCommit';
const item={artifactType:'code_architecture_hazard_summary_table',currentContent:{row:['HA-1','original']}};
test('requires an active source handler and rejects malformed edits',async()=>{
 await expect(commitReviewSource(item,{row:['HA-1','edit']},'update_current_content')).rejects.toThrow('not available');
 await expect(commitReviewSource(item,{},'approve_with_modifications')).rejects.toThrow('invalid');
});
test('unrelated actions do not require a source handler',async()=>{
 expect(await commitReviewSource(item,item.currentContent,'approve_as_is')).toBe(false);
 expect(await commitReviewSource({...item,artifactType:'other'},item.currentContent,'update_current_content')).toBe(false);
});
test('propagates source failure to caller rather than announcing success',async()=>{
 const listener=event=>event.detail.accept(Promise.reject(Error('The active hazard analysis changed. Reopen the review.')));
 window.addEventListener('xhandle:results-review:apply-source',listener);
 try{await expect(commitReviewSource(item,item.currentContent,'update_current_content')).rejects.toThrow('changed');}
 finally{window.removeEventListener('xhandle:results-review:apply-source',listener);}
});
test('unrelated runs can proceed and failure does not poison a queue',async()=>{
 const queue=createReviewActionQueue();let release;
 const first=queue('a',()=>new Promise(resolve=>{release=resolve;}));
 await Promise.resolve();expect(await queue('b',()=>42)).toBe(42);
 release();await first;
 await expect(queue('a',()=>Promise.reject(Error('failure')))).rejects.toThrow('failure');
 expect(await queue('a',()=>43)).toBe(43);
});
