import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ArchitectureDiagrams } from './ArchitectureDiagramView';
import NativeCodeArchitectureDiagram from './NativeCodeArchitectureDiagram';
import { downloadArchitecture } from './architectureGraph';
import ArtifactRequirementsViews from './ArtifactRequirementsViews';
import { artifactRequirementRows } from './artifactRequirementsAdapter';
import PagedDetails from './PagedDetails';
import ArtifactActionsPopover from './ArtifactActionsPopover';
jest.mock('./NativeCodeArchitectureDiagram', () => jest.fn(() => <div>Native code diagram</div>));
jest.mock('./architectureGraph', () => ({ downloadArchitecture: jest.fn(async () => {}) }));
jest.mock('./artifactRequirementsAdapter', () => ({ artifactRequirementRows: jest.fn(() => ({ rows: [], allRequirements: [], folderNameById: {} })) }));
jest.mock('./NativeArchitectureDiagram', () => () => null);
jest.mock('reactflow', () => ({ __esModule: true, default: () => <div>Diagram canvas</div>, Background: () => null, Controls: () => null, MarkerType: {}, Position: {} }));
jest.mock('lucide-react', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => null }));
let root, host;
beforeEach(() => { NativeCodeArchitectureDiagram.mockImplementation(() => <div>Native code diagram</div>); downloadArchitecture.mockResolvedValue(); artifactRequirementRows.mockReturnValue({ rows: [], allRequirements: [], folderNameById: {} }); global.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); jest.clearAllMocks(); });
const click = async text => act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === text).click());
const until = async predicate => {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(predicate()).toBeTruthy();
};

