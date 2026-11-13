import {checkSafetyCaseCompleteness as check,safetyCaseOverallStatus} from './safetyCaseCompleteness';
const node=(id,type='claim',extra={})=>({id,type,title:id,description:id,status:'accepted',...extra});
const titles=value=>check(value).map(item=>item.title);

test('context edges do not establish claim support, even with a parentId fallback',()=>{
 const value={nodes:[node('root'),node('ctx','context',{parentId:'root'})],edges:[{source:'root',target:'ctx',relationship:'contextualizes'}]};
 expect(titles(value)).toContain('Claim has no support');
 expect(safetyCaseOverallStatus(value)).toBe('Needs Review');
});
test('cycles terminate and are reported, including a graph without roots',()=>{
 const value={nodes:[node('a'),node('b')],edges:[{source:'a',target:'b'},{source:'b',target:'a'}]};
 expect(titles(value)).toContain('Cycle detected');
 expect(safetyCaseOverallStatus(value)).toBe('Needs Review');
});
test('deep imports do not exhaust the JavaScript call stack',()=>{
 const nodes=Array.from({length:12000},(_,i)=>node(String(i),'claim',{parentId:i?String(i-1):null}));
 expect(()=>check({nodes,edges:[]})).not.toThrow();
});
test('draft nodes and unresolved evidence cannot produce Supported',()=>{
 expect(safetyCaseOverallStatus({nodes:[node('root','claim',{status:'draft'})]})).toBe('Needs Review');
 const value={nodes:[node('root'),node('e','evidence',{parentId:'root',linkedArtifactIds:['missing']})]};
 expect(titles(value)).toContain('Evidence requires validation');
 expect(check(value,{evidenceById:new Map()}).map(f=>f.title)).toContain('Linked evidence is missing');
});
test('failing, incomplete and untraced automatic evidence invalidate assessment without rewriting acceptance',()=>{
 const value={nodes:[node('root')],evidenceAutomation:{complete:false,errors:['offline'],untracedTestCount:1,allocations:[{nodeId:'root',artifactId:'test',state:'failed'}]}};
 expect(titles(value)).toEqual(expect.arrayContaining(['Evidence collection is incomplete','Automatic evidence is failed','Tests have unresolved requirement targets']));
 expect(value.nodes[0].status).toBe('accepted');
});
