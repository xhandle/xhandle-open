import {TextEncoder} from 'util';
import {createHash} from 'crypto';
import {createDiskArchiveSink,createCompressedDiskArchiveSink} from './diskArchiveSink';
beforeAll(()=>{global.TextEncoder=TextEncoder;});
// Large streams use the plain handler: jest.fn would retain every PUT body.
function server({capture=true,corrupt=false}={}){
 const writes=[];let bytes=0,chunks=0,maxChunk=0,lastOptions;const id='a'.repeat(64),hash=createHash('sha256');
 const handler=async(url,options)=>{
  lastOptions={method:options.method,signal:options.signal};
  let value={id};
  if(options.method==='PUT'){
   if(capture)writes.push(options.body);
   hash.update(options.body);bytes+=options.body.length;chunks++;maxChunk=Math.max(maxChunk,options.body.length);value={next:chunks,bytes};
  }
  if(url.endsWith('/finish')){
   const finish=JSON.parse(options.body),digest=hash.digest('hex');
   if(corrupt || finish.bytes!==bytes || finish.chunks!==chunks || finish.digest!==digest)
    return {ok:false,status:400,json:async()=>({error:'Export file integrity check failed.'})};
   value={name:'test.xhproject',bytes};
  }
  return {ok:true,status:options.method==='DELETE'?204:200,json:async()=>value};
 };
 return {fetchImpl:capture?jest.fn(handler):handler,writes,get stats(){return {bytes,chunks,maxChunk,lastOptions};}};
}
test('writes bounded chunks and returns a download URL, with verified bytes and cleanup',async()=>{
 const {fetchImpl,writes}=server(),sink=await createDiskArchiveSink('test',{baseURL:'http://localhost:5001',fetchImpl});
 for(let i=0;i<100;i++)await sink.write('é'.repeat(10000)+'\n');
 const result=await sink.finish();expect(writes.length).toBeGreaterThan(7);expect(writes.every(b=>b.length<=262144)).toBe(true);
 expect(result.bytes).toBe(2000100);expect(result.url).toMatch(/\/download$/);expect(result.name).toBe('test.xhproject');
 await result.dispose();expect(fetchImpl.mock.calls.at(-1)[1].method).toBe('DELETE');await expect(sink.write('late')).rejects.toThrow(/closed/);
});
test('never sends workspace data to a remote backend',async()=>{
 const fetchImpl=jest.fn();await expect(createDiskArchiveSink('test',{baseURL:'https://example.com',fetchImpl})).rejects.toThrow(/local/);expect(fetchImpl).not.toHaveBeenCalled();
});
test('cancellation cleanup uses an independent signal',async()=>{
 const {fetchImpl}=server(),controller=new AbortController(),sink=await createDiskArchiveSink('test',{baseURL:'http://localhost:5001',fetchImpl,signal:controller.signal});
 controller.abort();await sink.abort();const options=fetchImpl.mock.calls.at(-1)[1];expect(options.method).toBe('DELETE');expect(options.signal.aborted).toBe(false);
});
test('rejects incorrect upload acknowledgments',async()=>{
 const {fetchImpl}=server(),sink=await createDiskArchiveSink('test',{baseURL:'http://localhost:5001',fetchImpl});
 fetchImpl.mockResolvedValueOnce({ok:true,status:200,json:async()=>({next:9,bytes:0})});await sink.write('hello');await expect(sink.finish()).rejects.toThrow(/acknowledged/);await sink.abort();
});
test('streams a compressed archive without retaining its uncompressed size',async()=>{
 const old=global.CompressionStream;
 global.CompressionStream=require('stream/web').CompressionStream;
 try{
  const {fetchImpl,writes}=server(),sink=await createCompressedDiskArchiveSink('test',{baseURL:'http://localhost:5001',fetchImpl});
  const content='repeatable saved source and hazard evidence\n'.repeat(10000);
  await sink.write(content);
  const result=await sink.finish();
  const {gunzipSync}=require('zlib');
  expect(gunzipSync(Buffer.concat(writes.map(chunk=>Buffer.from(chunk)))).toString()).toBe(content);
  expect(result.bytes).toBeLessThan(content.length/10);
  await result.dispose();
 }finally{global.CompressionStream=old;}
});

