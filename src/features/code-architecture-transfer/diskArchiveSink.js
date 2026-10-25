import { sha256 } from 'hash.js';
import { backendURL } from '../../lib/api/backendConfig';

// A single bounded upload is outstanding at a time. The complete file never becomes a renderer Blob.
export async function createDiskArchiveSink(name, {signal, baseURL=backendURL, fetchImpl=fetch} = {}) {
  const base=new URL(baseURL);
  if (!(base.protocol==='xhandle:' && base.hostname==='app') &&
      !(['http:','https:'].includes(base.protocol) && ['localhost','127.0.0.1','[::1]'].includes(base.hostname))) {
    throw new Error('Project export needs the local xHandle server. Workspace data was not sent to a remote server.');
  }
  const endpoint=String(baseURL).replace(/\/$/,'')+'/api/project-transfer-files';
  const request=async(url,options={}, abortSignal=signal)=>{
    const controller=new AbortController();
    const stop=()=>controller.abort(abortSignal?.reason);
    if(abortSignal?.aborted)stop();else abortSignal?.addEventListener('abort',stop,{once:true});
    const timer=setTimeout(()=>controller.abort(new Error('Local export server timed out.')),60000);
    try{
      const response=await fetchImpl(url,{...options,signal:controller.signal});
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error || 'Local export server unavailable. Restart the updated local server and retry.');}
      return response.status===204?null:await response.json();
    }finally{clearTimeout(timer);abortSignal?.removeEventListener('abort',stop);}
  };
  const session=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
  if(!/^[a-f0-9]{64}$/.test(session.id))throw new Error('Invalid local export session.');
  const url=endpoint+'/'+session.id,encoder=new TextEncoder(),hash=sha256();
  let pending=[],size=0,bytes=0,chunks=0,closed=false;
  const flush=async()=>{
    if(!size)return;
    const body=new Uint8Array(size);let offset=0;for(const part of pending){body.set(part,offset);offset+=part.length;}
    const result=await request(url+'/chunks/'+chunks,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body});
    if(result.next!==chunks+1 || result.bytes!==bytes+size)throw new Error('Local export write was not acknowledged correctly.');
    hash.update(body);bytes+=size;chunks++;pending=[];size=0;
  };
  const dispose=async()=>{closed=true;pending=[];size=0;await request(url,{method:'DELETE'},null);};
  return {
    async write(text){
      if(closed)throw new Error('Export file is closed.');
      const data=encoder.encode(text);
      // Serialized archive lines are bounded, but split again for transport guarantees.
      for(let offset=0;offset<data.length;offset+=262144){const part=data.subarray(offset,offset+262144);if(size+part.length>262144)await flush();pending.push(part);size+=part.length;if(size===262144)await flush();}
    },
    async finish(){
      if(closed)throw new Error('Export file is closed.');await flush();
      const result=await request(url+'/finish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bytes,chunks,digest:hash.digest('hex')})});
      closed=true;
      return {url:url+'/download',name:result.name,bytes:result.bytes,dispose};
    },
    abort:dispose,
  };
}
