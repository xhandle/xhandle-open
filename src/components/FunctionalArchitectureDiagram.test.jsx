import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FunctionalRelationshipInspector } from './FunctionalArchitectureDiagram';
const mockFocus = jest.fn(() => true);
jest.mock('./LiteSummaryDiagramReactFlowGitHub', () => {
  const React = require('react');
  return { __esModule: true, default: React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ focusArchitectureTarget: mockFocus, fitViewToDiagram: jest.fn() }));
    return <><button onClick={() => props.onOpenFunctionalRow({ traceId: props.rows[0]?.traceId })}>Fixture open row</button><button onClick={() => props.onOpenFunctionalRow({ traceId: props.rows.at(-1)?.traceId })}>Fixture last row</button><button onClick={() => props.onOpenFunctionalRow({ traceId: 'missing', rowIndex: 0 })}>Fixture invalid row</button></>;
  }) };
});
jest.mock('./CopyTableButton', () => ({ __esModule: true, default: () => null }));
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('reactflow', () => ({ __esModule: true, default: () => null, ReactFlowProvider: ({ children }) => children }));
jest.mock('html-to-image', () => ({ toPng: jest.fn() }));
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
test('inspector opens exact source rows and CSU relationships, paginates and closes with Escape', () => {
  const rows = Array.from({ length: 35 }, (_, i) => ({ traceId: `id-${i}`, rowRef: i + 10, from: 'caller', to: `callee${i}`, action: 'Call' }));
  const openRow = jest.fn(), openCsu = jest.fn(), close = jest.fn();
  act(() => root.render(<FunctionalRelationshipInspector selection={{ label: 'caller', rowIndices: rows.map((_, i) => i) }} rows={rows} onClose={close} onOpenRow={openRow} onOpenCsu={openCsu} />));
  const click = label => act(() => [...host.querySelectorAll('button')].find(b => b.textContent === label).click());
  click('Open in table'); expect(openRow).toHaveBeenCalledWith(rows[0], 0);
  click('Show in CSU'); expect(openCsu).toHaveBeenCalledWith(rows[0], 0);
  expect(host.textContent).not.toContain('callee30');
  click('Next'); expect(host.textContent).toContain('callee30');
  click('Open in table'); expect(openRow).toHaveBeenLastCalledWith(rows[30], 30);
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(close).toHaveBeenCalledTimes(1);
});

test('ready diagrams omit the information banner and retain access to supporting rows', async () => {
  const { default: Diagram } = require('./FunctionalArchitectureDiagram');
  const { processFunctionalModel } = require('../features/code-architecture-context/testSupport/functionalHierarchyFixture');
  const rows = await processFunctionalModel([{ from: 'caller', to: 'callee', fromFile: 'a.cpp', toFile: 'b.cpp', action: 'Send data', traceId: 'boundary-row' }], {
    request: async () => ({ function: { name: 'Prepare Output', description: 'Prepare the output.' }, relationships: [
      { index: 0, disposition: 'internal', target: null, rationale: 'Implementation detail.' },
    ] }),
  });
  const openRow = jest.fn();
  act(() => root.render(<Diagram rows={rows} ready onOpenRow={openRow} error="The analysis request timed out." />));
  expect(host.textContent).not.toContain('source connection was preserved');
  expect(host.textContent).not.toContain('functional responsibilities');
  expect(host.textContent).not.toContain('The analysis request timed out.');
  expect(host.textContent).not.toContain('Regenerate functional model');
  expect(host.textContent).not.toContain('Inspect supporting calls');
  act(() => root.render(<Diagram rows={rows} ready viewMode="table" onOpenRow={openRow} />));
  act(() => [...host.querySelectorAll('button')].find(button => button.textContent === '1 source rows').click());
  expect(host.textContent).toContain('callee');
  act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'Open in table').click());
  expect(openRow).toHaveBeenCalledWith(rows[0], 0);
});

