import {sha256} from 'hash.js';
import {streamValue,createValueAssembler} from '../code-architecture-transfer/archiveValueStream';
import {hazardChunkKey,hazardChunkDigest,HAZARD_CHUNKS} from './hazardRunChunks';
import {validateHazardTableIndex} from './hazardTableIndex';
import {createHazardTokenValidator} from '../code-architecture-transfer/hazardTokenValidator';
const containers=new Set(['object','array','string','map','set','binary']);
const readers=new WeakMap();
export const checkCsvSignal=signal=>{if(signal?.aborted)throw new DOMException('CSV import canceled.','AbortError');};
export async function* sourceTokens(db,root,{signal,span,onProgress=()=>{}}={}){
 let reader=readers.get(root);if(!reader){reader={expected:new Map(validateHazardTableIndex(root.payload).pages.map(page=>[page.sequence,page.digest])),pages:new Map()};readers.set(root,reader);}
 const digest=sha256(),expected=reader.expected,validator=span?null:createHazardTokenValidator({id:root.id,projectId:root.projectId,repoId:root.repoId});
 const first=span?.[0]||0,last=span?.[2]??root.payload.count-1;
 for(let sequence=first;sequence<=last;sequence++){
  checkCsvSignal(signal);let page=reader.pages.get(sequence);if(!page){page=await db.get(HAZARD_CHUNKS,hazardChunkKey(root.payload.generation,sequence));
  // The table-only index deliberately omits evidence-only pages. Full source
  // rewrites still verify those pages against their own digests and the final
  // complete-source digest; absence from the table index is not corruption.
  if(!page || page.runId!==root.id || page.projectId!==root.projectId || page.repoId!==root.repoId || page.generation!==root.payload.generation || (expected.has(sequence) && page.digest!==expected.get(sequence)) || page.digest!==hazardChunkDigest(page.tokens))throw Error('Saved analysis failed integrity verification. Existing results were not changed.');
  if(reader.pages.size>=16)reader.pages.delete(reader.pages.keys().next().value);reader.pages.set(sequence,page);}
  digest.update(page.digest+'\n');
  for(let offset=span && sequence===first?span[1]:0;offset<(span && sequence===last?span[3]:page.tokens.length);offset++){validator?.add(page.tokens[offset]);yield page.tokens[offset];}
  onProgress({completed:sequence-first+1,total:last-first+1});
 }
 if(!span && digest.digest('hex')!==root.payload.digest)throw Error('Saved analysis failed integrity verification.');
 validator?.finish();
}
// Replace root fields without assembling any other field. Missing fields are
// appended before the root closes. Factories yield bounded value-token streams.
export async function* replaceRootFields(tokens,replacements){
 const iterator=tokens[Symbol.asyncIterator]();const first=await iterator.next();
 if(first.value?.[0]!=='object')throw Error('Invalid saved hazard root.');yield first.value;
 const seen=new Set();
 const copy=async function*(initial,emit=true){let depth=containers.has(initial[0])?1:0;if(emit)yield initial;while(depth){const item=await iterator.next();if(item.done)throw Error('Truncated saved analysis.');const token=item.value;if(containers.has(token[0]))depth++;else if(token[0]==='end')depth--;if(emit)yield token;}};
 while(true){
  const item=await iterator.next();if(item.done)throw Error('Truncated saved analysis.');
  if(item.value[0]==='end')break;
  const assembler=createValueAssembler();for await(const token of copy(item.value)){assembler.add(token);}
  const key=assembler.finish();if(typeof key!=='string'||key.length>8192)throw Error('Invalid saved field name.');
  seen.add(key);yield* streamValue(key);
  const value=await iterator.next();if(value.done)throw Error('Truncated saved field.');
  if(Object.prototype.hasOwnProperty.call(replacements,key)){const original=copy(value.value);yield* replacements[key](original);for await(const ignored of original){void ignored;}}
  else yield* copy(value.value);
 }
 for(const [key,factory]of Object.entries(replacements))if(!seen.has(key)){yield*streamValue(key);yield*factory();}
 yield ['end'];
 if(!(await iterator.next()).done)throw Error('Unexpected saved data after hazard root.');
}
export async function* valueEntries(tokens,kind='object'){
 const iterator=tokens[Symbol.asyncIterator]();if((await iterator.next()).value?.[0]!==kind)throw Error('Invalid saved CSV undo data.');
 const value=async initial=>{const assembler=createValueAssembler();let depth=containers.has(initial[0])?1:0,bytes=0;assembler.add(initial);
  while(depth){const item=await iterator.next();if(item.done)throw Error('Truncated saved CSV data.');bytes+=JSON.stringify(item.value).length*2;if(bytes>8*1024*1024)throw Error('A saved CSV value exceeds the safe editing limit.');assembler.add(item.value);if(containers.has(item.value[0]))depth++;else if(item.value[0]==='end')depth--;}
  return assembler.finish();};
 let index=0;
 while(true){const item=await iterator.next();if(item.done)throw Error('Truncated saved CSV data.');if(item.value[0]==='end')break;
  if(kind==='array')yield [index++,await value(item.value)];
  else{const key=await value(item.value),next=await iterator.next();if(next.done)throw Error('Missing saved CSV value.');yield [key,await value(next.value)];}
 }
}
