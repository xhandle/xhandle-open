import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SourceEvidenceDetails from './SourceEvidenceDetails';
import { ArchitectureEvidence } from './ArchitectureDiagramView';
import StructuredAttributeInput from '../../requirements/components/StructuredAttributeInput';
import { engineeringProjectReport } from './engineeringProjectReport';
import { artifactMarkdown } from './artifactExport';

jest.mock('lucide-react', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => null }));
jest.mock('./NativeArchitectureDiagram', () => () => <div>Saved project diagram</div>);
let root, host;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'opaque-owner', name: 'Vehicle program' }])); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const node = { id: 'private-source-id', sourceType: 'architecture-element', elementType: 'node', title: 'Controller', text: 'Retains operator commands.', diagramId: 'private-diagram-id', diagramHash: 'private-fingerprint', diagramTitle: 'Vehicle Level 1', level: '1', ownerProjects: [{ id: 'opaque-owner', workspaceType: 'functional' }], element: { id: 'symbol:controller', files: ['controller.cpp'], architectures: [{ subsystem: 'Control', csci: 'Controller' }] } };

test('saved evidence uses prose, named fields and safe web links without payloads or fingerprints', () => {
  const source = { ...node, attributes: { responseBudget: { value: 10, units: 'ms' }, enabled: false, tags: ['Control', 'Safety'], serialized: '{"reviewed":true}' }, sourceRefs: [{ title: 'Interface guide', url: 'https://example.org/interface' }, { title: 'Unsafe address', url: 'javascript:alert(1)' }] };
  act(() => root.render(<SourceEvidenceDetails source={source} />));
  for (const text of ['Retains operator commands.', 'Vehicle program', 'Response Budget', 'Units: ms', 'No', 'Control; Safety', 'Reviewed: Yes', 'controller.cpp']) expect(host.textContent).toContain(text);
  expect(host.querySelector('pre')).toBeNull();
  for (const text of ['private-fingerprint', 'private-source-id', 'opaque-owner', '[object Object]', '{"reviewed"']) expect(host.textContent).not.toContain(text);
  const links = [...host.querySelectorAll('a')]; expect(links).toHaveLength(1); expect(links[0].href).toBe('https://example.org/interface'); expect(links[0].rel).toContain('noopener');
});
test('document evidence links open readable saved architecture evidence and the diagram', () => {
  const diagram = { id: node.diagramId, diagramHash: node.diagramHash, workspaceType: 'functional', title: 'Vehicle Level 1', sourceType: 'architecture-diagram', snapshot: { nodes: [], edges: [] } };
  const source = { title: 'Command retention', sourceType: 'artifact-object', artifactTitle: 'System Specification', revision: 2, text: 'The controller shall retain commands.', architectureEvidence: [node] };
  act(() => root.render(<ArchitectureEvidence source={source} manifest={{ entries: [diagram, node] }} />));
  expect(host.textContent).toContain('Revision 2');
  act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'Controller').click());
  expect(host.textContent).toContain('Retains operator commands.');
  act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'View source diagram').click());
  expect(host.textContent).toContain('Saved project diagram'); expect(host.querySelector('pre')).toBeNull();
});
test('module sources retain table content and folder/module labels', () => {
  act(() => root.render(<SourceEvidenceDetails source={{ title: 'Operational need', rowId: 'row', folderId: 'folder', moduleId: 'module', content: { type: 'table', table: { cells: [['Mode', 'State'], ['Standby', false]] } } }} manifest={{ modules: [{ folderId: 'folder', moduleId: 'module', folderName: 'Vehicle designs', name: 'Needs' }] }} />));
  expect(host.textContent).toContain('Vehicle designs'); expect(host.textContent).toContain('Needs'); expect(host.querySelector('table').textContent).toContain('StandbyNo');
});
test('structured attribute fields preserve numeric and boolean types and update nested values', () => {
  const original = { threshold: 12, approved: false, reviewers: ['A'] }; const changed = jest.fn();
  act(() => root.render(<StructuredAttributeInput value={original} onChange={changed} />));
  expect([...host.querySelectorAll('input')].every(input => !input.value.includes('{'))).toBe(true);
  act(() => { const input = host.querySelector('input[type=number]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '15'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(changed).toHaveBeenLastCalledWith({ ...original, threshold: 15 });
  act(() => host.querySelector('input[type=checkbox]').click()); expect(changed).toHaveBeenLastCalledWith({ ...original, approved: true });
  expect(original.threshold).toBe(12);
});
test('readable project reports link records and escape source text; document exports name supporting sources', () => {
  const object = { id: 'object', kind: 'requirement', title: 'Retain commands', text: '<script>alert(1)</script>', sourceIds: ['private-source-id'], sourceEvidence: [node] };
  const revision = { number: 1, objects: [object], sources: { entries: [node] } };
  const contents = { program: { title: 'Vehicle design', config: { system: 'Vehicle' }, ownerProjects: node.ownerProjects }, records: [{ meta: { id: 'artifact', title: 'System specification' }, revision }], traceability: { nodes: [{ id: 'artifact', title: 'System specification' }, { id: 'object', title: object.title }, { id: 'source', title: node.title, evidence: node }], links: [{ from: 'object', to: 'source', type: 'derived-from-diagram' }], gaps: [] } };
  const report = new DOMParser().parseFromString(engineeringProjectReport(contents), 'text/html');
  expect(report.querySelector('script')).toBeNull(); expect(report.body.textContent).toContain('Derived from diagram');
  for (const link of report.querySelectorAll('a[href^="#"]')) expect(report.getElementById(link.getAttribute('href').slice(1))).not.toBeNull();
  expect(report.body.textContent).not.toContain('private-source-id');
  const markdown = artifactMarkdown({ title: 'System specification' }, revision); expect(markdown).toContain('Sources: Controller'); expect(markdown).not.toContain('private-source-id');
});
