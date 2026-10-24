import {sha256} from 'hash.js';

// Cache identities only; persisted checkpoint formats remain unchanged.
export const hazardTextKey=text=>{
 const hash=sha256();
 for(let offset=0;offset<text.length;){
  let end=Math.min(text.length,offset+8192);
  if(end<text.length && /[\uD800-\uDBFF]/.test(text[end-1]))end--;
  hash.update(text.slice(offset,end));offset=end;
 }
 return hash.digest('hex');
};
export const hazardMemoryKey=value=>hazardTextKey(JSON.stringify(value));
export const hazardValueBytes=value=>2*(JSON.stringify(value)?.length || 0);

// Conservative serialized UTF-16 accounting, not a measurement of engine heap.
export function hazardByteCache(maxBytes=4*1024*1024,maxEntries=96) {
 const entries=new Map();let bytes=0;
 const remove=key=>{const entry=entries.get(key);if(entry){bytes-=entry.bytes;entries.delete(key);}};
 return {
  get(key){const entry=entries.get(key);if(!entry)return undefined;entries.delete(key);entries.set(key,entry);return entry.value;},
  set(key,value){
   remove(key);const size=hazardValueBytes(value)+key.length*2;
   if(size>maxBytes || maxEntries<1)return;
   while(entries.size && (bytes+size>maxBytes || entries.size>=maxEntries))remove(entries.keys().next().value);
   entries.set(key,{value,bytes:size});bytes+=size;
  },
  get stats(){return {entries:entries.size,bytes,maxBytes,maxEntries};},
 };
}
