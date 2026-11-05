import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReportLibrary, { useReportLibrary } from './ReportLibrary';
import { deleteGeneratedReport, listGeneratedReports, preserveLegacyGeneratedReport, readGeneratedReport } from '../features/project-hazard-analysis/generatedReportStorage';

jest.mock('../features/project-hazard-analysis/generatedReportStorage', () => ({
  GENERATED_REPORT_CHANGED: 'fixture-reports-changed',
  listGeneratedReports: jest.fn(), readGeneratedReport: jest.fn(),
  preserveLegacyGeneratedReport: jest.fn(), deleteGeneratedReport: jest.fn(),
}));

const rows = [
  { id: 'r1', title: 'Subsystem design', reportType: 'Subsystem Design Document', createdAt: '2026-11-04T10:00:00Z', status: 'complete' },
  { id: 'r2', title: 'Safety report', reportType: 'Safety', createdAt: '2026-11-04T09:00:00Z', status: 'draft' },
];
let root, container;
const flush = async () => { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); };
function Harness({ projectId = 'p', initial = null, ready = true, opened = () => {}, requestedId = '' }) {
  const [selected, setSelected] = useState(initial);
  const library = useReportLibrary({ projectId, ready, legacyReport: selected, requestedId,
    onOpen: (value) => { setSelected(value); opened(value); } });
  return <><ReportLibrary library={library} /><pre>{selected?.report}</pre></>;
}
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  listGeneratedReports.mockResolvedValue(rows);
  readGeneratedReport.mockImplementation(async (_project, id) => ({ ...rows.find((row) => row.id === id), projectId: 'p', libraryId: id, libraryLoaded: true, report: 'Body ' + id, functionalDiagramImage: 'saved image ' + id }));
  preserveLegacyGeneratedReport.mockResolvedValue(null);
  deleteGeneratedReport.mockResolvedValue(true);
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; jest.restoreAllMocks(); });

test('shows a compact searchable library and loads selected bodies on demand', async () => {
  act(() => root.render(<Harness />)); await flush();
  expect(container.textContent).toContain('Saved reports (2)');
  expect(container.textContent).toContain('Incomplete draft');
  expect(container.querySelector('pre').textContent).toBe('Body r1');
  expect(readGeneratedReport).toHaveBeenCalledTimes(1);
  const safety = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Safety report');
  act(() => safety.click()); await flush();
  expect(container.querySelector('pre').textContent).toBe('Body r2');
  const input = container.querySelector('input');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Subsystem');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelector('[aria-label="Saved reports"]').textContent).not.toContain('Safety report');
});

test('hydrates the saved body and diagram after restoring only a compact selection pointer', async () => {
  const opened = jest.fn();
  act(() => root.render(<Harness initial={{ libraryId: 'r2' }} opened={opened} />)); await flush();
  expect(opened).toHaveBeenCalledWith(expect.objectContaining({ libraryId: 'r2', functionalDiagramImage: 'saved image r2' }));
});

test('does not read storage when the Reports area is not open', async () => {
  act(() => root.render(<Harness ready={false} />)); await flush();
  expect(listGeneratedReports).not.toHaveBeenCalled();
  expect(readGeneratedReport).not.toHaveBeenCalled();
});

test('a delayed read from a previous project cannot replace the current project report', async () => {
  let finish;
  readGeneratedReport.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const opened = jest.fn();
  act(() => root.render(<Harness projectId="a" opened={opened} />)); await flush();
  act(() => root.render(<Harness projectId="b" opened={opened} />)); await flush();
  opened.mockClear();
  await act(async () => { finish({ libraryId: 'old-project-report', report: 'Old project' }); }); await flush();
  expect(opened).not.toHaveBeenCalledWith(expect.objectContaining({ report: 'Old project' }));
});

test('deleting a saved report requires a user action and confirmation', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(false);
  act(() => root.render(<Harness />)); await flush();
  const button = container.querySelector('[aria-label="Delete Safety report"]');
  act(() => button.click()); await flush();
  expect(deleteGeneratedReport).not.toHaveBeenCalled();
  window.confirm.mockReturnValue(true);
  act(() => button.click()); await flush();
  expect(deleteGeneratedReport).toHaveBeenCalledWith('p', 'r2');
});

test('a failed legacy migration keeps the current text and leaves earlier saved reports accessible', async () => {
  preserveLegacyGeneratedReport.mockRejectedValue(new Error('quota'));
  act(() => root.render(<Harness initial={{ report: 'Unsaved current text' }} />)); await flush();
  expect(container.querySelector('pre').textContent).toBe('Unsaved current text');
  expect(container.textContent).toContain('Subsystem design');
  expect(container.querySelector('[role="alert"]').textContent).toContain('could not be added');
});

test('refreshing after deletion never migrates a previously loaded report back into storage', async () => {
  listGeneratedReports.mockResolvedValue([]);
  const opened = jest.fn();
  act(() => root.render(<Harness initial={{ libraryId: 'deleted', libraryLoaded: true, projectId: 'p', report: 'Deleted report' }} opened={opened} />));
  await flush();
  expect(preserveLegacyGeneratedReport).not.toHaveBeenCalled();
  expect(opened).toHaveBeenCalledWith(null);
  expect(container.querySelector('pre').textContent).toBe('');
});


test('a Collaborator source request opens the exact saved version even when another version is selected', async () => {
  act(() => root.render(<Harness />)); await flush();
  expect(container.querySelector('pre').textContent).toBe('Body r1');
  act(() => root.render(<Harness requestedId="r2" />)); await flush();
  expect(container.querySelector('pre').textContent).toBe('Body r2');
});

test('a missing source request reports it rather than opening a different saved version', async () => {
  act(() => root.render(<Harness requestedId="deleted-version" />)); await flush();
  expect(readGeneratedReport).not.toHaveBeenCalled();
  expect(container.textContent).toContain('This saved report is no longer available.');
});
