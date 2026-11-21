import { createHash } from 'crypto';
import { discoverAppendIntegration, integrationFileDescriptor, integrationLexicon } from './appendIntegration';
const hash=async text=>createHash('sha256').update(text).digest('hex');
function record(path,content,functions){return {path,content,sourceFunctions:functions.map(([functionName,startLine,endLine])=>({functionName,startLine,endLine}))};}
async function fixture(records, earlier, provider, state={}){
 const descriptors=await Promise.all(records.map(async item=>integrationFileDescriptor(item,earlier.includes(item.path)?'earlier':'new',await hash(item.content))));
 const request=jest.fn(async prompt=>provider(JSON.parse(prompt.split('Append integration input: ')[1])));
 const onCheckpoint=jest.fn(async()=>{});
 const result=await discoverAppendIntegration({descriptors,loadRecord:async path=>records.find(record=>record.path===path),request,digestText:hash,state,onCheckpoint});
 return {result,state,request,onCheckpoint,descriptors};
}
function proposal(input, {from,line,kind='call',key='',via=[]}){
 const source=input.source.units.find(unit=>unit.symbol===from);if(!source)return {relationships:[],unresolved:[]};
 const target=input.target,definition=target.frames.find(frame=>frame.line===target.startLine);
 if(!definition)return {relationships:[],unresolved:[]};
 const lines=input.source.window.text.split('\n'),index=line-input.source.window.startLine;
 if(index<0||index>=lines.length)return {relationships:[],unresolved:[]};
 return {relationships:[{fromId:source.id,toId:target.id,action:'Send requested input',description:'Evidence-grounded transfer.',kind,key,
  fromCitation:{line,quote:lines[index]},toCitation:{line:definition.line,quote:definition.quote},via}],unresolved:[]};
}

test('comments and bare identical names do not create cross-language links',async()=>{
 expect(integrationLexicon('// fake()\nconst s="channel";\nrun();','a.js').identifiers.has('fake')).toBe(false);
 const records=[record('a.js','function start() { nativeRun(); }',[['start',1,1]]),record('b.c','int nativeRun() { return 0; }',[['nativeRun',1,1]])];
 const {result}=await fixture(records,[records[0].path],input=>proposal(input,{from:'start',line:1}));
 expect(result.rows).toHaveLength(0);expect(result.coverage.rejectedProposals).toBeGreaterThan(0);
 const commented=[record('a.js','// nativeRun();\nfunction start() {}',[['start',2,2]]),records[1]];
 const noCalls=await fixture(commented,['a.js'],()=>{throw Error('Comment should not trigger a request');});expect(noCalls.request).not.toHaveBeenCalled();
});

test('ambiguous symbols remain unresolved; an exact import and alias resolves only the intended file',async()=>{
 const a=record('a.js','function start() { work(); }',[['start',1,1]]);
 const targets=[record('b.js','function work() {}',[['work',1,1]]),record('c.js','function work() {}',[['work',1,1]])];
 const ambiguous=await fixture([a,...targets],['a.js'],()=>{throw Error('Ambiguous target should not be guessed');});
 expect(ambiguous.request).not.toHaveBeenCalled();expect(ambiguous.result.coverage.unresolvedCandidates).toBe(1);
 const imported=record('a.js','import { work as execute } from "./b.js";\nfunction start() { execute(); }',[['start',2,2]]);
 const linked=await fixture([imported,...targets],['a.js'],input=>proposal(input,{from:'start',line:2,key:'execute',via:[{file:'a.js',line:1,quote:'import { work as execute } from "./b.js";'}]}));
 expect(linked.result.rows).toHaveLength(1);expect(linked.result.rows[0].toFile).toBe('b.js');
});

test('shared channels require actual producer and handler registration evidence',async()=>{
 const records=[record('publisher.js','function produce(v) {\n bus.emit("status", v);\n}',[['produce',1,3]]),
  record('receiver.js','function receive(v) { save(v); }\nbus.on("status", receive);',[['receive',1,1]])];
 const {result}=await fixture(records,['publisher.js'],input=>proposal(input,{from:'produce',line:2,kind:'message',key:'status',via:[{file:'receiver.js',line:2,quote:'bus.on("status", receive);'}]}));
 expect(result.rows).toHaveLength(1);expect(result.rows[0]).toMatchObject({from:'produce',to:'receive',integrationEvidence:{kind:'message',key:'status',reviewRequired:true}});
 const invalid=await fixture(records,['publisher.js'],input=>proposal(input,{from:'produce',line:1,kind:'message',key:'status',via:[{file:'receiver.js',line:2,quote:'bus.on("status", receive);'}]}));
 expect(invalid.result.rows).toHaveLength(0);
});