test('controlled menu modes show the Functional table and diagram together or separately', async () => {
  const { default: Diagram } = require('./FunctionalArchitectureDiagram');
  const { processFunctionalModel } = require('../features/code-architecture-context/testSupport/functionalHierarchyFixture');
  const rows = await processFunctionalModel([{ from: 'caller', to: 'callee', fromFile: 'a.cpp', toFile: 'b.cpp', action: 'Send', traceId: 'saved' }], {
    request: async () => ({ function: { name: 'Prepare Output', description: 'Prepare output.' }, relationships: [{ index: 0, disposition: 'internal', target: null, rationale: 'Fixture.' }] }),
  });
  const render = viewMode => act(() => root.render(<Diagram rows={rows} ready viewMode={viewMode} />));
  render('split');
  expect(host.querySelector('[aria-label="Functional model table"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Functional model diagram"]')).not.toBeNull();
  render('table');
  expect(host.querySelector('[aria-label="Functional model table"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Functional model diagram"]')).toBeNull();
  expect(host.textContent).not.toContain('Export CSV');
  render('architecture');
  expect(host.querySelector('[aria-label="Functional model table"]')).toBeNull();
  expect(host.querySelector('[aria-label="Functional model diagram"]')).not.toBeNull();
});


test('table links focus exact Functional nodes and interactions and split divider resizes', async () => {
  const { default: Diagram } = require('./FunctionalArchitectureDiagram');
  const { processFunctionalModel } = require('../features/code-architecture-context/testSupport/functionalHierarchyFixture');
  const rows = await processFunctionalModel([{ from: 'caller', to: 'callee', fromFile: 'a.cpp', toFile: 'b.cpp', action: 'Send', traceId: 'link' }], {
    request: async () => ({ function: { name: 'Prepare Output', description: 'Prepare output.' }, relationships: [{ index: 0, disposition: 'interaction', significance: 'meaningful', target: { name: 'Receive Output', description: 'Receive output.' }, action: 'Send output', description: 'Output information.', kind: 'data', rationale: 'Cross-component output.' }] }),
  });
  mockFocus.mockClear();
  function ControlledDiagram() {
    const [view, setView] = React.useState('table');
    return <><button onClick={() => setView('table')}>Fixture table</button><Diagram rows={rows} ready viewMode={view} onViewModeChange={setView} /></>;
  }
  act(() => root.render(<ControlledDiagram />));
  for (const [label, type] of [['Function (From)', 'node'], ['Control Action', 'edge'], ['Function (To)', 'node']]) {
    act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'Fixture table').click());
    act(() => host.querySelector(`button[aria-label^="Show ${label} in diagram"]`).click());
    expect(host.querySelector('[aria-label="Functional model table"]')).toBeNull();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(mockFocus.mock.calls.at(-1)[0].type).toBe(type);
    expect(mockFocus.mock.calls.at(-1)[0].mode).toBe(label === 'Control Action' ? 'edge' : label === 'Function (To)' ? 'to' : 'from');
    expect(mockFocus.mock.calls.at(-1)[0].traceId).toBeTruthy();
  }
  act(() => root.render(<Diagram rows={rows} ready viewMode="split" />));
  const separator = host.querySelector('[role="separator"]');
  expect(separator.getAttribute('aria-valuenow')).toBe('50');
  act(() => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(separator.getAttribute('aria-valuenow')).toBe('55');
  act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'Fixture open row').click());
  expect(host.querySelector('[aria-label="Functional model table"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Functional model diagram"]')).not.toBeNull();
  expect(host.querySelector('tbody tr').className).toContain('bg-blue-50');
});

