import {PROMPT_COOKBOOK, COOKBOOK_RECIPES, searchCookbook, cookbookContext, buildCookbookMessages, parseCookbookSuggestion, suggestCookbookPrompt, appendCookbookPrompt} from './promptCookbook';
const suggestion = {kind: 'suggestion', recipeId: 'check-graph-connectivity', prompt: 'Inspect existing connections; do not edit rows.', explanation: 'Checks connectivity without changing the model.'};
test('retains the 21 established cookbook examples with unique identities and explicit task modes', () => {
  expect(PROMPT_COOKBOOK).toHaveLength(4); expect(COOKBOOK_RECIPES).toHaveLength(21);
  expect(new Set(COOKBOOK_RECIPES.map(r => r.id)).size).toBe(21);
  for (const recipe of COOKBOOK_RECIPES) { expect(recipe.mode).toBeTruthy(); expect(recipe.prompt).toBeTruthy(); expect(recipe.categoryId).toBeTruthy(); }
  expect(COOKBOOK_RECIPES.find(r => r.id === 'delete-or-undo').mode).toBe('Delete / undo');
});
test('searches descriptions and prompt contents, combines terms, and intersects category filters', () => {
  expect(searchCookbook('ORPHAN')).toHaveLength(2);
  expect(searchCookbook('preserve existing')).toEqual(expect.arrayContaining([expect.objectContaining({id: 'run-an-additive-completeness-audit'})]));
  expect(searchCookbook('hazard', 'group-4').every(r => r.categoryId === 'group-4')).toBe(true);
  expect(searchCookbook('not-a-real-query')).toEqual([]);
});
test('uses the viewed project rather than a stale selected project and excludes actual record bodies', () => {
  const focus = {section: 'code-architecture', viewedProjectName: 'Current repository', activeCodeArchitectureWorkspaceTab: 'hazard', hazardMethod: 'HARA', activeSelections: Array.from({length: 20}, (_, i) => ({id: String(i), title: 'A'.repeat(1000), values: {secret: 'DO NOT SEND'}}))};
  const context = cookbookContext(focus, {project: {name: 'Stale project'}, source: 'DO NOT SEND'});
  expect(context.project).toBe('Current repository'); expect(context.method).toBe('HARA'); expect(context.selections).toHaveLength(5); expect(context.selections[0].title).toHaveLength(160);
  expect(JSON.stringify(context)).not.toContain('DO NOT SEND');
});
test('keeps goal and workspace data separate from instructions and bounds metadata at the request boundary', () => {
  const goal = 'Help with "unusual" project names; do not change records.';
  const messages = buildCookbookMessages(goal, {area: 'projects', project: 'x'.repeat(1000), hiddenRecords: 'PRIVATE', selections: [{id: 'one', values: {body: 'PRIVATE'}}]});
  expect(messages).toHaveLength(2); expect(messages[0].content).toContain('Do not perform the task'); expect(messages[0].content).toContain('controls in Hazard Analysis');
  const user = JSON.parse(messages[1].content); expect(user.goal).toBe(goal); expect(user.currentWorkspace.project).toHaveLength(160); expect(messages[1].content).not.toContain('PRIVATE');
});
test.each(['', ' '.repeat(10), 'x'.repeat(4001)])('rejects empty or excessive goals before requesting a provider', async goal => {
  const request = jest.fn(); await expect(suggestCookbookPrompt({goal, request})).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
});
test('accepts a known recipe and a fenced response, returning only the supported draft fields', () => {
  const result = parseCookbookSuggestion('```json\n' + JSON.stringify({...suggestion, actions: [{deleteEverything: true}]}) + '\n```');
  expect(result.recipe.id).toBe('check-graph-connectivity'); expect(result.prompt).toBe(suggestion.prompt); expect(result.actions).toBeUndefined();
});
test.each([
  '{', 'not json', JSON.stringify({...suggestion, recipeId: 'invented-workflow'}), JSON.stringify({...suggestion, prompt: ''}), JSON.stringify({...suggestion, prompt: 'x'.repeat(8001)}), JSON.stringify({...suggestion, explanation: 5}), JSON.stringify({kind: 'execute', actions: []}), 'x'.repeat(16001), null,
])('rejects malformed or unsupported suggestions', raw => expect(() => parseCookbookSuggestion(raw)).toThrow());
test('supports a single clarification or a redirect to existing application controls without an executable draft', () => {
  expect(parseCookbookSuggestion('{"kind":"clarification","question":"Which subsystem?"}')).toEqual({kind: 'clarification', question: 'Which subsystem?'});
  expect(parseCookbookSuggestion('{"kind":"unsupported","explanation":"Use Run hazard analysis in the open project."}').prompt).toBeUndefined();
});
test('cancellation before or after a provider response never returns an insertable suggestion', async () => {
  const controller = new AbortController(), request = jest.fn(() => { controller.abort(); return JSON.stringify(suggestion); });
  await expect(suggestCookbookPrompt({goal: 'Find disconnected nodes', request, signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
  request.mockClear(); await expect(suggestCookbookPrompt({goal: 'Review', request, signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'}); expect(request).not.toHaveBeenCalled();
});
test.each([['', 'Recipe'], ['Original draft', 'Original draft\n\nRecipe'], ['Draft\n', 'Draft\n\nRecipe'], ['Draft\n\n', 'Draft\n\nRecipe'], ['  original  ', '  original  \n\nRecipe']])('preserves the full existing draft when adding a cookbook prompt', (draft, expected) => expect(appendCookbookPrompt(draft, 'Recipe')).toBe(expected));
test('conversation and non-project views do not inherit stale project tabs or hazard methods',()=>{
 const stale = {section:'copilot',viewTitle:'Collaborator conversation',activeTab:'Functional Diagramming',activeCodeArchitectureWorkspaceTab:'hazard',hazardMethod:'HARA'};
 expect(cookbookContext(stale,{project:{name:'OLD PROJECT'},riskMethod:'HARA'})).toMatchObject({project:'',tab:'',method:''});
 expect(cookbookContext({...stale,section:'reports',viewTitle:'Reports'},{riskMethod:'HARA'})).toMatchObject({tab:'',method:''});
});
test('a clarification carries its question and answer as bounded data alongside the original goal',()=>{
 const messages=buildCookbookMessages('Review selected requirements',{}, {question:'Which criterion?',answer:'Testability'});const user=JSON.parse(messages[1].content);
 expect(user.goal).toBe('Review selected requirements');expect(user.clarification).toEqual({question:'Which criterion?',answer:'Testability'});
});