test('callback registration links the actual handler without claiming a direct call',async()=>{
 const records=[record('register.js','import { handler } from "./handler.js";\nfunction setup() { register("ready", handler); }',[['setup',2,2]]),record('handler.js','function handler(v) { save(v); }',[['handler',1,1]])];
 const {result}=await fixture(records,['register.js'],input=>proposal(input,{from:'setup',line:2,kind:'callback',key:'handler',via:[{file:'register.js',line:1,quote:records[0].content.split('\n')[0]},{file:'register.js',line:2,quote:records[0].content.split('\n')[1]}]}));
 expect(result.rows).toHaveLength(1);expect(result.rows[0].integrationEvidence.kind).toBe('callback');
});

test('cached responses are revalidated and successful requests are not repeated',async()=>{
 const records=[record('a.c','int start() { return work(); }',[['start',1,1]]),record('b.c','int work() { return 0; }',[['work',1,1]])];
 const initial=await fixture(records,[records[0].path],input=>proposal(input,{from:'start',line:1}));
 const loaded=JSON.parse(JSON.stringify(initial.state));
 const second=await fixture(records,[records[0].path],()=>{throw Error('Completed work must resume');},loaded);
 expect(second.request).not.toHaveBeenCalled();expect(second.result.rows).toEqual(initial.result.rows);
 Object.values(loaded.completed)[0].response.relationships[0].fromCitation.quote='invented';
 const corrupt=await fixture(records,[records[0].path],()=>{throw Error('Revalidate cached evidence');},loaded);
 expect(corrupt.result.rows).toHaveLength(0);expect(corrupt.result.coverage.rejectedProposals).toBeGreaterThan(0);
});

test('later source sections and import context are checked without truncating a long file',async()=>{
 const padding='// unrelated padding\n'.repeat(700);
 const a=record('a.js','import { work as execute } from "./b.js";\nfunction start() {\n'+padding+' execute();\n}',[['start',2,704]]);
 const b=record('b.js','function work() {}',[['work',1,1]]);
 const {result,request}=await fixture([a,b],['a.js'],input=>proposal(input,{from:'start',line:703,key:'execute',via:[{file:'a.js',line:1,quote:'import { work as execute } from "./b.js";'}]}));
 expect(request.mock.calls.length).toBeGreaterThan(1);expect(result.rows).toHaveLength(1);
 expect(request.mock.calls.every(([prompt])=>prompt.length<30000)).toBe(true);
});

test('empty unrelated files require no model requests and preserve truthful coverage',async()=>{
 const {result,request}=await fixture([record('a.c','// empty',[]),record('b.js','function independent() {}',[['independent',1,1]])],['a.c'],()=>{throw Error('No candidates');});
 expect(request).not.toHaveBeenCalled();expect(result.coverage).toMatchObject({files:2,earlierFiles:1,newFiles:1,acceptedRelationships:0,reviewedSections:0});
});


test('a shared channel can connect multiple explicitly registered handlers',async()=>{
 const records=[record('pub.js','function produce(v) { bus.emit("status", v); }',[['produce',1,1]]),
 record('one.js','function first(v) {}\nbus.on("status", first);',[['first',1,1]]),
 record('two.js','function second(v) {}\nbus.on("status", second);',[['second',1,1]])];
 const {result}=await fixture(records,['pub.js'],input=>proposal(input,{from:'produce',line:1,kind:'message',key:'status',via:[{file:input.target.file,line:2,quote:records.find(record=>record.path===input.target.file).content.split('\n')[1]}]}));
 expect(result.rows.map(row=>row.to).sort()).toEqual(['first','second']);
});

test('Python relative imports resolve exact aliased endpoints',async()=>{
 const records=[record('pkg/a.py','from .b import work as execute\ndef start():\n    execute()',[['start',2,3]]),record('pkg/b.py','def work():\n    pass',[['work',1,2]])];
 const {result}=await fixture(records,['pkg/a.py'],input=>proposal(input,{from:'start',line:3,key:'execute',via:[{file:'pkg/a.py',line:1,quote:'from .b import work as execute'}]}));
 expect(result.rows).toHaveLength(1);expect(result.rows[0].toFile).toBe('pkg/b.py');
});

test('a namespace import resolves its member, while an unrelated receiver stays unresolved',async()=>{
 const b=record('b.js','function work() {}',[['work',1,1]]);
 const a=record('a.js','import * as remote from "./b.js";\nfunction start() { remote.work(); }',[['start',2,2]]);
 const {result}=await fixture([a,b],['a.js'],input=>proposal(input,{from:'start',line:2,via:[{file:'a.js',line:1,quote:a.content.split('\n')[0]}]}));
 expect(result.rows).toHaveLength(1);
 const unknown=record('a.js','function start() { unknown.work(); }',[['start',1,1]]);
 const negative=await fixture([unknown,b],['a.js'],input=>proposal(input,{from:'start',line:1}));expect(negative.result.rows).toHaveLength(0);
});

test('HTTP request and route registration connect through the exact route key',async()=>{
 const records=[record('client.js','function load() { return fetch("/status"); }',[['load',1,1]]),
 record('server.js','function status(req,res) { res.send("ok"); }\napp.get("/status", status);',[['status',1,1]])];
 const {result}=await fixture(records,['server.js'],input=>proposal(input,{from:'load',line:1,kind:'message',key:'/status',via:[{file:'server.js',line:2,quote:'app.get("/status", status);'}]}));
 expect(result.rows).toHaveLength(1);expect(result.rows[0]).toMatchObject({from:'load',to:'status',integrationEvidence:{key:'/status'}});
});

