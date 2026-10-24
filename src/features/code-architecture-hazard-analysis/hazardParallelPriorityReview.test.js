import {generateFastHazards} from './resultsFirstHazardPipeline';

// A programming failure must interrupt, even if a parallel provider request fails.
const cases=['STPA','HARA','FHA'].flatMap(method=>['screening','generation'].flatMap(stage=>[ReferenceError,RangeError,TypeError].flatMap(ErrorType=>[true,false].map(providerFirst=>({method,stage,ErrorType,providerFirst})))));
test.each(cases)('$method $stage $ErrorType.name interrupts (provider first: $providerFirst)',async({method,stage,ErrorType,providerFirst})=>{
 const provider=Object.assign(new Error('Denied'),{status:403});
 const programming=new ErrorType('Missing analysis dependency');
 const pending=[],diagnostics=[];
 const request=()=>new Promise((resolve,reject)=>pending.push(reject));
 const sources=Array.from({length:stage==='screening'?49:9},(_,i)=>({id:`HA-${i}`,action:'Apply torque',phrase:'Too late',...(stage==='generation'?{reviewedApplicability:'Yes',reviewedRationale:'Reviewed'}:{})}));
 sources.unshift({id:'accepted',action:'Excluded',phrase:'Too late',reviewedApplicability:'No',reviewedRationale:'Reviewed exclusion'});
 const outcome=generateFastHazards({method,sources,context:{},request,applicabilityRequest:request,
  checkpoint:{readMany:async bases=>bases.map(()=>undefined),writeMany:async()=>{}},
  onMetrics:()=>{},onDiagnostic:event=>diagnostics.push(event),
 }).then(rows=>({rows}),error=>({error}));
 for(let i=0;i<100 && pending.length<2;i++)await new Promise(resolve=>setTimeout(resolve,0));
 expect(pending).toHaveLength(2);
 pending[0](providerFirst?provider:programming);
 await new Promise(resolve=>setTimeout(resolve,0));
 pending[1](providerFirst?programming:provider);
 const result=await outcome;
 expect(result.error).toMatchObject({name:ErrorType.name,cause:programming});
 expect(result.rows).toBeUndefined();
 expect(result.error.partialResults.map(row=>row.id)).toEqual(['accepted']);
 expect(diagnostics.some(event=>event.event==='assumption-based-completion')).toBe(false);
});

test.each([ReferenceError,RangeError,TypeError])('final fallback rejects $name even with provider-status metadata',async ErrorType=>{
 const failure=Object.assign(new ErrorType('Invalid dependency'),{status:403});
 const diagnostics=[];
 await expect(generateFastHazards({method:'STPA',sources:[{id:'HA-1',action:'Apply torque',phrase:'Too late',reviewedApplicability:'Yes',reviewedRationale:'Reviewed'}],context:{},
  request:async()=>{throw failure;},checkpoint:{readMany:async bases=>bases.map(()=>undefined),writeMany:async()=>{}},
  onMetrics:()=>{},onDiagnostic:event=>diagnostics.push(event),
 })).rejects.toMatchObject({name:ErrorType.name,cause:failure});
 expect(diagnostics.some(event=>event.event==='assumption-based-completion')).toBe(false);
});
