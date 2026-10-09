import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import { openCbaIndexedDB, readFirstCbaRowsFromIndexedDB, readCbaRowsFromIndexedDB, writeCbaRowsToIndexedDB,
  prepareArchitecturePublication, recoverArchitecturePublication, readArchitectureCheckpoint } from './codeArchitectureStorage';
import { putRawRecord } from '../code-architecture-storage/chunkedRecord';
const fs=require('fs'), parser=require('@babel/parser'), traverse=require('@babel/traverse').default;
const source=fs.readFileSync('src/App.js','utf8');
let lookup;
traverse(parser.parse(source,{sourceType:'module',plugins:['jsx']}),{FunctionDeclaration({node}){
  if(node.id?.name==='readCodeArchitectureRowsForRepo') lookup=source.slice(node.start,node.end);
}});
const A='cba:A:repoA', B='cba:B:repoB', store='copilot_baseline';
const rowsA=[{from:'A function',lineage:{scope:A}}], rowsB=[{from:'B function',lineage:{scope:B}}];
const original={indexedDB:global.indexedDB,structuredClone:global.structuredClone,encoder:global.TextEncoder,crypto:global.crypto};
beforeEach(()=>{
 global.indexedDB=new IDBFactory();global.structuredClone=v=>deserialize(serialize(v));global.TextEncoder=TextEncoder;
 global.crypto=webcrypto;localStorage.clear();
});
afterEach(()=>{
 global.indexedDB=original.indexedDB;global.structuredClone=original.structuredClone;global.TextEncoder=original.encoder;
 global.crypto=original.crypto;
});
async function raw(key,value){const db=await openCbaIndexedDB();try{await putRawRecord(db,store,key,value);}finally{db.close();}}
function loadB(){
 const env={codeArchitectureRowsKey:(p,r)=>`cba:${p}:${r}`,codeArchitectureReposMatch:()=>false,readFirstCbaRowsFromIndexedDB};
 const fn=new Function(...Object.keys(env),`return (${lookup});`)(...Object.values(env));
 return fn({id:'B',repos:[]},{id:'repoB',owner:'shared',repo:'repo'},B);
}
test('missing differs from explicitly empty legacy and chunked primary records',async()=>{
 await raw(A,rowsA);
 expect(await readFirstCbaRowsFromIndexedDB([B])).toMatchObject({found:false,rows:[]});
 await raw(B,[]);
 expect(await readFirstCbaRowsFromIndexedDB([B,A])).toMatchObject({key:B,found:true,rows:[]});
 expect(await writeCbaRowsToIndexedDB(B,[])).toBe(true);
 expect(await readFirstCbaRowsFromIndexedDB([B,A])).toMatchObject({key:B,found:true,rows:[]});
});
test('App recovery ignores foreign metadata aliases and global repository fallback',async()=>{
 await raw(A,rowsA);await raw('cba:shared/repo',rowsA);
 localStorage.setItem('cbaMeta:B:repoB',JSON.stringify({indexedDB:{key:A},storageKey:A}));
 expect(await loadB()).toMatchObject({rows:[],found:false});
});
test('known historical cross-project lineage is rejected without rewriting stored data',async()=>{
 await raw(B,rowsA);
 await expect(loadB()).rejects.toThrow(/another project/);
 expect(await readCbaRowsFromIndexedDB(B)).toEqual(rowsA);
});
test('publication and recovery only update their own scope',async()=>{
 await raw(A,rowsA);await raw(B,[]);
 const checkpoint=`functional-decomposition-checkpoint:${B}:test`;
 await prepareArchitecturePublication(B,rowsB,{fingerprint:'b'.repeat(64)},{selectedFiles:1},checkpoint,[]);
 await expect(recoverArchitecturePublication(A,checkpoint)).rejects.toThrow(/does not belong/);
 await recoverArchitecturePublication(B,checkpoint);
 expect(await readCbaRowsFromIndexedDB(A)).toEqual(rowsA);
 expect(await readCbaRowsFromIndexedDB(B)).toEqual(rowsB);
});
test('conflicting edits retain completed checkpoint and both projects',async()=>{
 await raw(A,rowsA);await raw(B,[]);
 const checkpoint=`functional-decomposition-checkpoint:${B}:conflict`;
 await prepareArchitecturePublication(B,rowsB,{fingerprint:'c'.repeat(64)},{selectedFiles:1},checkpoint,[]);
 const edited=[{from:'B human edit'}];await raw(B,edited);
 await expect(recoverArchitecturePublication(B,checkpoint)).rejects.toMatchObject({code:'SOURCE_PUBLICATION_CONFLICT'});
 expect(await readCbaRowsFromIndexedDB(B)).toEqual(edited);
 expect(await readCbaRowsFromIndexedDB(A)).toEqual(rowsA);
 expect((await readArchitectureCheckpoint(checkpoint)).rows).toEqual(rowsB);
});
