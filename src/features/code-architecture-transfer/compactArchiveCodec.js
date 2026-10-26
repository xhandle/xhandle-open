/* global BigInt */
// Ordinary JSON remains ordinary JSON. Rare structured values use an escaped
// envelope; user objects containing that key are escaped too. This is a wire
// encoding only: decoded storage records and their integrity digests are exact.
const MARK='$xhandle';
function isDenseByteArray(value) {
  if(value.length<64)return false;
  // Array.every skips holes; converting those holes to bytes would create zeros.
  for(let i=0;i<value.length;i++) {
    if(!Object.hasOwn(value,i))return false;
    const n=value[i];
    if(!Number.isInteger(n)||n<0||n>255||Object.is(n,-0))return false;
  }
  return true;
}
const tag=(type,value,extra)=>({[MARK]:extra===undefined?[type,value]:[type,value,extra]});
const base64=bytes=>{
  let result='';
  for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(result);
};
const unbase64=text=>{
  if(typeof text!=='string' || text.length%4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))throw new Error('Invalid compact archive binary.');
  return Uint8Array.from(atob(text),c=>c.charCodeAt(0));
};
const define=(object,key,value)=>Object.defineProperty(object,key,{value,enumerable:true,writable:true,configurable:true});
export async function encodeCompact(value) {
  const seen=new WeakSet();
  async function encode(v) {
    if(v===undefined)return tag('undefined',null);
    if(typeof v==='bigint')return tag('bigint',String(v));
    if(typeof v==='number' && (!Number.isFinite(v)||Object.is(v,-0)))return tag('number',Object.is(v,-0)?'-0':String(v));
    if(v===null || ['string','boolean','number'].includes(typeof v))return v;
    if(typeof v!=='object')throw new Error('Unsupported project storage value.');
    if(seen.has(v))throw new Error('Circular project storage value.');
    seen.add(v);
    try {
      if(v instanceof Date)return tag('date',v.toISOString());
      if(v instanceof Blob)return tag('binary',base64(new Uint8Array(await v.arrayBuffer())),['Blob',v.type]);
      if(v instanceof ArrayBuffer || ArrayBuffer.isView(v))return tag('binary',base64(new Uint8Array(v.buffer||v,v.byteOffset||0,v.byteLength)),[v instanceof ArrayBuffer?'ArrayBuffer':v.constructor.name,'']);
      if(v instanceof Map){const entries=[];for(const [k,x] of v)entries.push([await encode(k),await encode(x)]);return tag('map',entries);}
      if(v instanceof Set){const entries=[];for(const x of v)entries.push(await encode(x));return tag('set',entries);}
      if(Array.isArray(v)){
        if(isDenseByteArray(v))return tag('byte-array',base64(Uint8Array.from(v)));
        const entries=[];for(const x of v)entries.push(await encode(x));return entries;
      }
      if(Object.getPrototypeOf(v)?.constructor?.name!=='Object' && Object.getPrototypeOf(v)!==null)throw new Error('Unsupported project storage value.');
      const entries=[];
      for(const key of Object.keys(v))entries.push([key,await encode(v[key])]);
      if(Object.hasOwn(v,MARK))return tag('object',entries);
      const result={};for(const [key,x] of entries)define(result,key,x);return result;
    } finally {seen.delete(v);}
  }
  return ['compact-v1',await encode(value)];
}
export function decodeCompact(encoded) {
  const bad=()=>{throw new Error('Invalid compact project archive.');};
  function decode(v) {
    if(v===null || typeof v!=='object')return v;
    if(Array.isArray(v))return v.map(decode);
    if(!Object.hasOwn(v,MARK)){const result={};for(const key of Object.keys(v))define(result,key,decode(v[key]));return result;}
    if(Object.keys(v).length!==1 || !Array.isArray(v[MARK]))bad();
    const [type,value,extra]=v[MARK];
    if(v[MARK].length!==(type==='binary'?3:2))bad();
    if(type==='undefined' && value===null)return undefined;
    if(type==='bigint' && typeof value==='string' && /^-?\d+$/.test(value))return BigInt(value);
    if(type==='number' && ['NaN','Infinity','-Infinity','-0'].includes(value))return Number(value);
    if(type==='date' && typeof value==='string' && Number.isFinite(Date.parse(value)))return new Date(value);
    if(type==='byte-array')return Array.from(unbase64(value));
    if(type==='binary'){
      if(!Array.isArray(extra)||extra.length!==2||typeof extra[1]!=='string')bad();
      const bytes=unbase64(value),[name,mime]=extra;
      if(name==='Blob')return new Blob([bytes],{type:mime});
      if(name==='ArrayBuffer')return bytes.buffer;
      const types={Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,DataView};
      if(!Object.hasOwn(types,name))bad();
      return new types[name](bytes.buffer);
    }
    if(type==='set' && Array.isArray(value))return new Set(value.map(decode));
    if(['map','object'].includes(type) && Array.isArray(value)){
      if(value.some(pair=>!Array.isArray(pair)||pair.length!==2))bad();
      if(type==='map')return new Map(value.map(([k,x])=>[decode(k),decode(x)]));
      const result={};for(const [key,x] of value){if(typeof key!=='string'||Object.hasOwn(result,key))bad();define(result,key,decode(x));}return result;
    }
    bad();
  }
  if(!Array.isArray(encoded)||encoded.length!==2||encoded[0]!=='compact-v1')bad();
  return decode(encoded[1]);
}
