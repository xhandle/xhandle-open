import {getStoredActiveAIProvider,getStoredAIProviderModelPreference} from '../../lib/aiProviderConfig';

// This is a batch scheduling target, not a hard limit for a single source.
// Request admission uses a separate conservative envelope below.
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

// Application admission budgets, deliberately below large-context provider limits.
// These are NOT advertised model capacities. Unknown/custom models keep the old
// conservative allowance. Count UTF-8 bytes (at most one token per byte for the
// supported byte-based tokenizers), not the optimistic four-chars/token heuristic.
// Reserve both the requested output (including thinking) and wrapper overhead.
export function hazardRequestInputBudget(maxTokens=16000, preferences) {
  const provider=preferences?.provider || getStoredActiveAIProvider();
  const model=preferences?.model || getStoredAIProviderModelPreference(provider,{includeDefault:true}) || '';
  const knownClaude=['anthropic','claude'].includes(provider) && /^claude-(?:haiku|sonnet|opus|fable|mythos)-(?:4|5)(?:[.-]|$)/.test(model);
  const envelope=knownClaude?200000:120000+16000+8192;
  return Math.max(0,envelope-Math.max(0,Number(maxTokens)||0)-8192);
}
export function hazardPromptBytes(prompt) {
  // Blob/TextEncoder availability varies in tests and older browsers.
  let bytes=0;
  for(const character of prompt){const point=character.codePointAt(0);bytes+=point<=0x7f?1:point<=0x7ff?2:point<=0xffff?3:4;}
  return bytes;
}
