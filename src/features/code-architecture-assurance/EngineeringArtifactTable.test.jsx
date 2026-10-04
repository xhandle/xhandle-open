global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('lucide-react', () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const EngineeringArtifactTable = require('./EngineeringArtifactTable').default;
const { ARTIFACT_DEFINITIONS } = require('./artifactDefinitions');

describe('engineering table Markdown copying', () => {
  let host, root, writeText;
  beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div'); document.body.appendChild(host);
    root = createRoot(host);
    writeText = jest.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); });
  it.each(Object.values(ARTIFACT_DEFINITIONS))('copies $title with its actual column headers', async definition => {
    act(() => root.render(<EngineeringArtifactTable rows={[{ id: 'R-1', source: 'hazard-derived' }]}
      columns={definition.columns} copyLabel={`Copy ${definition.title} table`} showActions={false} showReview={false} />));
    await act(async () => host.querySelector('[aria-label^="Copy "]').click());
    const text = writeText.mock.calls[0][0];
    expect(text.split('\n')[0]).toContain(definition.columns[0].label);
    expect(text).toContain('R-1');
    expect(text).not.toContain('[object Object]');
    if (definition.title === 'Software Requirements') expect(text).toContain('Hazard Analysis');
  });
  it('copies filtered rows, visible columns, and resolved parent links', async () => {
    localStorage.setItem('copy-test:hidden-columns', JSON.stringify(['secret']));
    act(() => root.render(<EngineeringArtifactTable storageKey="copy-test" showActions={false} showReview={false}
      columns={[{ key:'id', label:'ID' }, { key:'parentSwRequirement', label:'Parent' }, { key:'secret', label:'Hidden' }]}
      rows={[
        { id:'Keep', traceLinks:[{ targetType:'software-requirement', targetId:'SWR-1' }], secret:'private-cell' },
        { id:'Exclude' },
      ]} />));
    act(() => host.querySelector('[title="Filter ID"]').click());
    act(() => [...host.querySelectorAll('label')].find(node => node.textContent === 'Keep').querySelector('input').click());
    await act(async () => host.querySelector('[aria-label="Copy table"]').click());
    expect(writeText).toHaveBeenCalledWith('| ID | Parent |\n| --- | --- |\n| Keep | SWR-1 |');
  });
  it('disables copying when the table is empty', () => {
    act(() => root.render(<EngineeringArtifactTable columns={[{ key:'id', label:'ID' }]} rows={[]} />));
    expect(host.querySelector('[aria-label="Copy table"]').disabled).toBe(true);
  });
});
