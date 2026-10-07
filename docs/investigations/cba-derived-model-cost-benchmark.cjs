// Pure functions, no model/network/storage calls. Synthetic payload sizes only.
const fs=require('fs'),Module=require('module'),babel=require('@babel/core');
const path=require('path');
const filename=path.resolve('src/features/code-architecture-context/functionalModel.js');
const m=new Module(filename,module);m.filename=filename;m.paths=module.paths;
m._compile(babel.transformFileSync(filename,{babelrc:false,configFile:false,plugins:['@babel/plugin-transform-modules-commonjs']}).code,filename);
const {processFunctionalModel,functionalModelIsReady,buildFunctionalModelRows,functionalSourceIndex,immutableFunctionalRows}=m.exports;
const measure=fn=>{const samples=[];for(let i=0;i<6;i++){const start=performance.now();fn();samples.push(performance.now()-start);}return {medianMs:samples.sort((a,b)=>a-b)[3],maxMs:Math.max(...samples)};};
(async()=>{
 const results=[];
 for(const count of [1000,5000,10000]) {
 const rows=Array.from({length:count},(_,i)=>({from:`function_${Math.floor(i/10)}`,to:`operation_${i}`,fromFile:'component.cpp',toFile:'component.cpp',action:'Call',traceId:`raw-${i}`,rowRef:i+1,fromDetails:'Evaluate operational state. '.repeat(20),toDetails:'Transform observed values. '.repeat(20),controlActionDetails:'Supplied operational information. '.repeat(20),sourceEvidence:{functions:[{functionName:'caller',filePath:'component.cpp',startLine:i+1,endLine:i+2}]},architecture:{subsystem:'System',csci:'Software',csc:`Component ${Math.floor(i/10)}`,csu:'Unit'}}));
 const annotated=await processFunctionalModel(rows,{request:async prompt=>{
 const evidence=JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
 return {function:{name:'Evaluate state',description:'Evaluate operational state.',significance:'meaningful'},relationships:evidence.map(e=>({index:e.index,significance:e.index%10===0?'meaningful':'implementation',disposition:e.index%10===0?'interaction':'internal',target:{name:'Consume state',description:'Use current operational state.'},kind:'data',action:'Operational state',description:'Observed current state.',rationale:'Synthetic classification fixture.'}))};
 }});
 immutableFunctionalRows(annotated);
 const coldStart=performance.now();
 const model=buildFunctionalModelRows(annotated),trace=model.find(r=>!r.functionalModel.internal).traceId;
 const coldDerivationMs=performance.now()-coldStart;
 results.push({count,coldDerivationMs,rawMiB:Buffer.byteLength(JSON.stringify(rows))/1048576,annotatedMiB:Buffer.byteLength(JSON.stringify(annotated))/1048576,functionalRows:model.length,readiness:measure(()=>functionalModelIsReady(annotated)),build:measure(()=>buildFunctionalModelRows(annotated)),singleLinkLookup:measure(()=>functionalSourceIndex(annotated,trace)),layoutScopeSerialization:measure(()=>JSON.stringify(annotated))});
 }
 console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exit(1);});
