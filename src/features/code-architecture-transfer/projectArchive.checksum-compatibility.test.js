import 'fake-indexeddb/auto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { Blob } from 'buffer';
import { TextEncoder, TextDecoder } from 'util';
import { createHash, webcrypto } from 'crypto';
import { serialize, deserialize } from 'v8';
import { gzipSync } from 'zlib';
import { sha256 } from 'hash.js';
import { exportProjectArchive, importProjectArchive, decodeValue } from './projectArchive';
import { encodeCompact } from './compactArchiveCodec';
import { chunkHazardRun, hazardChunkDigest } from '../code-architecture-hazard-analysis/hazardRunChunks';
const project={id:'checksum-review',name:'é😀\r\n',repos:[]};
const line=entry=>JSON.stringify(['compact-v1',entry])+'\n';
const digest=text=>createHash('sha256').update(text,'utf8').digest('hex');
beforeAll(()=>{
  global.structuredClone=v=>deserialize(serialize(v));global.Blob=Blob;
  global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;global.IDBKeyRange=IDBKeyRange;
  Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});
});
beforeEach(()=>{global.indexedDB=new IDBFactory();localStorage.clear();});
test('real exporter footer matches independent UTF-8 bytes; raw and gzip import preserve data',async()=>{
  const key='cbaMeta:checksum-review:r',value='é😀\r\n\\\u0000';localStorage.setItem(key,value);
  const file=await exportProjectArchive({...project,repos:[{id:'r'}]}),text=await file.text(),lines=text.match(/.*\n/g);
  const footer=decodeValue(JSON.parse(lines.pop())),body=lines.join('');
  expect(footer.digest).toBe(digest(Buffer.from(body,'utf8')));expect(footer.count).toBe(lines.length);
  expect(body).toContain(JSON.stringify(await encodeCompact({kind:'local',key,value}))+'\n');
  const streams=require('stream/web'),old=[global.ReadableStream,global.DecompressionStream];
  global.ReadableStream=streams.ReadableStream;global.DecompressionStream=streams.DecompressionStream;
  try {for(const source of [file,new Blob([gzipSync(Buffer.from(text))])]){
    global.indexedDB=new IDBFactory();localStorage.clear();await importProjectArchive(source);
    expect(localStorage.getItem(key)).toBe(value);
  }}finally{[global.ReadableStream,global.DecompressionStream]=old;}
});
test.each(['corrupt','truncated','malformed','unknown-version','CRLF'])('%s rejects before destination writes',async variant=>{
  localStorage.setItem('cbaMeta:checksum-review:r','unique-content');
  const text=await (await exportProjectArchive({...project,repos:[{id:'r'}]})).text();
  const changed=variant==='corrupt'?text.replace('unique-content','damaged-content'):
    variant==='truncated'?text.slice(0,-1):variant==='malformed'?text.replace('compact-v1','invalid'):
    variant==='unknown-version'?text.replace('"version":3','"version":99'):text.replace(/\n/g,'\r\n');
  global.indexedDB=new IDBFactory();localStorage.clear();const writes=jest.spyOn(Storage.prototype,'setItem');
  try{await expect(importProjectArchive(new Blob([changed]))).rejects.toThrow();expect(writes).not.toHaveBeenCalled();}
  finally{writes.mockRestore();}
  expect(await indexedDB.databases()).toEqual([]);
});
test.each([1,2,3])('version %s fixture with independently calculated footer imports',async version=>{
  const body=line({type:'xhandle-code-architecture-archive',version,project});
  await importProjectArchive(new Blob([body,line({kind:'end',count:1,digest:digest(body)})]));
  expect(JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))[0].id).toBe(project.id);
});
test('independently checksum-valid malformed stream fails before writes',async()=>{
  const body=line({type:'xhandle-code-architecture-archive',version:3,project})+
    line({kind:'stream-start',transportVersion:2})+line({kind:'stream-data',tokens:[['invalid']]})+line({kind:'stream-end'});
  const writes=jest.spyOn(Storage.prototype,'setItem');
  try{await expect(importProjectArchive(new Blob([body,line({kind:'end',count:4,digest:digest(body)})]))).rejects.toThrow(/streamed/);expect(writes).not.toHaveBeenCalled();}
  finally{writes.mockRestore();}
});
test('production hazard pages and aggregate/index digests match independent Node crypto',async()=>{
  const chunks=[];let root;
  for await(const entry of chunkHazardRun({id:'run',projectId:project.id,generatedSheets:{Summary:[['id'],...Array.from({length:100},(_,i)=>[i,'é😀'.repeat(500)])]}})){
    if(entry.chunk)chunks.push(entry.chunk);else root=entry.run;
  }
  expect(chunks.length).toBeGreaterThan(1);
  for(const chunk of chunks){expect(chunk.digest).toBe(digest(JSON.stringify(chunk.tokens)));expect(hazardChunkDigest(chunk.tokens)).toBe(chunk.digest);}
  expect(root.payload.digest).toBe(digest(chunks.map(c=>c.digest+'\n').join('')));
  for(const index of [root.payload.tableIndex,root.payload.rowIndex]){const {digest:actual,...data}=index;expect(actual).toBe(digest(JSON.stringify(data)));}
});
// Opt-in ~520 MiB generation plus two real parser validation passes (~minutes).
// Virtual file slices retain only 256 KiB and ~8K identities, no giant Blob/store.
// Stop before commit: this proves full large validation, not large destination restore.
const large=process.env.XHANDLE_INTERNAL_CHECKSUM_LARGE==='1'?test:test.skip;
large('520 MiB actual parser accepts legacy footer and rejects standard-only replacement',async()=>{
  const header=line({type:'xhandle-code-architecture-archive',version:3,project});
  const payload='x'.repeat(65536),records=8320;
  const record=i=>line({kind:'local',key:`cbaMeta:checksum-review:${String(i).padStart(6,'0')}`,value:payload});
  const width=Buffer.byteLength(record(0)),prefix=Buffer.from(header),legacy=sha256(),standard=createHash('sha256');
  legacy.update(prefix);standard.update(prefix);
  for(let i=0;i<records;i++){const bytes=Buffer.from(record(i));legacy.update(bytes);standard.update(bytes);}
  const old=legacy.digest('hex'),correct=standard.digest('hex'),bodySize=prefix.length+records*width;
  expect(bodySize).toBeGreaterThan(520*1048576);expect(old).not.toBe(correct);
  function virtualFile(checksum){
    const footer=Buffer.from(line({kind:'end',count:records+1,digest:checksum}));
    return {size:bodySize+footer.length,slice(start,end){
      const parts=[];let at=start;end=Math.min(end,bodySize+footer.length);
      while(at<end){let bytes,base;
        if(at<prefix.length){bytes=prefix;base=0;}
        else if(at<bodySize){const i=Math.floor((at-prefix.length)/width);bytes=Buffer.from(record(i));base=prefix.length+i*width;}
        else{bytes=footer;base=bodySize;}
        const size=Math.min(end-at,bytes.length-(at-base));parts.push(bytes.subarray(at-base,at-base+size));at+=size;
      }
      const bytes=Buffer.concat(parts);return {async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length);}};
    }};
  }
  const writes=jest.spyOn(Storage.prototype,'setItem');
  try{
    const controller=new AbortController();let validated=false;
    await expect(importProjectArchive(virtualFile(old),{signal:controller.signal,onProgress:m=>{
      if(m==='Importing validated project records…'){validated=true;controller.abort();}
    }})).rejects.toThrow(/cancelled/);
    expect(validated).toBe(true);expect(writes).not.toHaveBeenCalled();
    await expect(importProjectArchive(virtualFile(correct))).rejects.toThrow(/checksum/);
    expect(writes).not.toHaveBeenCalled();expect(await indexedDB.databases()).toEqual([]);
    console.log(JSON.stringify({bodySize,records,legacy:old,standard:correct}));
  }finally{writes.mockRestore();}
},240000);
