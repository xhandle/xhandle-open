/* global BigInt */
import { Blob } from 'buffer';
import { gzipSync } from 'zlib';
import { encodeCompact, decodeCompact } from './compactArchiveCodec';
import { encodeValue, decodeValue } from './projectArchive';
beforeAll(()=>{global.Blob=Blob;});
test('ordinary JSON is compact and reserved keys and structured types roundtrip exactly',async()=>{
 const value={ordinary:[{id:'a',text:'saved'}],reserved:{$xhandle:['undefined',null]},pollution:JSON.parse('{"__proto__":{"polluted":true}}'),map:new Map([['k',new Set([1,2])]]),date:new Date('2026-01-01'),missing:undefined,big:BigInt(123),negative:-0,infinity:Infinity,nan:NaN,bytes:new Uint16Array([0,65535]),data:new DataView(new Uint8Array([1,2]).buffer),blob:new Blob(['saved'],{type:'text/plain'}),byteArray:Array.from({length:256},(_,i)=>i)};
 const result=decodeCompact(JSON.parse(JSON.stringify(await encodeCompact(value))));
 expect({...result,blob:null}).toEqual({...value,blob:null});
 expect(await result.blob.text()).toBe('saved');expect(result.blob.type).toBe('text/plain');
 expect({}.polluted).toBeUndefined();expect(Object.hasOwn(result,'missing')).toBe(true);
});
test('compact JSON substantially reduces typed-wrapper overhead without changing data',async()=>{
 const value={kind:'record',rows:Array.from({length:150},(_,id)=>({id,from:'sender',to:'receiver',trace:{row:id,files:['control.cpp']},evidence:'retained'}))};
 const old=JSON.stringify(await encodeValue(value)),compact=JSON.stringify(await encodeCompact(value));
 expect(compact.length).toBeLessThan(old.length*0.75);
 expect(gzipSync(compact).length).toBeLessThan(gzipSync(old).length);
 expect(decodeCompact(JSON.parse(compact))).toEqual(value);
});
test.each([{$xhandle:['binary','!', ['ArrayBuffer','']]},{$xhandle:['unknown',0]},{$xhandle:['map',[[1]]]},{$xhandle:['object',[['a',1],['a',2]]]},{$xhandle:['undefined',null],extra:1}])('invalid envelopes fail closed',async value=>{
 expect(()=>decodeCompact(['compact-v1',value])).toThrow();
});
test('binary arrays are packed losslessly instead of decimal expansion',async()=>{
 const v=Array.from({length:8192},(_,i)=>i%256);
 const encoded=await encodeCompact(v);
 expect(JSON.stringify(encoded).length).toBeLessThan(JSON.stringify(v).length/2);
 expect(decodeCompact(encoded)).toEqual(v);
});

test.each(['first', 'middle', 'last', 'all', 'undefined'])('missing byte entries remain undefined (%s)', async position => {
 const source = Array.from({length:64}, (_,i)=>i);
 if(position==='all')source.fill(undefined).forEach((_,i)=>delete source[i]);
 else if(position==='undefined')source[32]=undefined;
 else delete source[{first:0,middle:32,last:63}[position]];
 const previous=decodeValue(JSON.parse(JSON.stringify(await encodeValue(source))));
 const current=decodeCompact(JSON.parse(JSON.stringify(await encodeCompact(source))));
 expect(current).toStrictEqual(previous);
 expect(current.length).toBe(64);
 expect(current[position==='first'||position==='all'?0:position==='last'?63:32]).toBeUndefined();
});
test('negative zero is not packed as an ordinary zero byte', async()=>{
 const source=Array(64).fill(0);source[32]=-0;
 const result=decodeCompact(JSON.parse(JSON.stringify(await encodeCompact(source))));
 expect(Object.is(result[32],-0)).toBe(true);
});

test.each([63,64,65])('byte packing boundary remains lossless and does not mutate source (length=%s)', async length=>{
 const source=Array.from({length},(_,i)=>i%256);
 const encoded=await encodeCompact(source);
 expect(decodeCompact(JSON.parse(JSON.stringify(encoded)))).toStrictEqual(source);
 expect(Array.isArray(encoded[1])).toBe(length<64);
 expect(source).toStrictEqual(Array.from({length},(_,i)=>i%256));
});
test.each([undefined,null,-0,-1,256,1.5,NaN,Infinity,'7'])('non-byte array value survives nested compact roundtrip (%s)', async special=>{
 const values=Array(65).fill(7);values[32]=special;
 const source={checkpoint:{values}};
 const encoded=await encodeCompact(source);
 expect(Array.isArray(encoded[1].checkpoint.values)).toBe(true);
 expect(decodeCompact(JSON.parse(JSON.stringify(encoded)))).toStrictEqual(source);
 expect(Object.is(values[32],special)).toBe(true);
});
