import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import { resolveGitHubRevision, listGitHubSnapshot, readGitHubSnapshotFile, gitBlobDigest } from './codeSourceAcquisition';
beforeAll(() => { global.crypto = webcrypto; global.TextEncoder = TextEncoder; global.TextDecoder = TextDecoder; });
afterEach(() => jest.restoreAllMocks());
const revision = 'a'.repeat(40);
it('decodes Unicode bytes identically and verifies the listed Git blob', async () => {
  const content = 'def café():\n    return "车辆"\n';
  const sha = await gitBlobDigest(new TextEncoder().encode(content));
  global.fetch = jest.fn(async () => ({ok:true,json:async()=>({encoding:'base64',content:Buffer.from(content).toString('base64')})}));
  expect((await readGitHubSnapshotFile({owner:'o',repo:'r',ref:revision,sha,path:'a.py'})).content).toBe(content);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('fails a requested ref without substituting another branch', async () => {
  global.fetch = jest.fn(async () => ({ok:false,status:404}));
  await expect(resolveGitHubRevision('o','r',null,'feature')).rejects.toThrow('selected revision was not changed');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('rejects truncated inventories and mutable read refs', async () => {
  global.fetch = jest.fn(async () => ({ok:true,json:async()=>({truncated:true,tree:[]})}));
  await expect(listGitHubSnapshot('o','r',null,revision)).rejects.toThrow('incomplete file tree');
  await expect(readGitHubSnapshotFile({ref:'main'})).rejects.toThrow('immutable');
});
it('keeps every fallback pinned and rejects mismatched bytes', async () => {
  global.fetch = jest.fn(async url => url.includes('raw.githubusercontent') ? {ok:true,arrayBuffer:async()=>new TextEncoder().encode('bad').buffer} : {ok:true,json:async()=>({encoding:'base64',content:Buffer.from('bad').toString('base64')})});
  await expect(readGitHubSnapshotFile({owner:'o',repo:'r',ref:revision,sha:'b'.repeat(40),path:'a.py'})).rejects.toThrow('does not match');
  expect(fetch.mock.calls.every(([url])=>!url.includes('/main/')&&!url.includes('/master/'))).toBe(true);
});
it('preserves exact case and entry kinds with deterministic path order', async () => {
  global.fetch = jest.fn(async()=>({ok:true,json:async()=>({tree:[{path:'a.py',type:'blob',mode:'120000'},{path:'A.py',type:'blob',mode:'100644'}]})}));
  const rows=await listGitHubSnapshot('o','r',null,revision);
  expect(rows.map(r=>r.path)).toEqual(['A.py','a.py']); expect(rows[1].entryKind).toBe('symlink');
});

it('converges fresh native-folder, FileList and GitHub blob/Contents/raw inputs with Unicode bytes', async()=>{
 const {registerLocalFolder,createLocalSourceProvider}=require('./localCodeSource');
 const {pythonRelationshipInventory,completeSupportedRelationships}=require('./codeRelationshipEvidence');
 const {classifyCodeArchitectureHazardEligibility}=require('../code-architecture-hazard-analysis/codeArchitectureHazardEligibility');
 const content='def validate_command():\n    text = "车辆 café"\ndef control_motion():\n    validate_command()\n';
 const bytes=new TextEncoder().encode(content),sha=await gitBlobDigest(bytes);
 const file={name:'Control.py',webkitRelativePath:'fixture/Control.py',size:bytes.length,arrayBuffer:async()=>bytes.buffer};
 const native={name:'fixture',async *entries(){yield ['Control.py',{kind:'file',getFile:async()=>file}];}};
 const results=[];
 for(const source of [registerLocalFolder({files:[file],sourceId:'file-test'}),registerLocalFolder({handle:native,sourceId:'native-test',rememberHandle:false})]) {
  for(let repeat=0;repeat<2;repeat++) {
   const provider=await createLocalSourceProvider(source);
   results.push(await provider.readText({path:'Control.py'}));
  }
 }
 for(const mode of ['blobs','contents','raw.githubusercontent']) {
  for(let repeat=0;repeat<2;repeat++) {
   global.fetch=jest.fn(async url=>!url.includes(mode)?{ok:false,status:503}:{ok:true,json:async()=>({encoding:'base64',content:Buffer.from(bytes).toString('base64')}),arrayBuffer:async()=>bytes.buffer});
   results.push(await readGitHubSnapshotFile({owner:'o',repo:'r',ref:revision,sha,path:'Control.py'}));
  }
 }
 const facts=read=>completeSupportedRelationships([],pythonRelationshipInventory('Control.py',read.content)).map(row=>({id:row.canonicalRelationshipId,assessment:classifyCodeArchitectureHazardEligibility(row)}));
 for(const read of results) {
  expect(read.contentDigest).toBe(results[0].contentDigest);expect(read.textDigest).toBe(results[0].textDigest);expect(read.decoding).toBe(results[0].decoding);
  expect(facts(read)).toEqual(facts(results[0]));expect(facts(read)).toHaveLength(1);expect(facts(read)[0].assessment.hazardAnalysisEligibility).toBe('Include');
 }
});

it('completes a truncated inventory by walking pinned subtrees', async () => {
 const subtree='b'.repeat(40);
 global.fetch=jest.fn(async url=>({ok:true,json:async()=>url.includes('recursive')?{truncated:true,tree:[]}:
  url.endsWith(subtree)?{tree:[{path:'large.py',sha:'c'.repeat(40),type:'blob',mode:'100644',size:900000}]}:
  {tree:[{path:'src',sha:subtree,type:'tree'}]}}));
 expect((await listGitHubSnapshot('o','r',null,revision)).map(f=>f.path)).toEqual(['src/large.py']);
 expect(fetch.mock.calls.map(([url])=>url)).toEqual([
  `https://api.github.com/repos/o/r/git/trees/${revision}?recursive=1`,
  `https://api.github.com/repos/o/r/git/trees/${revision}`,
  `https://api.github.com/repos/o/r/git/trees/${subtree}`]);
});
it('retains large Unicode GitHub files including the final function', async () => {
 const content='# café 车辆\n'.repeat(50000)+'def last(): return endpoint()\n';
 const sha=await gitBlobDigest(new TextEncoder().encode(content));
 global.fetch=jest.fn(async()=>({ok:true,json:async()=>({encoding:'base64',content:Buffer.from(content).toString('base64')})}));
 expect((await readGitHubSnapshotFile({owner:'o',repo:'r',ref:revision,sha,path:'large.py'})).content).toBe(content);
});
