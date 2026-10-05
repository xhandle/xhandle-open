import { createRunGuard, settingsFromAuth, stableJson, assertStorageBudget } from './codeAnalysisRun';
it('does not fingerprint credentials and notices active preference changes',()=>{
 let model='one'; const guard=createRunGuard(()=>settingsFromAuth({headers:{'x-ai-provider':'openai','x-ai-model':model,'x-ai-api-key':'secret'}}));
 expect(stableJson(guard.settings)).not.toContain('secret'); model='two'; expect(()=>guard.check()).toThrow('settings changed');
});
it('rejects mixed response models and unverified provenance',()=>{
 const guard=createRunGuard(()=>({})); const response=model=>({headers:{get:k=>({'X-AI-Provider-Used':'openai','X-AI-Model-Used':model}[k])}});
 guard.observe(response('one')); expect(()=>guard.observe(response('two'))).toThrow('differ');
 expect(()=>createRunGuard(()=>({})).observe({})).toThrow('did not identify');
});
it('fails before exceeding the budget and preserves stable serialization',()=>{
 expect(()=>assertStorageBudget(11,10)).toThrow('previous results');
 expect(stableJson({b:2,a:1})).toBe(stableJson({a:1,b:2}));
});
it('rejects a response that uses a different requested effort', () => {
 const guard = createRunGuard(() => ({provider:'openai',model:'fixture',effort:'high'}));
 const response = {headers:{get:key=>({'X-AI-Provider-Used':'openai','X-AI-Model-Used':'fixture','X-AI-Effort-Used':'low'}[key])}};
 expect(() => guard.observe(response)).toThrow('differ');
 expect(() => guard.check()).toThrow('differ');
});
it('records the automatic recovery policy and both output capacities in run identity', () => {
 const settings=settingsFromAuth();
 expect(settings).toMatchObject({maxTokens:4096,recoveryMaxTokens:8192,recoveryPolicy:'automatic-sections-v2'});
});
