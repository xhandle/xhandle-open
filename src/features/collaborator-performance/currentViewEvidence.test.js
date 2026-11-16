import { captureCurrentViewEvidence, currentArchitectureSample, currentDiagramSample, readRenderedView, assertCurrentViewTarget } from './currentViewEvidence';
import { registerActionProvider } from '../app/actionRegistry';
import { contextTurnMessages, parseContextTurn, resolveContextResponse } from './contextOnDemand';

let cleanup;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; jest.restoreAllMocks(); });
const focus = { section: 'projects', viewedProjectId: 'p', viewTitle: 'AV Stack', activeTab: 'Functional Diagramming' };
const row = { fromFunction: 'Acquire Inertial Measurement', controlAction: 'Inertial Data', toFunction: '3D Scene Understanding', fromDetails: 'Acquire inertial sensor measurements.' };
const mount = (section = 'projects') => {
  document.body.innerHTML = `<aside>Other project SECRET SIDEBAR</aside><main data-collaborator-workspace="${section}"><h2>AV Stack</h2><p>Scene estimation feeds the planner.</p></main><div>SECRET CHAT HISTORY</div>`;
  return document.querySelector('main');
};

test('an unselected current diagram supplies real directed relationships, without storage, indexing or writes', () => {
  mount();
  cleanup = registerActionProvider('collaborator-current-view', { read: () => ({ section: 'projects', projectId: 'p', tab: focus.activeTab, content: currentArchitectureSample([row]) }) });
  const storage = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('No storage read expected'); });
  const evidence = captureCurrentViewEvidence(focus);
  expect(evidence.structured.relationships).toEqual([row]);
  expect(evidence.rendered.text).toContain('Scene estimation');
  expect(JSON.stringify(evidence)).not.toMatch(/SECRET/);
  expect(storage).not.toHaveBeenCalled();
  const messages = contextTurnMessages({ userText: 'describe this diagram', currentViewEvidence: evidence,
    history: [{ role: 'assistant', content: 'Earlier discussion about another project' }] });
  expect(JSON.stringify(messages.at(-1))).toContain('Inertial Data');
  expect(messages[0].content).toContain('do not ask which diagram');
});

test.each(['projects', 'code-architecture', 'requirements', 'reports', 'vnv', 'safety-case', 'review-center', 'console', 'risk', 'ai-pm'])(
  '%s supplies current rendered content without requiring a selection', section => {
    const root = mount(section); root.innerHTML = '<h2>Current content</h2><table><tr><th>Requirement</th><th>Status</th></tr><tr><td><button>The controller shall reject invalid commands.</button></td><td>Proposed</td></tr></table>';
    const evidence = captureCurrentViewEvidence({ section });
    expect(evidence.rendered.text).toContain('The controller shall reject invalid commands.');
    expect(evidence.rendered.text).toContain('Proposed');
    expect(evidence.rendered.coverage).toContain('unloaded content may be omitted');
  });

test('hidden areas, popovers, private input and toolbar text are excluded from rendered evidence', () => {
  const root = mount();
  root.innerHTML = '<p>Visible report</p><div hidden>SECRET HIDDEN</div><div style="display:none">SECRET TAB</div><div aria-hidden="true">SECRET ARIA</div><div role="dialog">SECRET MODAL</div><input value="SECRET INPUT"><textarea>SECRET COMPOSER</textarea><button>SECRET TOOLBAR</button><div class="design-library-pane">SECRET LIBRARY</div>';
  expect(readRenderedView(root)).toMatchObject({ text: 'Visible report', truncated: false });
});

test('stale section, project, tab, detached chat and missing current data never borrow another target', () => {
  mount('reports'); expect(captureCurrentViewEvidence(focus)).toBeNull();
  mount();
  cleanup = registerActionProvider('collaborator-current-view', { read: () => ({ section: 'projects', projectId: 'other', tab: focus.activeTab, content: { secret: 'FOREIGN' } }) });
  expect(captureCurrentViewEvidence(focus).structured).toBeUndefined();
  cleanup(); cleanup = registerActionProvider('collaborator-current-view', { read: () => ({ section: 'projects', projectId: 'p', tab: 'Hazard Analysis', content: { secret: 'OTHER TAB' } }) });
  expect(captureCurrentViewEvidence(focus).structured).toBeUndefined();
  expect(captureCurrentViewEvidence(focus, { docked: false })).toBeNull();
  expect(captureCurrentViewEvidence({ section: 'copilot' })).toBeNull();
  cleanup(); document.body.innerHTML = ''; expect(captureCurrentViewEvidence(focus)).toBeNull();
});