test.each([504,512,520])('streams %s MiB across the SHA-256 length boundary against Node crypto',async mib=>{
 const fixture=server({capture:false}),sink=await createDiskArchiveSink('boundary',{baseURL:'http://localhost:5001',fetchImpl:fixture.fetchImpl});
 const block=new Uint8Array(4*1024*1024);
 for(let i=0;i<block.length;i++)block[i]=i%251;
 try{
  for(let i=0;i<mib/4;i++)await sink.writeBytes(block);
  const result=await sink.finish();
  expect(result.bytes).toBe(mib*1024*1024);
  expect(fixture.stats.bytes).toBe(result.bytes);
  expect(fixture.stats.chunks).toBe(mib*4);
  expect(fixture.stats.maxChunk).toBe(262144);
  expect(fixture.writes).toHaveLength(0);
 }finally{await sink.abort();}
},180000);

test('rejects server integrity failures and permits cleanup',async()=>{
 const fixture=server({corrupt:true}),sink=await createDiskArchiveSink('test',{baseURL:'http://localhost:5001',fetchImpl:fixture.fetchImpl});
 await sink.write('non-ASCII: é 😀');
 await expect(sink.finish()).rejects.toThrow('Export file integrity check failed.');
 await sink.abort();expect(fixture.stats.lastOptions.method).toBe('DELETE');
});

test.each([262143,262144,262145])('preserves byte boundary %s',async length=>{
 const fixture=server(),sink=await createDiskArchiveSink('test',{baseURL:'http://localhost:5001',fetchImpl:fixture.fetchImpl});
 await sink.writeBytes(new Uint8Array(length).fill(173));
 expect((await sink.finish()).bytes).toBe(length);
 expect(fixture.writes.map(b=>b.length)).toEqual(length<=262144?[length]:[262144,1]);
 await sink.abort();
});

test('preserves Uint8Array offsets and UTF-8 bytes across mixed writes',async()=>{
 const fixture=server(),sink=await createDiskArchiveSink('test',{baseURL:'http://localhost:5001',fetchImpl:fixture.fetchImpl});
 try{
  await sink.writeBytes(new Uint8Array([99,0,128,255,99]).subarray(1,4));
  await sink.write('é 😀\u0000');
  await sink.finish();
  expect(Buffer.concat(fixture.writes.map(chunk=>Buffer.from(chunk)))).toEqual(Buffer.concat([Buffer.from([0,128,255]),Buffer.from('é 😀\u0000','utf8')]));
 }finally{await sink.abort();}
});

test('cancels an in-flight upload and still disposes with an independent signal',async()=>{
 const fixture=server(),controller=new AbortController();let uploadStarted;
 const started=new Promise(resolve=>{uploadStarted=resolve;});
 const fetchImpl=(url,options)=>{
  if(options.method!=='PUT')return fixture.fetchImpl(url,options);
  return new Promise((resolve,reject)=>{
   options.signal.addEventListener('abort',()=>reject(new Error('upload cancelled')),{once:true});
   uploadStarted();
  });
 };
 const sink=await createDiskArchiveSink('test',{baseURL:'http://localhost:5001',fetchImpl,signal:controller.signal});
 try{
  const writing=sink.writeBytes(new Uint8Array(262144));
  const rejected=expect(writing).rejects.toThrow('upload cancelled');
  await started;controller.abort();await rejected;
 }finally{await sink.abort();}
 expect(fixture.stats.lastOptions.method).toBe('DELETE');
 expect(fixture.stats.lastOptions.signal.aborted).toBe(false);
});

test.each(['write','finish'])('propagates compression errors during %s and permits resource cleanup',async phase=>{
 const old=global.CompressionStream,fixture=server();let sink;
 const {TransformStream}=require('stream/web');
 global.CompressionStream=class {
  constructor(){return new TransformStream({
   transform(chunk,controller){if(phase==='write')throw new Error('compression failed');controller.enqueue(chunk);},
   flush(){if(phase==='finish')throw new Error('compression failed');},
  });}
 };
 try{
  sink=await createCompressedDiskArchiveSink('test',{baseURL:'http://localhost:5001',fetchImpl:fixture.fetchImpl});
  if(phase==='write')await expect(sink.write('é 😀')).rejects.toThrow('compression failed');
  else{await sink.write('é 😀');await expect(sink.finish()).rejects.toThrow('compression failed');}
 }finally{await sink?.abort();global.CompressionStream=old;}
 expect(fixture.stats.lastOptions.method).toBe('DELETE');
});
