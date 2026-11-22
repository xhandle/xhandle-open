import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ReportActionsMenu from './ReportActionsMenu';
jest.mock('../license/LicenseContext', () => ({ Gate: ({ children }) => children }));

let root, container, props;
const findButton = name => [...document.querySelectorAll('button')].find(button => button.textContent === name);
const open = () => act(() => document.querySelector('[aria-label="Report actions"]').click());
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
const render = extra => act(() => root.render(<ReportActionsMenu {...props} {...extra} />));
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  props = { reportType: 'Safety', reportTypes: ['Safety', 'Executive Brief', 'Custom Report'], onReportTypeChange: jest.fn(), onGenerate: jest.fn(), canGenerate: true, canExport: true, onExport: jest.fn(),
    selectedReport: { id: 'r1', title: 'Saved safety report' }, selectedReportId: 'r1', projectId: 'p', onDelete: jest.fn(), onRename: jest.fn().mockResolvedValue(true) };
  render();
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.restoreAllMocks(); delete global.IS_REACT_ACT_ENVIRONMENT; });

test('keeps generation, report type and exports inside the disclosure', () => {
  expect(findButton('Generate AI Report')).toBeUndefined(); open();
  expect(findButton('Generate AI Report')).toBeTruthy();
  const select = document.querySelector('[role="dialog"] select');
  act(() => { select.value = 'Executive Brief'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(props.onReportTypeChange).toHaveBeenCalledWith('Executive Brief');
  act(() => findButton('Generate AI Report').click());
  expect(props.onGenerate).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test.each([['pdf', 'Export Report as PDF'], ['word', 'Export Report as Word (.docx)'], ['gdocs', 'Export Report to Google Docs']])('routes %s to the existing export callback and dismisses the menu', (format, name) => {
  open(); act(() => findButton(name).click());
  expect(props.onExport).toHaveBeenCalledWith(format);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test('retains generation/export availability and pending-state guards', () => {
  render({ canGenerate: false, canExport: false }); open();
  expect(findButton('Generate AI Report').disabled).toBe(true);
  expect(findButton('Export Report as PDF').disabled).toBe(true);
  render({ generating: true });
  expect(findButton('Generating Report...').disabled).toBe(true);
  expect(document.querySelector('[role="dialog"] select').disabled).toBe(true);
});

test('opens an editable name, trims the saved title and preserves the selected report ID', async () => {
  open(); act(() => findButton('Rename selected report').click());
  expect(document.querySelector('[role="dialog"] h2').textContent).toBe('Rename report');
  const input = document.querySelector('[role="dialog"] input'); expect(input.value).toBe('Saved safety report');
  expect(document.activeElement).toBe(input);
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '  Renamed safety report  '); input.dispatchEvent(new Event('input', { bubbles: true })); });
  act(() => findButton('Save name').click()); await flush();
  expect(props.onRename).toHaveBeenCalledWith('r1', 'Renamed safety report');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test('rejects an empty name and keeps a failed rename editable for retry', async () => {
  props.onRename.mockRejectedValueOnce(new Error('storage unavailable')); open(); act(() => findButton('Rename selected report').click());
  act(() => findButton('Save name').click()); await flush();
  expect(document.querySelector('[role="alert"]').textContent).toContain('could not be renamed');
  const input = document.querySelector('[role="dialog"] input');
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '   '); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(findButton('Save name').disabled).toBe(true);
});

test('deletes only after confirmation, and cancels a rename when its project changes', () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false); open(); act(() => findButton('Delete selected report').click());
  expect(props.onDelete).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); act(() => findButton('Delete selected report').click()); expect(props.onDelete).toHaveBeenCalledWith('r1');
  open(); act(() => findButton('Rename selected report').click()); render({ projectId: 'other-project' });
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(props.onRename).not.toHaveBeenCalled();
});

test('the rename dialog traps keyboard focus and Escape restores the actions trigger', () => {
 open();act(()=>findButton('Rename selected report').click());
 const input=document.querySelector('[role="dialog"] input'),save=findButton('Save name');
 act(()=>{save.focus();save.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));});expect(document.activeElement).toBe(input);
 act(()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true})));expect(document.activeElement).toBe(save);
 act(()=>save.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(document.querySelector('[role="dialog"]')).toBeNull();
 expect(document.activeElement).toBe(document.querySelector('[aria-label="Report actions"]'));
});
