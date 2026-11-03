// Only numeric workload sizes and fixed operation labels cross this boundary.
// Diagnostics are optional in browsers and cannot replace application errors.
let sequence = 0;
const lastProgress = new Map();
const countFields = ['sourceRows','resultRows','hazardRows','nodes','edges','batchStart','batchEnd','completed','total'];
function bridge() {
  try {
    if (typeof window === 'undefined' || window.xhandleDesktop?.diagnosticsEnabled === false) return null;
    return typeof window.xhandleDesktop?.recordDiagnostic === 'function' ? window.xhandleDesktop.recordDiagnostic : null;
  } catch {return null;}
}
function sizes(counts) {
  return Object.fromEntries(countFields.filter(k => Number.isFinite(counts?.[k]) && counts[k] >= 0).map(k => [k, counts[k]]));
}
export function diagnosticError(error) {
  const seen = new Set(), chain = [];
  try {
    if(error===null || (typeof error!=='object' && typeof error!=='function'))return [{name:'NonErrorThrownValue',message:String(error).slice(0,2000)}];
    for (let current = error; current && chain.length < 4 && !seen.has(current); current = current.cause) {
      seen.add(current);
      chain.push({name:String(current.name || 'Error').slice(0,80),message:String(current.message || current).slice(0,2000),code:typeof current.code==='string'?current.code.slice(0,80):undefined,stack:typeof current.stack==='string'?current.stack.slice(0,6000):undefined});
    }
  } catch {} // Hostile getters and non-Error rejections must remain harmless.
  return chain;
}
export function installDiagnosticErrorCapture(target = window) {
  if(target.xhandleDesktop?.diagnosticsEnabled===false || typeof target.xhandleDesktop?.reportFailure!=='function')return ()=>{};
  const packet=(kind,error,message,source='workspace')=>({kind,source,message:String(message||error?.message||error||'Workspace error').slice(0,2000),error:kind==='unhandled-rejection'||error!=null?diagnosticError(error):[]});
  const deliver=data=>{try{target.xhandleDesktop.reportFailure(data);}catch{}};
  const send=(...args)=>{try{deliver(packet(...args));}catch{}};
  const failed=event=>send('renderer-error',event.error,event.message);
  const rejected=event=>send('unhandled-rejection',event.reason);
  target.addEventListener('error',failed);target.addEventListener('unhandledrejection',rejected);
  const original=target.console?.error;
  let consoleCount=0,consoleSince=Date.now(),pending=null,timer;
  const flush=()=>{timer=null;const item=pending;pending=null;if(item)try{deliver(JSON.parse(item));}catch{}};
  const wrapped=function(...args){
    try{
      const error=args.find(value=>value&&typeof value==='object'&&typeof value.stack==='string');
      const message=typeof args[0]==='string'?args[0]:error?.message||'Console error';
      if(Date.now()-consoleSince>=1000){consoleSince=Date.now();consoleCount=0;}
      if(++consoleCount<=10)send('renderer-error',error,message,'console');
      // Never retain an Error (which can reference a request or an entire graph).
      else{pending=JSON.stringify(packet('renderer-error',error,message,'console'));if(!timer)timer=setTimeout(flush,1000);}
    }catch{}
    return original.apply(target.console,args);
  };
  try{if(typeof original==='function')target.console.error=wrapped;}catch{}
  return ()=>{clearTimeout(timer);try{if(target.console?.error===wrapped)target.console.error=original;}catch{}target.removeEventListener('error',failed);target.removeEventListener('unhandledrejection',rejected);};
}
export function diagnosticCheckpoint(operation, stage, counts = {}, options = {}) {
  const send = bridge();
  if (!send) return false;
  const now = Date.now();
  if (options.sampled && now - (lastProgress.get(operation) || 0) < 1000 && stage !== 'error') return false;
  if (options.sampled) {
    if(lastProgress.size>=64 && !lastProgress.has(operation))lastProgress.delete(lastProgress.keys().next().value);
    lastProgress.set(operation, now);
  }
  try {send({operation,stage,counts:sizes(counts),id:options.id,durationMs:options.durationMs,error:['error','canceled'].includes(stage)?diagnosticError(options.error):undefined});return true;}
  catch {return false;}
}
function begin(operation, counts, options) {
  if (!bridge()) return null;
  const id = `operation-${++sequence}`;
  const started = performance.now();
  const sent = diagnosticCheckpoint(operation,'start',counts,{...options,id});
  return (result,error,failed=false) => {
    const output = Array.isArray(result) ? {resultRows:result.length} : {};
    if(sent || failed)diagnosticCheckpoint(operation,failed?(error?.name==='AbortError'?'canceled':'error'):'complete',{...counts,...output},{id,durationMs:performance.now()-started,error});
  };
}
export function withDiagnosticSync(operation, counts, work, options = {}) {
  const finish=begin(operation,counts,options);
  try {const result=work();finish?.(result);return result;}
  catch(error){finish?.(null,error,true);throw error;}
}
export async function withDiagnosticOperation(operation, counts, work, options = {}) {
  const finish=begin(operation,counts,options);
  try {const result=await work();finish?.(result);return result;}
  catch(error){finish?.(null,error,true);throw error;}
}
