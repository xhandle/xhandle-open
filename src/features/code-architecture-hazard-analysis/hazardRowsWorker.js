/* global globalThis */
import {queryHazardRows} from './pagedHazardRows';
globalThis.onmessage=async({data})=>{
 try{const result=await queryHazardRows(data.run,{...data.options,onProgress:progress=>globalThis.postMessage({type:'progress',progress})});globalThis.postMessage({type:'done',result});}
 catch(error){globalThis.postMessage({type:'error',message:error.message});}
};
