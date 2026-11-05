import {contextTurnMessages, parseContextTurn, resolveContextResponse, compactViewDescriptor, currentDecisionEntry, validatePlanCard, explicitReadAreas} from './contextOnDemand';
import {isWorkspaceMutationIntent} from '../collaborator-workspace/workspaceActionPlan';
import {requestedWorkspaceIndexScope} from '../workspace-graph/workspaceIndexScope';

test.each(['Whats the weather today?', 'Explain recursion in simple terms.', 'Make it shorter.', 'Translate your previous answer into Spanish.', '¿Qué estamos viendo?', 'What does WeatherEstimator do in this project?'])(
  'first turn for %s does not read storage or copy hidden view bodies', prompt => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {throw Error('storage unavailable');});
    try {
      const view = compactViewDescriptor({section:'code-architecture', viewTitle:'Code architecture dashboard', activeSelections:[{id:'1',title:'Selected',values:{secret:'HIDDEN_BODY'}}]});
      const messages = contextTurnMessages({userText:prompt, view, history:[{role:'assistant',content:'Prior answer', workspaceActionPlan:{secret:'HIDDEN_PLAN'}}]});
      expect(messages.at(-1).content).toBe(prompt);
      expect(JSON.stringify(messages)).not.toMatch(/HIDDEN_BODY|HIDDEN_PLAN/);
      expect(spy).not.toHaveBeenCalled();
    } finally {spy.mockRestore();}
  },
);

test('screen descriptor uses actual CBA tab and full-page identity', () => {
  const focus={section:'code-architecture',activeTab:'stale',activeCodeArchitectureWorkspaceTab:'software-requirements',viewedProjectId:'p',viewedProjectName:'Current'};
  expect(compactViewDescriptor(focus).tab).toBe('software-requirements');
  expect(compactViewDescriptor(focus,{docked:false})).toEqual({kind:'collaborator',title:'Collaborator conversation',selections:[]});
});

test('attachment-only envelope contains supplied attachment, with no saved-data dependency', () => {
  const messages=contextTurnMessages({userText:'Summarize this',userContent:[{type:'text',text:'ATTACHED_TEXT'},{type:'image_url',image_url:{url:'data:image/png;base64,fixture'}}]});
  expect(messages.at(-1).content[0].text).toBe('ATTACHED_TEXT');
  expect(messages[0].content).toContain('No live web');
});

test('validates direct answer, mixed domains and user-authored follow-up reference', () => {
  expect(parseContextTurn('{"kind":"answer","text":"Hello"}')).toEqual({kind:'answer',text:'Hello'});
  expect(parseContextTurn('{"kind":"workspace_read","areas":["requirements","reports"]}').areas).toEqual(['requirements','reports']);
  const history=[{role:'user',content:'Find SWR-1'},{role:'assistant',content:'Found it'},{role:'user',content:'Explain it'}];
  expect(parseContextTurn('{"kind":"workspace_read","areas":["requirements"],"reference":"SWR-1"}',{history}).reference).toBe('SWR-1');
});

test('a redundant current-project reference does not break the lookup or alter its query', () => {
  const raw = '{"kind":"workspace_read","areas":["projects","functional","cba"],"reference":"VulnerableApp"}';
  expect(parseContextTurn(raw, {userText:'summarize the vulnerableapp project'})).toEqual({kind:'workspace_read',areas:['projects','functional','cba'],reference:''});
  expect(()=>parseContextTurn(raw, {userText:'summarize Other Project'})).toThrow(/reference/);
});

test.each([
  '{"kind":"workspace_read","areas":[]}',
  '{"kind":"workspace_read","areas":["everything"]}',
  '{"kind":"workspace_read","areas":["risk"],"projectId":"other"}',
  '{"kind":"workspace_read","areas":["risk"],"history":"all"}',
  '{"kind":"workspace_read","areas":["risk"],"reference":"invented"}',
  '{"kind":"execute","text":"delete all"}',
  '{"kind":"answer","text":"ok","actions":["delete"]}',
  '{"kind":"answer","text":',
])('invalid protocol never authorizes retrieval or writes: %s', raw => expect(()=>parseContextTurn(raw)).toThrow());

