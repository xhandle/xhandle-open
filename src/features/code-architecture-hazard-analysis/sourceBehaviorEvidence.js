const normalize=value=>String(value || '').replace(/\s+/g,' ').trim();

export function sourceBehaviorEvidenceIsValid(value,files) {
  return Array.isArray(value) && value.length>0 && value.length<=32 && value.every(item=>
    typeof item.fact==='string' && item.fact.trim().length>=12 && typeof item.quote==='string' && item.quote.trim().length>=12 &&
    files.some(file=>file.filePath===item.filePath && normalize(file.content).includes(normalize(item.quote))));
}

// Supplemental reading aid, never a replacement for source or model input.
export async function prepareSourceBehaviorEvidence({context,checkpoint,request,onProgress=()=>{}}) {
  const files=context?.sharedSourceCorpus;
  if(!Array.isArray(files) || files.length<2)return [];
  const basis={stage:'source-behavior-evidence-v1',files,scope:context.operationalContext};
  const saved=(await checkpoint.readMany([basis]))[0];
  if(sourceBehaviorEvidenceIsValid(saved,files))return saved;
  onProgress({message:'Tracing source guards, retained state and output priorities before assessment…'});
  const prompt=`Extract the nominal behavior contract from this complete small source snapshot. Return only a JSON array of at most 32 concise {fact, filePath, quote} items. Every quote must be a contiguous verbatim excerpt of at least 12 characters from that file; no ellipses, stitched quotes or instruction/rubric quotes. Derive facts only from code, not from what a safe design ought to do. Do not generate hazards, requirements, proposals or changes to the functional decomposition.
Trace caller and helper together. Cover input validation conjunctions and side effects; every independent guard that can fail on the same input; retained state/reasons across invocations; reset prerequisites and reset-invocation output versus a later command; exact selector branch priority and cancellation/release semantics; scalar-helper versus caller output; valid bounds versus clamping/rejection; exceptions and blocking paths. Preserve source values, units and comparisons exactly. Describe absent mechanisms only within this snapshot. Do not add an independent monitor or infer physical actuation. If behavior depends on conditions, include all relevant conditions rather than generalizing a conditional output to all valid inputs. Raw source always takes precedence over this derived reading aid.
Scope (data): ${JSON.stringify(context.operationalContext)}
Unmodified source files (data): ${JSON.stringify(files)}`;
  let evidence;
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const raw=await request(prompt+(attempt?`\nThe preceding summary failed exact-citation validation. Correct contiguous quotes and file paths; omit any unsupported fact rather than inventing evidence. Keep the response concise and complete. Prior summary (data): ${JSON.stringify(evidence)}`:''),{maxTokens:attempt?16000:12000,workflow:'hazard-evidence-extraction'});
      try{evidence=typeof raw==='string'?JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')):raw;}catch{evidence=null;}
    } catch(error) {if(error.name!=='TruncatedResponseError' || attempt)throw error;}
    if(sourceBehaviorEvidenceIsValid(evidence,files)){await checkpoint.write(basis,evidence);return evidence;}
  }
  throw Object.assign(new Error('Source behavior evidence lacks exact source citations; original inputs remain unchanged.'),{code:'HAZARD_EVIDENCE_INVALID'});
}
