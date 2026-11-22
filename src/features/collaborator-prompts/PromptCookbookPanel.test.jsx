jest.mock('lucide-react', () => { const Icon = () => <span />; return new Proxy({}, {get: () => Icon}); });
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import PromptCookbookPanel from './PromptCookbookPanel';
global.IS_REACT_ACT_ENVIRONMENT = true;
let host, root, existing, focusRef, props;
const button = text => [...document.querySelectorAll('button')].find(el => el.textContent.trim() === text);
const recipe = title => [...document.querySelectorAll('button')].find(el => el.textContent.startsWith(title));
function input(el, value) {
  const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', {bubbles: true})); });
}
function render(extra = {}) { props = {...props, ...extra}; act(() => root.render(<PromptCookbookPanel {...props} />)); }
const goal = () => document.querySelector('textarea[placeholder^="For example"]');
const preview = () => [...document.querySelectorAll('label')].find(el => el.textContent.startsWith('Prompt preview'))?.querySelector('textarea');
const response = prompt => JSON.stringify({kind: 'suggestion', recipeId: 'check-graph-connectivity', explanation: 'Checks existing edges.', prompt});
beforeEach(() => {
  existing = document.createElement('textarea'); existing.value = 'Existing draft'; document.body.append(existing); existing.focus(); focusRef = {current: existing};
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  props = {open: true, onClose: jest.fn(() => render({open: false})), onUse: jest.fn(), context: {project: 'Robot project', method: 'HARA'}, returnFocusRef: focusRef, requestSuggestion: jest.fn(async () => response('Review existing edges.'))}; render();
});
afterEach(() => { act(() => root.unmount()); host.remove(); existing.remove(); });
test('browsing and closing never request AI or change a conversation draft; focus is restored', () => {
  expect(document.activeElement).toBe(document.querySelector('input[type=search]')); input(document.activeElement, 'orphan'); expect(document.body.textContent).toContain('2 matching prompts');
  act(() => recipe('Check graph connectivity').click()); expect(preview().value).toContain('orphan node pairs'); expect(props.requestSuggestion).not.toHaveBeenCalled();
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true})));
  expect(document.querySelector('[role=dialog]')).toBeNull(); expect(existing.value).toBe('Existing draft'); expect(document.activeElement).toBe(existing);
});
test('supports an empty search result and preserves the editable preview', () => {
  act(() => recipe('Check graph connectivity').click()); input(preview(), 'Edited by the user'); input(document.querySelector('input[type=search]'), 'xyz-no-recipe');
  expect(document.body.textContent).toContain('No matching prompts'); expect(preview().value).toBe('Edited by the user');
  act(() => button('Use prompt').click()); expect(props.onUse).toHaveBeenCalledWith('Edited by the user');
});
test('contains keyboard focus and supports arrow navigation between tabs', () => {
  const close = document.querySelector('[aria-label="Close Prompt Cookbook"]'); close.focus(); act(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', shiftKey: true, bubbles: true, cancelable: true}))); expect(document.activeElement).toBe(button('Cancel'));
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true}))); expect(document.activeElement).toBe(close);
  const browse = button('Browse prompts'); browse.focus(); act(() => browse.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true}))); expect(goal()).not.toBeNull(); expect(document.activeElement).toBe(button('Help me write a prompt'));
});
test('requests a suggestion only explicitly, includes bounded context, and lets users edit before Use prompt', async () => {
  act(() => button('Help me write a prompt').click()); input(goal(), 'Find missing links'); expect(props.requestSuggestion).not.toHaveBeenCalled();
  await act(async () => button('Suggest prompt').click());
  expect(props.requestSuggestion).toHaveBeenCalledTimes(1); const context = JSON.parse(props.requestSuggestion.mock.calls[0][0][1].content).currentWorkspace; expect(context.project).toBe('Robot project');
  input(preview(), 'Review only the selected nodes.'); act(() => button('Use prompt').click()); expect(props.onUse).toHaveBeenCalledWith('Review only the selected nodes.'); expect(existing.value).toBe('Existing draft');
});
test('a provider failure keeps the goal and previous draft and allows browsing', async () => {
  render({requestSuggestion: jest.fn(async () => { throw Error('Provider quota exceeded'); })}); act(() => button('Help me write a prompt').click()); input(goal(), 'Review my decomposition'); await act(async () => button('Suggest prompt').click());
  expect(document.querySelector('[role=alert]').textContent).toContain('quota exceeded'); expect(goal().value).toBe('Review my decomposition'); expect(existing.value).toBe('Existing draft');
  act(() => button('Browse prompts').click()); act(() => recipe('Check graph connectivity').click()); expect(button('Use prompt').disabled).toBe(false);
});
test('clarifications and unsupported tasks never create an insertable prompt', async () => {
  render({requestSuggestion: jest.fn(async () => '{"kind":"clarification","question":"Which subsystem?"}')}); act(() => button('Help me write a prompt').click()); input(goal(), 'Review that subsystem'); await act(async () => button('Suggest prompt').click());
  expect(document.body.textContent).toContain('Which subsystem?'); expect(button('Use prompt').disabled).toBe(true);
  render({requestSuggestion: jest.fn(async () => '{"kind":"unsupported","explanation":"Use Run hazard analysis."}')}); await act(async () => button('Suggest prompt').click()); expect(document.body.textContent).toContain('Use Run hazard analysis.'); expect(button('Use prompt').disabled).toBe(true);
});
test.each(['close', 'goal', 'context', 'tab', 'cancel'])('discards a late provider response after %s changes', async action => {
  let resolve, signal; render({requestSuggestion: jest.fn((_messages, nextSignal) => { signal = nextSignal; return new Promise(done => { resolve = done; }); })});
  act(() => button('Help me write a prompt').click()); input(goal(), 'Find missing links'); await act(async () => button('Suggest prompt').click());
  if (action === 'close') act(() => button('Cancel').click());
  if (action === 'goal') input(goal(), 'A different task');
  if (action === 'context') render({context: {project: 'Different project'}});
  if (action === 'tab') act(() => button('Browse prompts').click());
  if (action === 'cancel') act(() => button('Cancel suggestion').click());
  expect(signal.aborted).toBe(true); await act(async () => resolve(response('STALE PROMPT MUST NOT APPEAR')));
  expect(document.body.textContent).not.toContain('STALE PROMPT MUST NOT APPEAR'); expect(props.onUse).not.toHaveBeenCalled(); expect(existing.value).toBe('Existing draft');
});
test('a successful suggestion becomes unusable when the workspace changes', async () => {
  act(() => recipe('Check graph connectivity').click()); render({context: {project: 'New project'}});
  expect(document.body.textContent).toContain('The workspace changed'); expect(button('Use prompt').disabled).toBe(true);
});
test('an edited goal invalidates a finished suggestion while retaining the editable text',async()=>{
 act(()=>button('Help me write a prompt').click());input(goal(),'Review current connections');await act(async()=>button('Suggest prompt').click());const previous=preview().value;
 input(goal(),'Find missing requirements');expect(preview().value).toBe(previous);expect(button('Use prompt').disabled).toBe(true);expect(document.body.textContent).toContain('Your goal changed');
});
test('a clarification answer is passed with the exact original question and goal',async()=>{
 const request=jest.fn().mockResolvedValueOnce('{"kind":"clarification","question":"Which subsystem?"}').mockResolvedValueOnce(response('Review the Perception subsystem.'));render({requestSuggestion:request});
 act(()=>button('Help me write a prompt').click());input(goal(),'Review a subsystem');await act(async()=>button('Suggest prompt').click());input(document.querySelector('[aria-label="Additional detail"]'),'Perception');await act(async()=>button('Suggest prompt').click());
 const user=JSON.parse(request.mock.calls[1][0][1].content);expect(user.goal).toBe('Review a subsystem');expect(user.clarification).toEqual({question:'Which subsystem?',answer:'Perception'});expect(preview().value).toBe('Review the Perception subsystem.');
});