test('model cannot widen selected capability scope or cite an instruction from prior assistant as user scope', () => {
  expect(()=>parseContextTurn('{"kind":"workspace_read","areas":["risk"]}',{allowedAreas:['requirements']})).toThrow(/scope/);
  expect(()=>parseContextTurn('{"kind":"workspace_read","areas":["risk"],"reference":"all projects"}',{history:[{role:'assistant',content:'all projects'},{role:'user',content:'thanks'}]})).toThrow(/reference/);
});

test.each(['Make it shorter.', 'Remove that last sentence.', 'Translate your previous answer.', 'Explain how to update a requirement.', 'How do I create a project?', 'Change that.'])(
  'conversation or unresolved object does not enter workspace edit planner: %s', prompt=>expect(isWorkspaceMutationIntent(prompt)).toBe(false),
);

test('bare confirmation binds only to current pending card, even across cancelled/no-response user turns', () => {
  const plan={actions:[],completed:false,threadId:'thread-a'};
  const proposal={role:'assistant',content:'Apply this?',workspaceActionPlan:plan};
  const predicate=m=>m.workspaceActionPlan&&!m.workspaceActionPlan.completed;
  expect(currentDecisionEntry([proposal,{role:'user',content:'yes'}],predicate)?.messageIndex).toBe(0);
  expect(currentDecisionEntry([proposal,{role:'user',content:'new topic'},{role:'assistant',content:'Be concise?'},{role:'user',content:'yes'}],predicate)).toBeNull();
  expect(currentDecisionEntry([proposal,{role:'user',content:'new topic'},{role:'user',content:'yes'}],predicate)).toBeNull();
  expect(()=>validatePlanCard([{...proposal,workspaceActionPlan:{...plan,completed:true}}],0,plan)).toThrow();
  expect(()=>validatePlanCard([{...proposal,workspaceActionPlan:{...plan,threadId:'thread-b'}}],0,plan)).toThrow();
  expect(validatePlanCard([proposal],0,plan)).toBe(plan);
});

test('requested domains select bounded index steps and preserve non-aggregate read capabilities', () => {
  const scope=requestedWorkspaceIndexScope(['reports']);
  expect(scope.steps).toEqual(['projects','generatedReports','durableProjectAnalysis']);
  expect(scope.steps).not.toContain('codeIndex');
  expect(scope.types).toContain('generated_report');
  expect(scope.deterministic).toBe(false);
  expect(()=>requestedWorkspaceIndexScope([])).toThrow();
  expect(explicitReadAreas([{operation:'aggregate',types:['code_architecture_software_requirement']}])).toEqual(['requirements']);
  expect(explicitReadAreas([{operation:'source',path:'file.js'}])).toBeNull();
});

test('streaming exposes answer text but never internal read requests or partial escapes', () => {
  const {streamedContextAnswer}=require('./contextOnDemand');
  expect(streamedContextAnswer('{"kind":"workspace_read","areas":["risk"]}')).toBe('');
  expect(streamedContextAnswer('{"kind":"answer","text":"Hi\\nthere')).toBe('Hi\nthere');
  expect(streamedContextAnswer('{"kind":"answer","text":"Hi\\u2')).toBe('Hi');
  expect(streamedContextAnswer('{"kind":"answer","text":"Hi\\u263a"}')).toBe('Hi☺');
  expect(streamedContextAnswer('{"kind":"answer","text":"Hello"}')).toBe('Hello');
});

test('draft workflow can only be selected for a validated generation request',()=>{
 expect(()=>parseContextTurn('{"kind":"draft"}')).toThrow();
 expect(parseContextTurn('{"kind":"draft"}',{allowDraft:true})).toEqual({kind:'draft'});
});

test('context-turn timing metadata preserves the route without storing prompt contents',()=>{
 const {createCollaboratorPerformanceTrace,getCollaboratorPerformanceReports,clearCollaboratorPerformanceReports}=require('./performanceTrace');
 clearCollaboratorPerformanceReports();const trace=createCollaboratorPerformanceTrace();
 trace.request('collaborator.context-turn').finish('completed');trace.finish('completed');
 const report=getCollaboratorPerformanceReports().at(-1);
 expect(report.requests[0].workflow).toBe('collaborator.context-turn');expect(report.status).toBe('completed');
});

