/* global globalThis */
import {buildCodeArchitectureHazardCsvDraft} from './codeArchitectureHazardCsv';
// No provider calls or persistence: this worker only prepares the local table.
globalThis.onmessage=({data})=>{
 let lastProgress=-1;
 const report=progress=>{
  if(progress!==lastProgress){lastProgress=progress;globalThis.postMessage({type:'progress',progress});}
 };
 try{globalThis.postMessage({run:buildCodeArchitectureHazardCsvDraft(data.options,data.headers,report)});}
 catch(error){globalThis.postMessage({error:error.message || String(error)});}
};
