import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import InlineHazardText from './InlineHazardText';

let host, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

test('retains a local edit across unrelated renders, saves on blur, and cancels on Escape', async () => {
  const save = jest.fn();
  const render = () => root.render(<InlineHazardText value="Original" label="Hazard" onCommit={save} onFocus={() => {}} />);
  act(render);
  const cell = host.querySelector('[role="textbox"]');
  cell.textContent = 'Edited\nSecond line';
  act(() => cell.dispatchEvent(new InputEvent('input', { bubbles: true })));
  expect(save).not.toHaveBeenCalled();
  act(render);
  expect(cell.textContent).toBe('Edited\nSecond line');
  await act(async () => cell.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(save).toHaveBeenCalledWith('Edited\nSecond line');
  cell.textContent = 'Unwanted edit';
  act(() => cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(cell.textContent).toBe('Original');
});

test('identifier cells are read only and failed saves retain the edited text', async () => {
  const save = jest.fn().mockRejectedValue(new Error('Storage unavailable'));
  const alert = jest.spyOn(window, 'alert').mockImplementation(() => {});
  act(() => root.render(<InlineHazardText value="RAW-1" label="ID" readOnly onCommit={save} />));
  expect(host.firstChild.hasAttribute('contenteditable')).toBe(false);
  act(() => root.render(<InlineHazardText value="Original" label="Hazard" onCommit={save} />));
  host.firstChild.textContent = 'Retain for retry';
  await act(async () => host.firstChild.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(host.firstChild.textContent).toBe('Retain for retry');
  expect(alert).toHaveBeenCalledWith(expect.stringContaining('Storage unavailable'));
  alert.mockRestore();
});
