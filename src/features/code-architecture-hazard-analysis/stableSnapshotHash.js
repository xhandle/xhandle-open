// Hash the legacy stableValue -> JSON.stringify UTF-16 stream without building
// a canonical evidence tree or a whole-document JSON string.
// A frozen snapshot may reference the same large evidence subtree from thousands
// of relationships. Compose its exact hash segment instead of rescanning that
// evidence on every row/edit. Only recursively immutable data is cached; shallow
// freezing and getters must not hide later changes. Weak keys retain no history.
const immutableSegments = new WeakMap();
const power31 = length => {
 let result=1,base=31;
 while(length>0){if(length%2)result=Math.imul(result,base);base=Math.imul(base,base);length=Math.floor(length/2);}
 return result;
};
export function stableSnapshotHash(value) {
 let hash=0,length=0;
 const emit=text=>{length+=text.length;for(let i=0;i<text.length;i++)hash=((hash<<5)-hash+text.charCodeAt(i))|0;};
 const string=value=>{
  emit('"');
  for(let i=0;i<value.length;i++){
   const code=value.charCodeAt(i);
   if(code===34)emit('\\"');
   else if(code===92)emit('\\\\');
   else if(code<32)emit(JSON.stringify(value[i]).slice(1,-1));
   else if(code>=0xd800 && code<=0xdbff){
    const next=value.charCodeAt(i+1);
    if(next>=0xdc00 && next<=0xdfff){emit(value[i]);emit(value[++i]);}
    else emit('\\u'+code.toString(16).padStart(4,'0'));
   }else if(code>=0xdc00 && code<=0xdfff)emit('\\u'+code.toString(16).padStart(4,'0'));
   else emit(value[i]);
  }
  emit('"');
 };
 const walk=value=>{
  if(value==null){string('');return true;}
  if(typeof value==='string'){string(value);return true;}
  const object=typeof value==='object';
  if(object&&immutableSegments.has(value)){
   const segment=immutableSegments.get(value);
   hash=(Math.imul(hash,segment.power)+segment.hash)|0;length+=segment.length;return true;
  }
  const startHash=hash,startLength=length;
  let immutable=object&&Object.isFrozen(value);
  if(Array.isArray(value)){
   emit('[');for(let i=0;i<value.length;i++){
    if(i)emit(',');
    if(immutable){const descriptor=Object.getOwnPropertyDescriptor(value,String(i));if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))immutable=false;}
    if(!(i in value) || typeof value[i]==='function' || typeof value[i]==='symbol')emit('null');
    else if(!walk(value[i]))immutable=false;
   }emit(']');
  }else if(object){
   // JSON enumerates integer keys numerically even after stableValue sorts keys.
   const keys=Object.keys(Object.fromEntries(Object.keys(value).sort().filter(k=>k!=='__proto__').map(k=>[k,null])));
   emit('{');let first=true;
   for(const key of keys){
    if(immutable){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))immutable=false;}
    if(typeof value[key]==='function' || typeof value[key]==='symbol')continue;
    if(!first)emit(',');first=false;string(key);emit(':');if(!walk(value[key]))immutable=false;
   }emit('}');
  }else{
   emit(JSON.stringify(value));return true;
  }
  if(immutable){const segmentLength=length-startLength,power=power31(segmentLength);immutableSegments.set(value,{length:segmentLength,power,hash:(hash-Math.imul(startHash,power))|0});}
  return immutable;
 };
 walk(value);return hash;
}
