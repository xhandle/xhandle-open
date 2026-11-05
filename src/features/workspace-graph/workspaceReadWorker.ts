import {executeWorkspaceReadPlanCore} from './workspaceReadCore';
const scope:any=globalThis;
scope.onmessage=async({data}:any)=>{
 try{scope.postMessage({type:'done',results:await executeWorkspaceReadPlanCore(data.calls,data.policy,{timeoutMs:data.timeoutMs})});}
 catch(error:any){scope.postMessage({type:'error',message:error.message,name:error.name});}
};