test('regex and plain template text cannot masquerade as calls, while interpolation calls remain visible',async()=>{
 const b=record('b.js','function work() {}',[['work',1,1]]);
 for(const expression of ['return /work()/;', 'return `work()`;']){
  const a=record('a.js','import { work } from "./b.js";\nfunction start() { '+expression+' }',[['start',2,2]]);
  const {result}=await fixture([a,b],['a.js'],input=>proposal(input,{from:'start',line:2,via:[{file:'a.js',line:1,quote:a.content.split('\n')[0]}]}));
  expect(result.rows).toHaveLength(0);
 }
 const a=record('a.js','import { work } from "./b.js";\nfunction start() { return `${work()}`; }',[['start',2,2]]);
 const {result}=await fixture([a,b],['a.js'],input=>proposal(input,{from:'start',line:2,via:[{file:'a.js',line:1,quote:a.content.split('\n')[0]}]}));
 expect(result.rows).toHaveLength(1);
});

test('local definitions and parameters cannot be mistaken for an external same-name function',async()=>{
 const b=record('b.c','int work() { return 0; }',[['work',1,1]]);
 const a=record('a.c','int work() { return 1; }\nint start() { return work(); }',[['work',1,1],['start',2,2]]);
 const first=await fixture([a,b],['a.c'],input=>proposal(input,{from:'start',line:2}));expect(first.result.rows).toHaveLength(0);
 const imported=record('a.js','import { work } from "./b.js";\nfunction start(work) { work(); }',[['start',2,2]]);
 const target=record('b.js','function work() {}',[['work',1,1]]);
 const second=await fixture([imported,target],['a.js'],input=>proposal(input,{from:'start',line:2,via:[{file:'a.js',line:1,quote:imported.content.split('\n')[0]}]}));expect(second.result.rows).toHaveLength(0);
});

test('imports escaping the repository, bare packages and unrelated path literals cannot bind a local file',async()=>{
 const b=record('b.js','function work() {}',[['work',1,1]]);
 for(const statement of ['import { work } from "../../b.js";', 'import { work } from "b.js";', 'import { work } from "external"; const unrelated="./b.js";']){
  const a=record('a.js',statement+'\nfunction start() { work(); }',[['start',2,2]]);
  const {result}=await fixture([a,b],['a.js'],input=>proposal(input,{from:'start',line:2,via:[{file:'a.js',line:1,quote:statement}]}));
  expect(result.rows).toHaveLength(0);
 }
});

test('uppercase source extensions retain their language family and exact file identity',async()=>{
 const records=[record('a.C','int start() { return work(); }',[['start',1,1]]),record('b.C','int work() { return 0; }',[['work',1,1]])];
 const {result}=await fixture(records,['a.C'],input=>proposal(input,{from:'start',line:1}));
 expect(result.rows).toHaveLength(1);expect(result.rows[0].toFile).toBe('b.C');expect(result.coverage.unsupportedDefinitionFiles).toEqual([]);
});

test('multiline import declarations retain exact alias evidence across source windows',async()=>{
 const statement='import {\n work as execute,\n} from "./b.js";';
 const padding='// padding\n'.repeat(1200);
 const a=record('a.js',statement+'\n'+padding+'function start() { execute(); }',[['start',1204,1204]]),b=record('b.js','function work() {}',[['work',1,1]]);
 const {result}=await fixture([a,b],['a.js'],input=>proposal(input,{from:'start',line:1204,key:'execute',via:[{file:'a.js',line:3,quote:'} from "./b.js";'}]}));
 expect(result.rows).toHaveLength(1);expect(result.rows[0].toFile).toBe('b.js');
});

test('a namespace alias must match the complete receiver identifier',async()=>{
 const b=record('b.js','function work() {}',[['work',1,1]]);
 const a=record('a.js','import * as remote from "./b.js";\nfunction start() { old_remote.work(remote); }',[['start',2,2]]);
 const {result}=await fixture([a,b],['a.js'],input=>proposal(input,{from:'start',line:2,via:[{file:'a.js',line:1,quote:a.content.split('\n')[0]}]}));
 expect(result.rows).toHaveLength(0);
});

test('qualified native symbols require the complete namespace identity',async()=>{
 const b=record('b.cpp','int A::work() { return 0; }',[['A::work',1,1]]);
 for(const [callee,count] of [['OtherA::work',0],['A::work',1]]){
  const a=record('a.cpp','#include "./b.cpp"\nint start() { return '+callee+'(); }',[['start',2,2]]);
  const {result}=await fixture([a,b],['a.cpp'],input=>proposal(input,{from:'start',line:2,via:[{file:'a.cpp',line:1,quote:'#include "./b.cpp"'}]}));
  expect(result.rows).toHaveLength(count);
 }
});