test('pending diagram focus is cancelled when returning to table, and selection carries derived evidence', async () => {
  const { default: Diagram } = require('./FunctionalArchitectureDiagram');
  const { processFunctionalModel } = require('../features/code-architecture-context/testSupport/functionalHierarchyFixture');
  const rows = await processFunctionalModel([{ from: 'caller', to: 'callee', fromFile: 'a.cpp', toFile: 'b.cpp', action: 'Send', traceId: 'source-selection' }], {
    request: async () => ({ function: { name: 'Prepare', description: 'Prepare output.' }, relationships: [{ index: 0, disposition: 'interaction', significance: 'meaningful', target: { name: 'Receive', description: 'Receive output.' }, action: 'Send output', description: 'Output information.', kind: 'data', rationale: 'Cross-component output.' }] }),
  });
  const selected = jest.fn();
  const render = viewMode => act(() => root.render(<Diagram rows={rows} ready storageKey="cancel-fixture" projectId="project" viewMode={viewMode} onCollaboratorSelectionChange={selected} />));
  render('table');
  act(() => host.querySelector('tbody td').click());
  expect(selected.mock.calls[0][0]).toMatchObject({ tableId: 'code-architecture-functional-model', projectId: 'project' });
  expect(selected.mock.calls[0][0].selectedRows[0].values['Supporting Source Trace IDs']).toBe('source-selection');
  expect(selected.mock.calls[0][0].primary.rowId).not.toBe('source-selection');
  mockFocus.mockReturnValue(false);
  render('split');
  act(() => host.querySelector('button[aria-label^="Show Function (From)"]').click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
  render('table');
  const calls = mockFocus.mock.calls.length;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
  expect(mockFocus.mock.calls.length).toBe(calls);
  expect(host.querySelector('[aria-label="Code architecture tools sidebar"]')).toBeNull();
  mockFocus.mockReturnValue(true);
});


test('reverse reveal retains matching filters, clears hiding filters, and rejects missing explicit IDs', async () => {
  const { default: Diagram } = require('./FunctionalArchitectureDiagram');
  const { processFunctionalModel } = require('../features/code-architecture-context/testSupport/functionalHierarchyFixture');
  const rows = await processFunctionalModel([0, 1].map(i => ({ from: `Caller ${i}`, to: `Receiver ${i}`, fromFile: `${i}.cpp`, toFile: 'target.cpp', action: 'Send', traceId: `filter-${i}` })), {
    request: async prompt => {
      const data = JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
      return { function: { name: data[0].from, description: 'Prepare output.' }, relationships: data.map(row => ({ index: row.index, disposition: 'interaction', significance: 'meaningful', target: { name: row.to, description: 'Receive output.' }, action: 'Send output', description: 'Output information.', kind: 'data', rationale: 'Cross-component output.' })) };
    },
  });
  act(() => root.render(<Diagram rows={rows} ready viewMode="split" />));
  const click = label => act(() => [...host.querySelectorAll('button')].find(button => button.textContent === label).click());
  const firstFrom = host.querySelector('tbody tr td:nth-child(2) span').textContent;
  act(() => host.querySelector('[title="Filter Function (From)"]').click());
  act(() => [...host.querySelectorAll('label')].find(label => label.textContent === firstFrom).querySelector('input').click());
  expect(host.querySelectorAll('tbody tr[data-virtual-key]')).toHaveLength(1);
  click('Fixture open row');
  expect(host.querySelectorAll('tbody tr[data-virtual-key]')).toHaveLength(1);
  click('Fixture invalid row');
  expect(host.textContent).toContain('The linked row is no longer available.');
  expect(host.querySelectorAll('tbody tr[data-virtual-key]')).toHaveLength(1);
  click('Fixture last row');
  expect(host.querySelectorAll('tbody tr[data-virtual-key]')).toHaveLength(2);
});

test('hierarchy is visible in the table and CSV, and legacy models offer an upgrade without hiding results', async () => {
  const { default: Diagram, functionalTableCsv } = require('./FunctionalArchitectureDiagram');
  const { processFunctionalModel } = require('../features/code-architecture-context/testSupport/functionalHierarchyFixture');
  const { buildFunctionalModelRows } = require('../features/code-architecture-context/functionalModel');
  const rows = await processFunctionalModel([{ from: 'caller', to: 'callee', fromFile: 'a.cpp', toFile: 'b.cpp', action: 'Send', traceId: 'hierarchy',
    fromArchitecture: { subsystem: 'Product', csci: 'Access', csc: 'Credentials' },
    toArchitecture: { subsystem: 'External', csci: 'Delivery', csc: 'Renderer' } }], {
    request: async () => ({ function: { name: 'Validate', description: 'Validate credentials.' }, relationships: [{ index: 0, disposition: 'interaction', significance: 'meaningful',
      target: { name: 'Render', description: 'Render feedback.' }, action: 'Result', kind: 'data', description: 'Validation result.', rationale: 'Interface.' }] }),
  });
  const upgrade = jest.fn();
  act(() => root.render(<Diagram rows={rows} ready viewMode="table" onProcess={upgrade} />));
  for (const header of ['CSCI (From)', 'CSC (From)', 'CSCI (To)', 'CSC (To)']) expect(host.textContent).toContain(header);
  const csv = functionalTableCsv(buildFunctionalModelRows(rows));
  expect(csv).toContain('"CSCI (From)"'); expect(csv).toContain('"CSCI (To)"');
  for (const value of ['Access', 'Credentials', 'Delivery', 'Renderer']) { expect(csv).toContain(`"${value}"`); expect(host.textContent).toContain(value); }
  expect(host.textContent).not.toContain('Update CSCI/CSC hierarchy');
  const old = rows.map(row => ({ ...row, functionalAbstraction: { ...row.functionalAbstraction, hierarchyVersion: undefined } }));
  act(() => root.render(<Diagram rows={old} ready viewMode="table" onProcess={upgrade} />));
  expect(host.querySelector('[aria-label="Functional model table"]')).not.toBeNull();
  act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'Update CSCI/CSC hierarchy').click());
  expect(upgrade).toHaveBeenCalledTimes(1);
});

