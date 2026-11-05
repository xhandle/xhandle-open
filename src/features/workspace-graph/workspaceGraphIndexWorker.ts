import { runWorkspaceGraphIndexPass } from './workspaceGraphMigrationCore';
import {setRemoteForegroundStorageBusy} from '../../lib/foregroundStoragePriority';
/* global globalThis */
const scope:any=globalThis;
scope.onmessage=async({data}:any)=>{
 if(data.type==='foreground-storage'){setRemoteForegroundStorageBusy(data.busy);return;}
 try{const result=await runWorkspaceGraphIndexPass({...data.options,onProgress:(value:any)=>scope.postMessage({type:'progress',value})},new Map(data.values));scope.postMessage({type:'done',result});}
 catch(error:any){scope.postMessage({type:'error',message:error?.message||String(error),name:error?.name});}
};
