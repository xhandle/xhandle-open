import {TextEncoder} from 'util';
import {sha256} from 'hash.js';
import {createDiskArchiveSink} from './diskArchiveSink';
beforeAll(()=>{global.TextEncoder=TextEncoder;});
function server(){
 const writes=[];let bytes=0;const id='a'.repeat(64);
 const fetchImpl=jest.fn(async(url,options)=>{
  let value={id};
  if(options.method==='PUT'){writes.push(options.body);bytes+=options.body.length;value={next:writes.length,bytes};}
  if(url.endsWith('/finish')){const finish=JSON.parse(options.body);const hash=sha256();writes.forEach(b=>hash.update(b));expect(finish).toEqual({bytes,chunks:writes.length,digest:hash.digest('hex')});value={name:'test.xhproject',bytes};}
  return {ok:true,status:options.method==='DELETE'?204:200,json:async()=>value};
 });return {fetchImpl,writes};
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
