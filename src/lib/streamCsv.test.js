import {Blob} from 'buffer';
import {TextDecoder} from 'util';
import {streamCsv} from './streamCsv';
beforeAll(()=>{global.TextDecoder=TextDecoder;});
async function read(text,chunkSize){const rows=[];for await(const row of streamCsv(new Blob([text]),{chunkSize}))rows.push(row);return rows;}
test.each([1,2,7,65536])('quoted UTF-8 fields, escapes, BOM and multiline records survive %s-byte slices',async size=>{
 const text='\uFEFFid,notes,empty\r\n"one","café, line\r\nwith ""quotes""",\r\n"two","done",""';
 expect(await read(text,size)).toEqual([['id','notes','empty'],['one','café, line\r\nwith "quotes"',''],['two','done','']]);
});
test.each(['id,notes\n1,"unfinished','id\n"closed"unexpected'])('rejects malformed CSV rather than partially importing',async text=>{
 await expect(read(text,3)).rejects.toThrow('Invalid CSV');
});
test('canceling stops decoding and the decoded-row limit rejects oversized cells',async()=>{
 const controller=new AbortController();controller.abort();
 await expect(streamCsv(new Blob(['id\nvalue']),{signal:controller.signal}).next()).rejects.toHaveProperty('name','AbortError');
 await expect(streamCsv(new Blob(['x'.repeat(100)]),{maxRowChars:20}).next()).rejects.toThrow('safe');
});
