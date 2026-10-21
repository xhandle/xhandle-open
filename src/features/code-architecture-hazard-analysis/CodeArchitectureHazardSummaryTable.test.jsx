global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("lucide-react", () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const CodeArchitectureHazardSummaryTable = require("./CodeArchitectureHazardSummaryTable").default;

describe("CodeArchitectureHazardSummaryTable grouping", () => {
  it("shows context variants directly beneath one collapsible interface header", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const summarySheet = [
      [
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Guide Phrase",
        "Operational Context ID",
        "Operational Scenario",
        "Operational Mode",
      ],
      ["Estimate Pose", "Pose Estimate", "Plan Motion", "Not provided", "urban", "Dense urban intersection", "Mission execution"],
      ["Estimate Pose", "Pose Estimate", "Plan Motion", "Too late", "degraded", "Rain-reduced visibility", "Degraded operation"],
    ];

    act(() => root.render(
      <CodeArchitectureHazardSummaryTable
        summarySheet={summarySheet}
        storageKey="test:cba-hazard-summary-context-groups"
        showReview={false}
      />
    ));

    try {
      expect(host.textContent).toContain("2 analysis variants");
      expect(host.textContent).toContain("Dense urban intersection · Mission execution");
      expect(host.textContent).toContain("Rain-reduced visibility · Degraded operation");
      const collapseButtons = host.querySelectorAll("tbody button[aria-expanded]");
      expect(collapseButtons).toHaveLength(1);

      act(() => collapseButtons[0].click());
      expect(host.textContent).not.toContain("Dense urban intersection · Mission execution");
      expect(host.textContent).not.toContain("Rain-reduced visibility · Degraded operation");
    } finally {
      act(() => root.unmount());
      host.remove();
      localStorage.removeItem("test:cba-hazard-summary-context-groups:hidden-columns");
      localStorage.removeItem("test:cba-hazard-summary-context-groups:column-widths");
    }
  });
});

it('labels and opens Functional diagram links when the row has a generated Functional trace', () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const open = jest.fn();
  const summarySheet = [
    ['Function (From)', 'Control Action', 'Function (To)', 'Trace ID'],
    ['Prepare Output', 'Send output', 'Receive Output', 'functional-relationship:test'],
  ];
  try {
    act(() => root.render(<CodeArchitectureHazardSummaryTable showReview={false} storageKey="test:functional-hazard-link" summarySheet={summarySheet}
      functionalTraceIds={new Set(['functional-relationship:test'])} onOpenArchitectureTarget={open} />));
    const link = host.querySelector('button[aria-label="Open Control Action in the Functional diagram view"]');
    expect(link).not.toBeNull();
    act(() => link.click());
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'functional-relationship:test', type: 'edge' }));
  } finally { act(() => root.unmount()); host.remove(); localStorage.removeItem('test:functional-hazard-link:hidden-columns'); localStorage.removeItem('test:functional-hazard-link:column-widths'); }
});

it('copies only the selected operational context and visible hazard columns', async () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const writeText = jest.fn().mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const storageKey = 'test:copy-context';
  try {
    act(() => root.render(<CodeArchitectureHazardSummaryTable showReview={false} storageKey={storageKey}
      selectedOperationalContextId="urban" summarySheet={[
        ['Function (From)', 'Control Action', 'Function (To)', 'Operational Context ID', 'Operational Scenario', 'Operational Mode'],
        ['Plan', 'Stop', 'Control', 'urban', 'Curbside', 'Remote'],
        ['Plan', 'Go', 'Control', 'highway', 'Highway', 'Autonomous'],
      ]} />));
    await act(async () => host.querySelector('[aria-label="Copy code architecture hazard analysis table"]').click());
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain('| Operational context | Function (From) | Control Action | Function (To) |');
    expect(copied).toContain('| Curbside · Remote | Plan | Stop | Control |');
    expect(copied).not.toContain('Highway');
    expect(copied).not.toContain('Operational Context ID');
  } finally {
    act(() => root.unmount()); host.remove();
    localStorage.removeItem(`${storageKey}:hidden-columns`);
    localStorage.removeItem(`${storageKey}:column-widths`);
  }
});

