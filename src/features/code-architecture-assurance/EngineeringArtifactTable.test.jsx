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

it('clears the engineering cell highlight with collaborator context and allows reselection', () => {
  const host=document.createElement('div');document.body.appendChild(host);
  const root=createRoot(host);const onSelection=jest.fn();
  const render=selection=>root.render(<EngineeringArtifactTable rows={[{id:'R-1',requirementText:'Limit torque'}]} columns={[{key:'requirementText',label:'Requirement'}]} showActions={false} showReview={false} collaboratorSelection={selection} onCollaboratorSelectionChange={onSelection} />);
  const cell=()=>Array.from(host.querySelectorAll('td')).find(node=>node.textContent==='Limit torque');
  try {
    act(()=>render(null));act(()=>cell().click());
    const selected=onSelection.mock.calls[0][0];expect(selected.kind).toBe('table-cell');
    act(()=>render(selected));expect(cell().className).toContain('bg-blue-100');
    act(()=>render(null));expect(cell().className).not.toContain('bg-blue-100');
    act(()=>cell().click());expect(onSelection.mock.calls.at(-1)[0]).toMatchObject({kind:'table-cell'});
  } finally {act(()=>root.unmount());host.remove();}
});

describe('large engineering table windowing', () => {
  let host, root, rows, columns, evaluations;
  beforeEach(() => {
    jest.useFakeTimers();localStorage.clear();
    host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
    rows=Array.from({length:1000},(_,i)=>({id:`R-${i}`,requirementText:`Requirement ${i}`}));
    evaluations=0;
    columns=[{key:'id',label:'ID'},{key:'requirementText',label:'Requirement',getValue:row=>{evaluations++;return row.requirementText;}}];
  });
  afterEach(()=>{act(()=>root.unmount());host.remove();jest.useRealTimers();});
  const render = (extra={}) => act(()=>root.render(<EngineeringArtifactTable rows={rows} columns={columns} showActions={false} showReview={false} {...extra}/>));
  it('bounds DOM and selection work, while copying all filtered rows', async()=>{
    const writeText=jest.fn().mockResolvedValue();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
    render();act(()=>jest.runAllTimers());
    expect(host.querySelectorAll('[data-virtual-key]').length).toBeLessThan(30);
    evaluations=0;act(()=>host.querySelector('tbody td').click());
    expect(evaluations).toBeLessThan(30);
    await act(async()=>host.querySelector('[aria-label="Copy table"]').click());
    expect(writeText.mock.calls[0][0]).toContain('Requirement 999');
    expect(writeText.mock.calls[0][0].split('\n')).toHaveLength(1002);
  });
  it('reveals distant targets and keeps an active editor mounted',()=>{
    columns=[{key:'requirementText',label:'Requirement',longText:true}];
    render();act(()=>jest.runAllTimers());
    act(()=>host.querySelector('tbody button').click());
    const editor=host.querySelector('textarea');expect(editor).not.toBeNull();
    render({highlightedRowIds:['R-999'],focusRequestKey:'far'});
    expect(host.textContent).toContain('Requirement 999');
    expect(editor.isConnected).toBe(true);
    expect(host.querySelectorAll('[data-virtual-key]').length).toBeLessThan(30);
  });
  it('searches offscreen rows and reveals a matching result',()=>{
    render();act(()=>jest.runAllTimers());
    host.querySelector('table').getClientRects=()=>[{width:100,height:100}];
    const {tableSearchEntries}=require('../../components/quickSearchUtils');
    const entries=tableSearchEntries(host);
    expect(entries).toHaveLength(1000);
    const target=entries.find(entry=>entry.text.includes('Requirement 999'));
    act(()=>target.activate());
    expect(host.textContent).toContain('Requirement 999');
    expect(host.querySelectorAll('[data-virtual-key]').length).toBeLessThan(30);
  });

});

it('uses one indicator across loading and preparation and retains prepared rows during refresh', () => {
  jest.useFakeTimers();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const rows = Array.from({ length: 250 }, (_, i) => ({ id: String(i) }));
  const render = loading => root.render(<EngineeringArtifactTable rows={rows} columns={[{ key: 'id', label: 'ID' }]}
    loading={loading} loadingLabel="Loading requirements" preparationLabel="Preparing requirements" />);
  try {
    act(() => render(true));
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
    expect(host.querySelector('[role="progressbar"]').getAttribute('aria-label')).toBe('Loading requirements');
    act(() => render(false));
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
    expect(host.querySelector('[role="progressbar"]').getAttribute('aria-label')).toBe('Preparing requirements');
    act(() => jest.runAllTimers());
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
    const table = host.querySelector('table');
    act(() => render(true));
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
    expect(host.querySelector('table')).toBe(table);
    act(() => render(false));
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  } finally {
    act(() => root.unmount());
    host.remove();
    jest.useRealTimers();
  }
});