test('current values are read at send time even when project and row counts have not changed', () => {
  mount(); let rows = [row];
  cleanup = registerActionProvider('collaborator-current-view', { read: () => ({ section: 'projects', projectId: 'p', tab: focus.activeTab, content: currentArchitectureSample(rows) }) });
  expect(captureCurrentViewEvidence(focus).structured.relationships[0].controlAction).toBe('Inertial Data');
  rows = [{ ...row, controlAction: 'Validated Inertial Data' }];
  expect(captureCurrentViewEvidence(focus).structured.relationships[0].controlAction).toBe('Validated Inertial Data');
});

test('safety case diagrams preserve node identities, claim wording, evidence status and directed support links', () => {
  const graph = currentDiagramSample([{ id: 'claim', type: 'claim', title: 'Control is acceptably safe', status: 'needs-review' },
    { id: 'evidence', type: 'evidence', title: 'Control test', description: 'Recorded test results', status: 'draft' }],
  [{ id: 'support', source: 'evidence', target: 'claim', relationship: 'supports' }]);
  expect(graph.nodes[0].status).toBe('needs-review');
  expect(graph.edges[0]).toMatchObject({ source: 'evidence', target: 'claim', relationship: 'supports' });
  expect(graph.truncated).toBe(false);
});

test('large diagrams and rendered documents have bounded payload/traversal with explicit coverage', () => {
  const large = Array.from({ length: 26000 }, (_, i) => ({ ...row, traceId: String(i), fromDetails: 'x'.repeat(5000), embeddedSource: 'DO NOT COPY' }));
  const sample = currentArchitectureSample(large);
  expect(sample.totalRelationships).toBe(26000); expect(sample.truncated).toBe(true);
  expect(JSON.stringify(sample).length).toBeLessThan(12000); expect(JSON.stringify(sample)).not.toContain('DO NOT COPY');
  const root = mount(); root.innerHTML = Array.from({ length: 500 }, () => '<p>Source detail</p>').join('');
  const bounded = readRenderedView(root, { maxCharacters: 100, maxNodes: 20 });
  expect(bounded.text.length).toBeLessThanOrEqual(100); expect(bounded.truncated).toBe(true);
  root.innerHTML = '<p>' + 'x'.repeat(10000) + '</p>';
  expect(readRenderedView(root, { maxCharacters: 200 }).text).toHaveLength(200);
});

test.each(['describe this diagram', 'Can you explain the diagram?', 'Summarize the open document', 'What am I looking at?', 'Walk me through this table'])(
  'repairs redundant target/upload questions for %s, then answers from supplied evidence', async userText => {
    const currentViewEvidence = { structured: currentArchitectureSample([row]) };
    const response = JSON.stringify({ kind: 'clarify', text: 'Which diagram would you like me to describe—one you are about to attach, or a saved diagram?' });
    const repair = jest.fn().mockResolvedValue(JSON.stringify({ kind: 'answer', text: 'Acquire Inertial Measurement sends Inertial Data to 3D Scene Understanding.' }));
    const result = await resolveContextResponse({ response, messages: contextTurnMessages({ userText, currentViewEvidence }),
      parseOptions: { userText, currentViewEvidence }, requestRepair: repair });
    expect(result.kind).toBe('answer'); expect(repair).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(repair.mock.calls[0][0])).toContain('Inertial Data');
  });

test('attachments, missing evidence and unrelated clarification retain their scope; read-only protocol rejects writes', () => {
  const answer = 'Which diagram would you like me to describe?';
  expect(() => assertCurrentViewTarget(answer, { userText: 'describe this diagram' })).not.toThrow();
  expect(() => assertCurrentViewTarget(answer, { userText: 'describe this diagram', currentViewEvidence: {}, userContent: [{ type: 'image_url' }] })).not.toThrow();
  expect(() => assertCurrentViewTarget('Which output format would you prefer?', { userText: 'describe this diagram', currentViewEvidence: {} })).not.toThrow();
  expect(() => parseContextTurn('{"kind":"execute","text":"delete all"}', { currentViewEvidence: {} })).toThrow();
});