it('reveals a linked row inside a collapsed group and acknowledges repeated requests', () => {
  jest.useFakeTimers();
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const resolved = jest.fn();
  const sheet = [['Function (From)', 'Control Action', 'Function (To)'], ['Plan', 'Stop', 'Control']];
  const render = (key, row) => act(() => root.render(<CodeArchitectureHazardSummaryTable
    showReview={false} summarySheet={sheet} focusRequestKey={key} highlightedRowIndex={row}
    onRowFocusResolved={resolved} />));
  try {
    render(null, null);
    act(() => host.querySelector('tbody button[aria-expanded]').click());
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    render('first', 0);
    act(() => jest.advanceTimersByTime(100));
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(resolved).toHaveBeenLastCalledWith('first');
    render('second', 0);
    act(() => jest.advanceTimersByTime(100));
    expect(resolved).toHaveBeenLastCalledWith('second');
  } finally { act(() => root.unmount()); host.remove(); jest.useRealTimers(); }
});
it('requests all contexts when a linked hazard is hidden by the selected context', () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host); const change = jest.fn();
  try {
    act(() => root.render(<CodeArchitectureHazardSummaryTable showReview={false}
      highlightedRowIndex={0} focusRequestKey="context-link" selectedOperationalContextId="highway"
      onSelectedOperationalContextChange={change} summarySheet={[
        ['Function (From)', 'Control Action', 'Function (To)', 'Operational Context ID'],
        ['Plan', 'Stop', 'Control', 'urban'],
      ]} />));
    expect(change).toHaveBeenCalledWith('all');
  } finally { act(() => root.unmount()); host.remove(); }
});

