import {isApplicableHazardNarrative} from './hazardFieldContract';
// Observers must never own the success/failure of an analysis.
export const safeHazardObserver = callback => (...args) => {
 try { const result=callback?.(...args); if(result?.catch)result.catch(()=>{}); } catch {}
};

// Original noncanonical/invalid imported fields remain available verbatim.
// Invalid fields are not constraints on
// a newly generated assessment. Valid reviewed applicability is never removed.
export function usableHazardInputs(values={},method) {
 const usable={...values},retained={};
 const ratings={Severity:/^S[0-3]$|^I{1,3}$|^IV$/,'Severity Category':/^I{1,3}$|^IV$/,Exposure:/^E[0-4]$/,Controllability:/^C[0-3]$/,'Software Control Category':/^[1-5]$/};
 for(const [header,value] of Object.entries(usable)){
  const text=String(value ?? '').trim();
  let invalid=ratings[header]?!ratings[header].test(text):!isApplicableHazardNarrative(value);
  if(header==='Severity' && method==='HARA')invalid=!/^S[0-3]$/.test(text);
  if(header==='Severity' && method==='FHA')invalid=!/^(I|II|III|IV)$/.test(text);
  if(header==='Guide Phrase Applicable')invalid=!['Yes','No'].includes(text);
  if(header==='Guide Phrase Applicability Rationale')invalid=false;
  if(header==='Safety Classification')invalid=!['Safety — Direct','Safety — Related','Mission/Reliability'].includes(text);
  if(header==='Safety Significant')invalid=!['Yes','No'].includes(text);
  if(header==='Software Safety Requirement')invalid=invalid || !/\bshall\b/i.test(text);
  if(invalid){retained[header]=value;delete usable[header];}
  else if(ratings[header] || ['Guide Phrase Applicable','Safety Classification','Safety Significant'].includes(header)){
   // Validate and consume the same representation. Never let padding or numeric
   // SCC values pass cleanup only to fail strict downstream rating derivation.
   usable[header]=text;
   if(value!==text)retained[header]=value;
  }
 }
 if(usable['Safety Classification'] && usable['Safety Significant'] &&
    usable['Safety Significant']!==(usable['Safety Classification']==='Mission/Reliability'?'No':'Yes')){
  retained['Safety Significant']=usable['Safety Significant'];delete usable['Safety Significant'];
 }
 return {usable,retained};
}
