import {isCasualConversation,isGeneralKnowledgeQuestion} from './conversationRouting';

test('plain greetings and thanks do not require workspace data', () => {
  for (const text of ['hey','Hi!','Hello there...','good morning','How are you?','Thanks so much!','thank you','bye']) expect(isCasualConversation(text)).toBe(true);
});

test('general explanations bypass indexing but questions about saved records do not',()=>{
  for(const text of ['What is a software requirement?','What are system requirements?','How should I write requirements?','Explain the concept of traceability.']) expect(isGeneralKnowledgeQuestion(text)).toBe(true);
  for(const text of ['What is our software requirement?','What is the difference between SWR-1 and SWR-2?','Explain what this hazard means.','What is a project?','Why is that requirement incomplete?','Explain what Launch does.','What is a hazard with ID CUSTOM-92?','How should I create Launch?']) expect(isGeneralKnowledgeQuestion(text)).toBe(false);
  expect(isGeneralKnowledgeQuestion('What is a software requirement?',{hasAttachments:true})).toBe(false);
  expect(isGeneralKnowledgeQuestion('What is a software requirement?',{hasExplicitProject:true})).toBe(false);
});

test('questions, edits, attached greetings and pending decisions keep workspace grounding', () => {
  for (const text of ['hey, how many requirements are there?','hi show this row','thanks, apply it','hello\nreview the hazards','yes','continue','what about this?','review the selected function','How are you deriving requirements?']) expect(isCasualConversation(text)).toBe(false);
  expect(isCasualConversation('hey',{hasAttachments:true})).toBe(false);
  expect(isCasualConversation('thanks',{hasPendingDecision:true})).toBe(false);
});