it('defaults STPA to the requested columns and retains picker customization', () => {
  const { STPA_DEFAULT_COLUMNS } = require('./CodeArchitectureHazardSummaryTable');
  const storageKey = 'test:stpa-focused';
  const headers = [...STPA_DEFAULT_COLUMNS, 'Context Assumptions', 'Protection Assessment', 'Protection Status', 'Physical-Harm Chain Termination', 'Assumptions', 'Confidence'];
  const sheet = [headers, headers.map(() => 'Example')];
  // Previously saved defaults must not prevent adoption of the new default view.
  localStorage.setItem(`${storageKey}:hidden-columns`, '[]');
  localStorage.setItem(`${storageKey}:hidden-columns:stpa-focused-v2`, '[]');
  const host = document.createElement('div'); document.body.appendChild(host);
  let root = createRoot(host);
  const render = () => root.render(<CodeArchitectureHazardSummaryTable summarySheet={sheet} hazardMethod="STPA-Textbook" storageKey={storageKey} />);
  try {
    act(render);
    expect(host.querySelectorAll('thead th')).toHaveLength(STPA_DEFAULT_COLUMNS.length);
    const headingText = host.querySelector('thead').textContent;
    STPA_DEFAULT_COLUMNS.forEach(name => expect(headingText).toContain(name));
    expect(headingText).not.toContain('Operational context');
    expect(headingText).not.toContain('Protection Assessment');
    expect(headingText).not.toContain('Context Assumptions');
    act(() => Array.from(host.querySelectorAll('button')).find(button => button.title === 'Show or hide table columns').click());
    act(() => Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Show all').click());
    expect(host.querySelectorAll('thead th')).toHaveLength(headers.length);
    act(() => root.unmount());
    root = createRoot(host); act(render);
    expect(host.querySelectorAll('thead th')).toHaveLength(headers.length);
  } finally {
    act(() => root.unmount()); host.remove();
    localStorage.removeItem(`${storageKey}:hidden-columns`);
    localStorage.removeItem(`${storageKey}:hidden-columns:stpa-focused-v2`);
    localStorage.removeItem(`${storageKey}:hidden-columns:stpa-focused-v5`);
    localStorage.removeItem(`${storageKey}:column-widths`);
  }
});

it('defaults HARA to the requested columns with legacy field labels and persistent customization', () => {
  const { HARA_DEFAULT_COLUMNS } = require('./CodeArchitectureHazardSummaryTable');
  const storageKey='test:hara-focused';
  const headers=[...HARA_DEFAULT_COLUMNS].reverse().map(name=>name==='Function'?'Item / Function':name==='Malfunctioning Behavior'?'Malfunction':name).concat(['Rationale','Safety Significant']);
  const sheet=[headers,headers.map(name=>`Value: ${name}`)];
  localStorage.setItem(`${storageKey}:hidden-columns`,'[]');
  const host=document.createElement('div');document.body.appendChild(host);
  let root=createRoot(host);
  const render=()=>root.render(<CodeArchitectureHazardSummaryTable summarySheet={sheet} hazardMethod="HARA" storageKey={storageKey} />);
  try {
    act(render);
    const headings=Array.from(host.querySelectorAll('thead th'));
    expect(headings).toHaveLength(HARA_DEFAULT_COLUMNS.length);
    headings.forEach((heading,index)=>expect(heading.textContent).toContain(HARA_DEFAULT_COLUMNS[index]));
    expect(host.textContent).toContain('Value: Item / Function');
    expect(host.textContent).toContain('Value: Malfunction');
    expect(host.querySelector('thead').textContent).not.toContain('Operational context');
    act(()=>Array.from(host.querySelectorAll('button')).find(button=>button.title==='Show or hide table columns').click());
    act(()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Show all').click());
    expect(host.querySelectorAll('thead th')).toHaveLength(headers.length);
    act(()=>root.unmount());root=createRoot(host);act(render);
    expect(host.querySelectorAll('thead th')).toHaveLength(headers.length);
    expect(sheet[0]).toEqual(headers);
  } finally {
    act(()=>root.unmount());host.remove();
    for(const suffix of [':hidden-columns',':hidden-columns:hara-focused-v2',':column-widths']) localStorage.removeItem(storageKey+suffix);
  }
});

it('defaults FHA to the requested ordered columns without inventing missing rationales or changing saved rows', () => {
  const { FHA_DEFAULT_COLUMNS } = require('./CodeArchitectureHazardSummaryTable');
  const storageKey='test:fha-focused';
  const headers=['Verification','Function (To)','Mishap','Function (From)','Control Action','Operational Scenario','Operational Mode','Rationale','Software Criticality Index'];
  const sheet=[headers,['Test torque','Brake','Collision','Planner','Apply torque','Road driving','Automatic','General rationale','SwCI 1']];
  const original=JSON.stringify(sheet);
  const onVisibleSummaryChange=jest.fn();
  localStorage.setItem(`${storageKey}:hidden-columns`,'[]');
  const host=document.createElement('div');document.body.appendChild(host);
  let root=createRoot(host);
  const render=()=>root.render(<CodeArchitectureHazardSummaryTable summarySheet={sheet} hazardMethod="FHA" storageKey={storageKey} onVisibleSummaryChange={onVisibleSummaryChange} />);
  try {
    act(render);
    const headings=Array.from(host.querySelectorAll('thead th'));
    expect(headings).toHaveLength(FHA_DEFAULT_COLUMNS.length);
    headings.forEach((heading,index)=>expect(heading.textContent).toContain(FHA_DEFAULT_COLUMNS[index]));
    expect(host.textContent).toContain('Road driving · Automatic');
    expect(host.textContent).not.toContain('General rationale');
    expect(onVisibleSummaryChange).toHaveBeenLastCalledWith(sheet);
    expect(JSON.stringify(sheet)).toBe(original);
    act(()=>Array.from(host.querySelectorAll('button')).find(button=>button.title==='Show or hide table columns').click());
    act(()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Show all').click());
    expect(host.querySelector('thead').textContent).toContain('Operational Scenario');
    act(()=>root.unmount());root=createRoot(host);act(render);
    expect(host.querySelector('thead').textContent).toContain('Operational Scenario');
  } finally {
    act(()=>root.unmount());host.remove();
    for(const suffix of [':hidden-columns',':hidden-columns:fha-focused-v2',':column-widths']) localStorage.removeItem(storageKey+suffix);
  }
});

it('clears the hazard cell highlight when collaborator context is removed and allows reselection', () => {
  const host=document.createElement('div');document.body.appendChild(host);
  const root=createRoot(host);const onSelection=jest.fn();
  const sheet=[['Function (From)','Control Action','Function (To)'],['Sender','Command','Receiver']];
  const render=selection=>root.render(<CodeArchitectureHazardSummaryTable summarySheet={sheet} collaboratorSelection={selection} onCollaboratorSelectionChange={onSelection} />);
  const cell=()=>Array.from(host.querySelectorAll('td')).find(node=>node.textContent.startsWith('Command'));
  try {
    act(()=>render(null));act(()=>cell().click());
    const selected=onSelection.mock.calls[0][0];expect(selected.kind).toBe('table-cell');
    act(()=>render(selected));expect(cell().className).toContain('bg-blue-100');
    act(()=>render(null));expect(cell().className).not.toContain('bg-blue-100');
    act(()=>cell().click());expect(onSelection.mock.calls.at(-1)[0]).toMatchObject({kind:'table-cell'});
  } finally {act(()=>root.unmount());host.remove();}
});

it('quick search indexes unmounted hazard cells and excludes hidden columns and collapsed groups', async()=>{
 const {tableSearchEntries,filterSearchEntries}=require('../../components/quickSearchUtils');
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const prior=global.IntersectionObserver;
 const priorRect=Element.prototype.getBoundingClientRect;
 Element.prototype.getBoundingClientRect=function(){return {height:this.tagName==='TR'?400:800};};
 global.IntersectionObserver=class {observe(){} unobserve(){} disconnect(){}};
 const sheet=[['Function','Guide Phrase','Hazard','Private metadata'],...Array.from({length:25},(_,i)=>['Controller',`Phrase ${i}`,`Hazard token${i}`,'hidden-only-value'])];
 try{
  act(()=>root.render(<CodeArchitectureHazardSummaryTable hazardMethod="STPA" summarySheet={sheet} storageKey="search-deferred-hazard"/>));
  const table=host.querySelector('table');table.getClientRects=()=>[{}];
  const entries=tableSearchEntries(host);
  expect(filterSearchEntries(entries,'token24')).toHaveLength(1);
  expect(filterSearchEntries(entries,'hidden-only-value')).toHaveLength(0);
  expect(host.querySelector('#cba-hazard-row-24')).toBeNull();
  const priorScroll=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=jest.fn();
  try{
   await act(async()=>{filterSearchEntries(entries,'token24')[0].activate('token24');await new Promise(resolve=>setTimeout(resolve,60));});
   expect(host.querySelector('#cba-hazard-row-24')).not.toBeNull();
  }finally{if(priorScroll)Element.prototype.scrollIntoView=priorScroll;else delete Element.prototype.scrollIntoView;}
  await act(async()=>{table.parentElement.scrollTop=0;table.parentElement.dispatchEvent(new Event('scroll'));await new Promise(resolve=>setTimeout(resolve,60));});
  act(()=>host.querySelector('button[aria-expanded="true"]').click());
  expect(filterSearchEntries(tableSearchEntries(host),'token24')).toHaveLength(0);
 }finally{act(()=>root.unmount());host.remove();global.IntersectionObserver=prior;Element.prototype.getBoundingClientRect=priorRect;}
});

it('bounds mounted rows while preserving full filtered count/export model and revealing distant links',()=>{
 jest.useFakeTimers();
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const sheet=[['Function','Control Action','Guide Phrase','Operational Context ID'],...Array.from({length:1000},(_,i)=>[`Function ${i}`,`Command ${i}`,'Not provided','one'])];
 const priorRect=Element.prototype.getBoundingClientRect;
 Element.prototype.getBoundingClientRect=function(){return {height:this.tagName==='TR'?400:800};};
 const onRowFocusResolved=jest.fn();
 const onVisibleSummaryChange=jest.fn();
 const render=extra=>act(()=>root.render(<CodeArchitectureHazardSummaryTable summarySheet={sheet} storageKey="window-test" onVisibleSummaryChange={onVisibleSummaryChange} onRowFocusResolved={onRowFocusResolved} {...extra}/>));
 try{
  render({});
  act(()=>jest.runAllTimers());
  expect(host.querySelectorAll('tbody tr').length).toBeLessThan(80);
  expect(host.textContent).toContain('1000 of 1000');expect(onVisibleSummaryChange.mock.calls.at(-1)[0]).toHaveLength(1001);
  render({highlightedRowIndex:999,focusRequestKey:'last'});
  expect(onRowFocusResolved).toHaveBeenCalledWith('last');
  expect(host.querySelector('#cba-hazard-row-999')).not.toBeNull();expect(host.querySelectorAll('tbody tr').length).toBeLessThan(80);
 }finally{act(()=>root.unmount());host.remove();Element.prototype.getBoundingClientRect=priorRect;jest.useRealTimers();}
});

it('shows one progress indicator for a large saved table and resolves its initial distant focus after preparation',()=>{
 jest.useFakeTimers();
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const sheet=[['Raw Analysis Row ID','Function (From)','Control Action'],...Array.from({length:6000},(_,i)=>['HA-'+i,'Function '+Math.floor(i/7),'Command'])];
 const resolved=jest.fn();
 try {
  act(()=>root.render(<CodeArchitectureHazardSummaryTable summarySheet={sheet} highlightedRowIndex={5999} focusRequestKey="large-last" onRowFocusResolved={resolved}/>));
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  expect(host.querySelector('table')).toBeNull();
  act(()=>jest.runAllTimers());
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
  expect(host.querySelector('#cba-hazard-row-5999')).not.toBeNull();
  expect(resolved).toHaveBeenCalledWith('large-last');
  expect(host.querySelectorAll('tbody tr').length).toBeLessThan(80);
 } finally {act(()=>root.unmount());host.remove();jest.useRealTimers();}
});
