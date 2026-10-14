import {hazardRequestInputBudget,hazardPromptBytes} from './fastHazardBudgets';

// Lossless interning: repeated evidence retains every occurrence and location,
// but its content is sent once. No source excerpts or context are truncated.
export function compactHazardPromptPayload(context,interfaces) {
 const counts=new Map();
 const key=value=>value!=null && (typeof value==='object' || typeof value==='string')?JSON.stringify(value):'';
 const visit=value=>{
  const serialized=key(value);
  if(serialized.length>=1024)counts.set(serialized,(counts.get(serialized)||0)+1);
  if(Array.isArray(value))value.forEach(visit);
  else if(value && typeof value==='object')Object.values(value).forEach(visit);
 };
 visit(context);interfaces.forEach(visit);
 const evidence={},ids=new Map();
 const encode=(value,inline=false)=>{
  const serialized=key(value);
  if(!inline && counts.get(serialized)>1){
   if(!ids.has(serialized)){const id=`E${ids.size+1}`;ids.set(serialized,id);evidence[id]=encode(value,true);}
   return {$evidenceRef:ids.get(serialized)};
  }
  if(Array.isArray(value))return value.map(item=>encode(item));
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,encode(item)]));
  return value;
 };
 const packedContext=encode(context),packedInterfaces=interfaces.map(item=>encode(item));
 return {context:packedContext,interfaces:packedInterfaces,evidence};
}
export function hazardPromptFits(prompt,{maxTokens=16000,preferences}={}) {
 return hazardPromptBytes(prompt)<=hazardRequestInputBudget(maxTokens,preferences);
}
export function assertHazardPromptFits(prompt,{stage,ids=[],maxTokens=16000,preferences}={}) {
 const bytes=hazardPromptBytes(prompt),limit=hazardRequestInputBudget(maxTokens,preferences);
 if(bytes<=limit)return;
 const error=new Error(`${stage || 'Hazard analysis'} input for ${ids.join(', ') || 'shared context'} is too large for the conservative request budget (${bytes.toLocaleString()} UTF-8 bytes; limit ${limit.toLocaleString()}, with ${maxTokens.toLocaleString()} output tokens reserved) after lossless evidence deduplication. No evidence was discarded; completed results are retained. This individual input needs a smaller evidence scope or a supported larger-context model.`);
 error.code='HAZARD_INPUT_TOO_LARGE';throw error;
}
export function isHazardInputLimitError(error) {
 return /prompt is too long|context[_ ]length[_ ]exceeded|maximum context length|input.*exceeds.*token.*limit/i.test(String(error?.message || ''));
}
