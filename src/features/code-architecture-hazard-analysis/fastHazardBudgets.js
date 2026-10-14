import {getStoredActiveAIProvider,getStoredAIProviderModelPreference} from '../../lib/aiProviderConfig';

// Character estimates are scheduling heuristics, not provider token counts.
// Keep a total input ceiling and an independent output/reasoning allowance.
export const MAX_HAZARD_INPUT_CHARS=120000;
export const REVIEW_OUTPUT_TOKENS=8000;
export const REVIEW_RETRY_OUTPUT_TOKENS=16000;
export const hazardInputLimit=(fixedChars,variableChars)=>Math.min(MAX_HAZARD_INPUT_CHARS,fixedChars+variableChars);

export function createGenerationBudget() {
  const provider=getStoredActiveAIProvider();
  const model=getStoredAIProviderModelPreference(provider,{includeDefault:true}) || '';
  // Haiku 5.5 supports this allowance; retain the existing ceiling for other
  // providers/models (including those whose output maximum is 16K).
  const maxTokens=/claude-haiku-5-5(?:$|[-:])/.test(model)?24000:14000;
  let rowChars=6000,largestObserved=0;
  return {
    maxTokens,
    get rows(){return Math.max(1,Math.min(16,Math.floor((maxTokens-4000)*3/rowChars)));},
    observe(rows){
      // Exclusions are much shorter: do not let them inflate the capacity for
      // later Yes rows. Use the largest full answer with additional headroom.
      const sizes=rows.filter(row=>row?.applicable==='Yes').map(row=>JSON.stringify(row).length);
      if(sizes.length){
        largestObserved=Math.max(largestObserved,...sizes);
        rowChars=Math.max(1800,Math.ceil(largestObserved*1.2));
      }
    },
  };
}
