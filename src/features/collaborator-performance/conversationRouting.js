// Only unmistakable social messages bypass workspace grounding. An engineering
// question, attachment, follow-up decision or edit continues through normal tools.
export function isCasualConversation(prompt, {hasAttachments = false, hasPendingDecision = false} = {}) {
  if (hasAttachments || hasPendingDecision || typeof prompt !== 'string' || prompt.length > 80) return false;
  const text = prompt.normalize('NFKC').trim().replace(/[.!?,…]+$/u, '').trim();
  return /^(?:(?:hey|hi|hello|hiya|howdy)(?:\s+(?:there|collaborator|xhandle))?|good\s+(?:morning|afternoon|evening)|how\s+are\s+you(?:\s+doing)?|thanks(?:\s+(?:a lot|so much))?|thank\s+you(?:\s+(?:so much|very much))?|you(?:'|’)re\s+welcome|bye|goodbye)$/iu.test(text);
}

export const CASUAL_CONVERSATION_CONTEXT = 'You are xHandle Collaborator. Reply naturally and briefly to this social message using ordinary conversation history. Saved workspace data has not been loaded for this turn; do not make claims about project contents or infer that data is absent.';

export function isGeneralKnowledgeQuestion(prompt, {hasAttachments=false,hasPendingDecision=false,hasExplicitProject=false}={}) {
  if (hasAttachments || hasPendingDecision || hasExplicitProject || typeof prompt !== 'string') return false;
  const subject='(?:software requirements?|system requirements?|subsystem requirements?|requirements?|hazards?|hazard analysis|unsafe control actions?|functional decomposition|traceability)';
  const text=prompt.normalize('NFKC').trim().replace(/[.!?]+$/,'').trim();
  // Match complete, generic questions. An arbitrary “explain what …” prefix
  // can introduce a named function or custom record ID that needs saved data.
  return new RegExp(`^(?:what is (?:a|an) ${subject}|what are ${subject}|what is the difference between ${subject} and ${subject}|how (?:do|should) (?:i|we|you) (?:write|define|create) (?:(?:a|an) )?${subject}|explain (?:the concept of ${subject}|what (?:a|an) ${subject} (?:is|means)|what ${subject} (?:are|means)))$`,'i').test(text);
}

export const GENERAL_KNOWLEDGE_CONTEXT = 'You are xHandle Collaborator. Answer this general explanatory question directly using conversation history and general knowledge. No saved workspace records were loaded for this turn. Do not invent project facts or infer that workspace data is absent.';
