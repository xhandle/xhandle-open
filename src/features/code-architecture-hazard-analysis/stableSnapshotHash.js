// Hash the legacy stableValue -> JSON.stringify UTF-16 stream without building
// a canonical evidence tree or a whole-document JSON string.
export function stableSnapshotHash(value) {
 let hash=0;
 const emit=text=>{for(let i=0;i<text.length;i++)hash=((hash<<5)-hash+text.charCodeAt(i))|0;};
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
  if(value==null){string('');return;}
  if(typeof value==='string'){string(value);return;}
  if(Array.isArray(value)){
   emit('[');for(let i=0;i<value.length;i++){if(i)emit(',');if(!(i in value) || typeof value[i]==='function' || typeof value[i]==='symbol')emit('null');else walk(value[i]);}emit(']');return;
  }
  if(typeof value==='object'){
   // JSON enumerates integer keys numerically even after stableValue sorts keys.
   const keys=Object.keys(Object.fromEntries(Object.keys(value).sort().filter(k=>k!=='__proto__').map(k=>[k,null])));
   emit('{');let first=true;
   for(const key of keys){if(typeof value[key]==='function' || typeof value[key]==='symbol')continue;if(!first)emit(',');first=false;string(key);emit(':');walk(value[key]);}emit('}');return;
  }
  emit(JSON.stringify(value));
 };
 walk(value);return hash;
}