test('menu export follows visible Functional table filters in table, split and diagram modes', async () => {
  const { default: Diagram } = require('./FunctionalArchitectureDiagram');
  const { processFunctionalModel } = require('../features/code-architecture-context/testSupport/functionalHierarchyFixture');
  const rows = await processFunctionalModel([0, 1].map(i => ({ from: `Caller ${i}`, to: `Receiver ${i}`, fromFile: `${i}.cpp`, toFile: 'target.cpp', action: 'Send', traceId: `export-${i}` })), {
    request: async prompt => {
      const evidence = JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
      return { function: { name: evidence[0].from, description: 'Caller responsibility.' }, relationships: evidence.map(row => ({ index: row.index, disposition: 'internal', significance: 'implementation', rationale: 'Supporting operation.' })) };
    },
  });
  let handler;
  const register = value => { handler = value; };
  const originalUrl = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  let blob, filename;
  URL.createObjectURL = value => { blob = value; return 'blob:fixture'; };
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { filename = this.download; });
  try {
    const render = viewMode => act(() => root.render(<Diagram rows={rows} ready viewMode={viewMode} repoName="Example" onExportCsvChange={register} />));
    render('table'); expect(typeof handler).toBe('function');
    act(() => host.querySelector('[title="Filter Function (From)"]').click());
    act(() => [...host.querySelectorAll('label')].find(label => label.textContent === 'Caller 0').querySelector('input').click());
    handler();
    const csv = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob); });
    expect(filename).toMatch(/^Example-functional-view-.*\.csv$/);
    expect(csv).toContain('Caller 0'); expect(csv).not.toContain('Caller 1'); expect(csv).toContain('CSCI (From)');
    expect(host.textContent).not.toContain('Export CSV');
    render('split'); expect(typeof handler).toBe('function');
    render('architecture'); expect(typeof handler).toBe('function');
    render('table'); expect(typeof handler).toBe('function');
    act(() => root.render(null)); expect(handler).toBeNull();
  } finally { click.mockRestore(); URL.createObjectURL = originalUrl; URL.revokeObjectURL = originalRevoke; }
});