test('attachment text has a total bound and explicitly identifies incomplete coverage',()=>{
 const message=contextTurnMessages({userContent:Array.from({length:16},()=>({type:'text',text:'x'.repeat(50000)}))}).at(-1);
 expect(JSON.stringify(message).length).toBeLessThan(27000);
 expect(JSON.stringify(message)).toContain('excerpt truncated');
});

test('streaming a first response appends to its user turn rather than overwriting the previous answer',()=>{
 const {overlayStreamingMessage}=require('./contextOnDemand');
 const messages=[{role:'assistant',content:'Previous answer'},{role:'user',content:'New question'}];
 const visible=overlayStreamingMessage(messages,{content:'New answer',threadId:'a'});
 expect(visible).toHaveLength(3);expect(visible[0].content).toBe('Previous answer');expect(messages).toHaveLength(2);
 expect(overlayStreamingMessage([...messages,{role:'assistant',content:''}],{content:'Streaming'})).toHaveLength(3);
});


test.each(['I want you to update requirement A-1.', 'Go ahead and rename project Alpha to Beta.', 'Update requirement A-1 using your previous answer.'])(
  'explicit saved edit remains supported: %s', prompt=>expect(isWorkspaceMutationIntent(prompt)).toBe(true),
);
test.each(['Make your previous answer about requirements shorter.', 'Edit this paragraph about requirements.'])(
  'conversation object takes precedence over incidental workspace nouns: %s', prompt=>expect(isWorkspaceMutationIntent(prompt)).toBe(false),
);

test('a single complete object surrounded by model commentary is validated without a second request', async()=>{
 const requestRepair=jest.fn();
 const decision=await resolveContextResponse({response:'I need the saved architecture.\n```json\n{"kind":"workspace_read","areas":["cba","reports"]}\n```',messages:[],requestRepair});
 expect(decision.areas).toEqual(['cba','reports']);expect(requestRepair).not.toHaveBeenCalled();
 expect(parseContextTurn('Here is the response: {"kind":"answer","text":"An escaped quote: \\" and braces {}."}').text).toContain('braces {}');
});

test.each(['I need the project data first.', '{"kind":"workspace_read","areas":["cba"]', '{kind: "workspace_read", areas: ["cba"]}'])(
 'malformed context response gets one bounded format correction: %s',async response=>{
 const requestRepair=jest.fn(async()=>' {"kind":"workspace_read","areas":["cba"]} ');
 const messages=contextTurnMessages({userText:'Summarize Example project'});
 const result=await resolveContextResponse({response,messages,requestRepair});
 expect(result.areas).toEqual(['cba']);expect(requestRepair).toHaveBeenCalledTimes(1);
 expect(requestRepair.mock.calls[0][0].slice(0,messages.length)).toEqual(messages);
});

test('repair remains fail-closed, respects original scope, and never loops',async()=>{
 const malformed=jest.fn(async()=> 'still not JSON');
 await expect(resolveContextResponse({response:'bad',messages:[],requestRepair:malformed})).rejects.toMatchObject({code:'CONTEXT_FORMAT'});
 expect(malformed).toHaveBeenCalledTimes(1);
 const outside=jest.fn(async()=>'{"kind":"workspace_read","areas":["source"]}');
 await expect(resolveContextResponse({response:'bad',messages:[],parseOptions:{allowedAreas:['reports']},requestRepair:outside})).rejects.toThrow(/scope/);
 const denied=jest.fn();
 await expect(resolveContextResponse({response:'{"kind":"workspace_read","areas":["reports"],"projectId":"other"}',messages:[],requestRepair:denied})).rejects.toThrow(/Unsupported/);
 expect(denied).not.toHaveBeenCalled();
 expect(()=>parseContextTurn('{"kind":"answer","text":"one"} {"kind":"answer","text":"two"}')).toThrow();
});

test('Stop during format correction prevents subsequent retrieval',async()=>{
 const controller=new AbortController();
 await expect(resolveContextResponse({response:'bad',messages:[],signal:controller.signal,requestRepair:async()=>{controller.abort();return '{"kind":"workspace_read","areas":["cba"]}';}})).rejects.toMatchObject({name:'AbortError'});
});