test('compact diagram publishes export to the actions menu and follows the selected source', async () => {
  const diagrams = ['First', 'Second'].map(title => ({ id: title, title, sourceType: 'architecture-diagram', workspaceType: 'code-architecture', snapshot: { projectionVersion: 2, nodes: [{ id: title, label: title }], edges: [] } }));
  // Keep the manifest stable, as in ArtifactEditor.
  const manifest = { entries: diagrams };
  function StableEditor() {
    const [exportAction, setExportAction] = React.useState(null);
    return <><ArtifactActionsPopover>{() => exportAction && <button onClick={exportAction.run} disabled={exportAction.disabled}>{exportAction.label}</button>}</ArtifactActionsPopover><ArchitectureDiagrams manifest={manifest} onExportActionChange={setExportAction} /></>;
  }
  await act(async () => root.render(<StableEditor />));
  expect(host.textContent).not.toContain('Saved source snapshot');
  expect(host.textContent).not.toContain('Diagrams are maintained');
  expect(host.textContent).not.toContain('Export diagram');
  await act(async () => { const select = host.querySelector('[aria-label="Source diagram"]'); select.value = 'Second'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => host.querySelector('[aria-label="Artifact actions"]').click());
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Export diagram (PNG)').click());
  expect(downloadArchitecture.mock.calls.at(-1)[0].snapshot.nodes[0].id).toBe('Second');
});

test('only a bounded view is laid out and inspected; searching finds elements on later views', async () => {
  const nodes = Array.from({ length: 1001 }, (_, i) => ({ id: `n${i}`, label: `Function ${i}` }));
  const edges = Array.from({ length: 1000 }, (_, i) => ({ id: `e${i}`, from: 'n0', to: `n${i + 1}`, label: `Calls ${i}` }));
  const diagram = { id: 'd', title: 'Repository', sourceType: 'architecture-diagram', workspaceType: 'code-architecture', snapshot: { nodes, edges } };
  const manifest = { entries: [diagram, ...nodes.map(node => ({ id: `source:${node.id}`, diagramId: 'd', sourceType: 'architecture-element', elementType: 'node', elementId: node.id, title: node.label, element: node })), ...edges.map(edge => ({ id: `source:${edge.id}`, diagramId: 'd', sourceType: 'architecture-element', elementType: 'edge', elementId: edge.id, title: edge.label, element: edge }))] };
  await act(async () => root.render(<ArchitectureDiagrams manifest={manifest} />));
  expect(NativeCodeArchitectureDiagram).toHaveBeenCalled();
  expect(NativeCodeArchitectureDiagram.mock.calls[0][0].diagram.snapshot.edges).toHaveLength(60);
  expect(host.querySelector('.architecture-inspector')).toBeNull();
  await click('▴Show element details');
  expect(host.querySelectorAll('option').length).toBeLessThan(205);
  await act(async () => {
    const input = host.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Function 1000');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const inspector = host.querySelector('.architecture-inspector select');
  expect(inspector.options).toHaveLength(2);
  await act(async () => { inspector.value = 'n1000'; inspector.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(NativeCodeArchitectureDiagram.mock.calls.at(-1)[0].diagram.snapshot.nodes.some(node => node.id === 'n1000')).toBe(true);
  await click('Export current view (PNG)');
  expect(downloadArchitecture.mock.calls[0][0].snapshot.edges.length).toBeLessThanOrEqual(60);
  expect(manifest.entries).toHaveLength(2002);
});

test('document view does not build requirements projections or project traces', async () => {
  const props = { meta: { title: 'Architecture', templateId: 'architecture' }, objects: [], document: <p>Document</p> };
  await act(async () => root.render(<ArtifactRequirementsViews {...props} view="document" />));
  expect(artifactRequirementRows).not.toHaveBeenCalled();
  await act(async () => root.render(<ArtifactRequirementsViews {...props} view="table" />));
  await until(() => artifactRequirementRows.mock.calls.length > 0);
  expect(artifactRequirementRows).toHaveBeenCalledTimes(1);
});

test('closed evidence lists mount nothing; opening and paging retain access to all records', async () => {
  const renderItem = jest.fn(item => <p key={item}>Record {item}</p>);
  await act(async () => root.render(<PagedDetails title="Saved evidence" items={Array.from({ length: 120 }, (_, i) => i)} renderItem={renderItem} />));
  expect(renderItem).not.toHaveBeenCalled();
  await act(async () => { const details = host.querySelector('details'); details.open = true; details.dispatchEvent(new Event('toggle')); });
  expect(host.querySelectorAll('p')).toHaveLength(50);
  await click('Next'); await click('Next');
  expect(host.querySelectorAll('p')).toHaveLength(20);
  expect(host.textContent).toContain('Record 119');
});


test('element details stay in a closed bottom tray until explicitly opened, and selection survives hiding', async () => {
  const source = { id: 'source:e', diagramId: 'd', sourceType: 'architecture-element', elementType: 'edge', elementId: 'e', title: 'Declare subscription', element: { id: 'e', from: 'a', to: 'b', label: 'Declare subscription' } };
  const diagram = { id: 'd', title: 'CSC architecture', sourceType: 'architecture-diagram', workspaceType: 'code-architecture', snapshot: { projectionVersion: 2, nodes: [{ id: 'a', label: 'Publisher' }, { id: 'b', label: 'Subscriber' }], edges: [source.element] } };
  const manifest = { entries: [diagram, source] };
  const objects = [{ id: 'object', title: 'Subscription requirement', sourceEvidence: [source] }];
  await act(async () => root.render(<ArchitectureDiagrams manifest={manifest} objects={objects} />));
  const toggle = host.querySelector('.architecture-inspector-toggle');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('[aria-label="Element details"]')).toBeNull();
  await act(async () => NativeCodeArchitectureDiagram.mock.calls.at(-1)[0].onSelect('e'));
  expect(toggle.textContent).toContain('Declare subscription');
  expect(host.querySelector('.architecture-inspector')).toBeNull();
  await act(async () => toggle.click());
  const tray = host.querySelector('[aria-label="Element details"]');
  expect(toggle.getAttribute('aria-controls')).toBe(tray.id);
  expect(tray.textContent).toContain('Linked objects in this artifact:');
  expect(tray.textContent).toContain('Subscription requirement');
  expect(tray.querySelector('select').value).toBe('e');
  await act(async () => toggle.click());
  expect(host.querySelector('.architecture-inspector')).toBeNull();
  expect(host.querySelector('.architecture-canvas')).not.toBeNull();
  await act(async () => toggle.click());
  expect(host.querySelector('.architecture-inspector select').value).toBe('e');
});

test('architecture Document is prose, Diagram is a separate view, and citations focus the saved relationship', async () => {
  const { default: ArchitectureDocument } = await import('./ArchitectureDocument');
  const diagram = { id: 'd', title: 'Saved CSC view', sourceType: 'architecture-diagram', workspaceType: 'code-architecture', abstraction: 'csc', snapshot: { projectionVersion: 2, nodes: [{ id: 'a', label: 'Controller' }, { id: 'b', label: 'Actuator' }], edges: [{ id: 'e', from: 'a', to: 'b', label: 'Command' }] } };
  const manifest = { entries: [diagram, { id: 'source:e', diagramId: 'd', sourceType: 'architecture-element', elementId: 'e', elementType: 'edge', title: 'Command' }] };
  const meta = { title: 'Vehicle architecture', templateId: 'architecture', config: { system: 'Vehicle', architectureKind: 'code-based' } };
  function Workspace() {
    const [view, setView] = React.useState('document');
    const [focus, setFocus] = React.useState(null);
    return <ArtifactRequirementsViews meta={meta} objects={[]} manifest={manifest} view={view} setView={setView}
      document={<ArchitectureDocument meta={meta} manifest={manifest} objects={[]} onOpenDiagram={reference => { setFocus(reference); setView('diagram'); }} />}
      diagram={<ArchitectureDiagrams manifest={manifest} initialDiagramId={focus?.diagramId} focusId={focus?.elementId} />} />;
  }
  await act(async () => root.render(<Workspace />));
  await until(() => !!host.querySelector('.artifact-paper'));
  expect(host.querySelector('.artifact-paper').textContent).toContain('from Controller to Actuator');
  expect(host.querySelector('.architecture-canvas')).toBeNull();
  expect(NativeCodeArchitectureDiagram).not.toHaveBeenCalled();
  expect(artifactRequirementRows).not.toHaveBeenCalled();
  const diagramButton = host.querySelector('[title="Diagram view"]');
  expect(diagramButton.getAttribute('aria-pressed')).toBe('false');
  await click('Command');
  await until(() => NativeCodeArchitectureDiagram.mock.calls.length > 0);
  expect(host.querySelector('.artifact-paper')).toBeNull();
  expect(host.querySelector('[data-architecture="true"]')).not.toBeNull();
  expect(NativeCodeArchitectureDiagram.mock.calls.at(-1)[0].focusId).toBe('e');
  expect(diagramButton.getAttribute('aria-pressed')).toBe('true');
  expect(artifactRequirementRows).not.toHaveBeenCalled();
  await act(async () => host.querySelector('[title="Document view"]').click());
  await until(() => !!host.querySelector('.artifact-paper'));
  expect(host.querySelector('.artifact-paper')).not.toBeNull();
  expect(host.querySelector('.architecture-canvas')).toBeNull();
});
