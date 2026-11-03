global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("lucide-react", () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});
jest.mock("./CodeArchitectureHazardSummaryTable", () => function MockSummary() {
  return <div>Summary</div>;
});

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const CodeArchitectureHazardPanel = require("./CodeArchitectureHazardPanel").default;

function renderPanel(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<CodeArchitectureHazardPanel
    method="STPA-Textbook"
    operationalContexts={[]}
    cbaRows={[]}
    {...props}
  />));
  return { host, root };
}

it('offers explicit regeneration for missing source data without treating it as an absent saved analysis',()=>{
  const onRunAnalysis=jest.fn();
  const {host,root}=renderPanel({onRunAnalysis,cbaRows:[{from:'Estimate Pose',action:'Publish pose estimate',to:'Plan Motion'}],
    restoration:{status:'failed',errorCode:'HAZARD_SOURCE_INCOMPLETE',error:'Saved hazard results are incomplete.'}});
  try {
    const button=[...host.querySelectorAll('button')].find(item=>item.textContent==='Start a new hazard analysis');
    expect(button).toBeTruthy();expect(button.disabled).toBe(false);
    expect(onRunAnalysis).not.toHaveBeenCalled();act(()=>button.click());
    expect(onRunAnalysis).toHaveBeenCalledWith('STPA-Textbook',{regenerate:true});
    expect(host.textContent).toContain('Existing saved records are retained');
    expect(host.textContent).not.toContain('Upgrade saved table storage');
  } finally {act(()=>root.unmount());host.remove();}
});

it('hides review notices without changing unresolved applicability or preprocessing conflicts', () => {
  const headers = ['Raw Analysis Row ID', 'Guide Phrase Applicable', 'Guide Phrase Applicability Origin', 'Hazards'];
  const latestRun = {userPreprocessingConflicts: ['Saved assessment needs reconciling'], generatedSheets: {Summary: [headers, ['RAW-1', 'Needs Review', 'Automatic screening', 'Needs review: unresolved applicability']]}};
  const {host, root} = renderPanel({latestRun});
  try {
    expect(host.textContent).not.toContain('guide-phrase decisions need review');
    expect(host.textContent).not.toContain('User preprocessing needs review');
    expect(latestRun.generatedSheets.Summary[1][1]).toBe('Needs Review');
    expect(latestRun.userPreprocessingConflicts).toEqual(['Saved assessment needs reconciling']);
    act(() => root.render(<CodeArchitectureHazardPanel method="STPA-Textbook" operationalContexts={[]} cbaRows={[]}
      latestRun={{...latestRun, generatedSheets: {Summary: [headers, ['RAW-1', 'Yes', 'Automatic screening', 'Needs review: downstream assessment pending']]}}} />));
    expect(host.textContent).not.toContain('guide-phrase decisions need review');
  } finally { act(() => root.unmount()); host.remove(); }
});

describe("CodeArchitectureHazardPanel eligibility gate", () => {
  it("shows include, exclude, and review counts and runs only when rows are included", () => {
    const onRunAnalysis = jest.fn();
    const { host, root } = renderPanel({
      onRunAnalysis,
      cbaRows: [
        { from: "Estimate Pose", action: "Publish pose estimate", to: "Plan Motion" },
        { from: "Config", action: "Define __init__", to: "__init__" },
        { from: "helper_a", action: "Call helper_b", to: "helper_b", fromFile: "src/utils.py" },
      ],
    });
    try {
      expect(host.textContent).toContain("1 included · 1 excluded · 1 need review");
      expect(host.textContent).toContain("unresolved rows will not be analyzed");
      const runButton = Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent.includes("Run hazard analysis"));
      expect(runButton.disabled).toBe(false);
      act(() => runButton.click());
      expect(onRunAnalysis).toHaveBeenCalledWith("STPA-Textbook");
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("disables analysis when no rows are marked Include", () => {
    const { host, root } = renderPanel({
      cbaRows: [{ from: "Config", action: "Define __init__", to: "__init__" }],
    });
    try {
      const runButton = Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent.includes("Run hazard analysis"));
      expect(runButton.disabled).toBe(true);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});

it('enables draft export/import before an AI run and saves only confirmed CSV edits', async () => {
  const draftRun = { generatedSheets: { Summary: [
    ['Raw Analysis Row ID', 'Causal Scenario'], ['RAW-1', ''], ['RAW-2', ''],
  ] } };
  const onImportSummary = jest.fn().mockResolvedValue();
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  const alert = jest.spyOn(window, 'alert').mockImplementation(() => {});
  const importInputRef = React.createRef();
  const { host, root } = renderPanel({ draftRun, onImportSummary, latestRun: null, importInputRef });
  try {
    for (const label of ['Export CSV', 'Import CSV…']) {
      expect([...host.querySelectorAll('button')].find(button => button.textContent === label).disabled).toBe(false);
    }
    expect(host.textContent).toContain('Incomplete hazard analysis draft');
    const input = importInputRef.current;
    expect(input).toBe(host.querySelector('input[type="file"]'));
    Object.defineProperty(input, 'files', { value: [{ text: async () => 'Raw Analysis Row ID,Causal Scenario\nRAW-1,Completed scenario' }] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onImportSummary).not.toHaveBeenCalled();
    expect(host.textContent).toContain('CSV validated');
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Apply CSV import').click(); });
    expect(onImportSummary).toHaveBeenCalledWith([
      ['Raw Analysis Row ID', 'Causal Scenario'], ['RAW-1', 'Completed scenario'], ['RAW-2', ''],
    ], null);
    expect(host.textContent).toContain('Imported updates to 1 rows.');
    expect(alert).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount()); host.remove(); confirm.mockRestore(); alert.mockRestore();
  }
});

it('keeps hazard tools in the table pane and mounts the diagram only in split view', () => {
  const onSplitViewChange = jest.fn();
  const props = { diagram: <div data-testid="hazard-split-diagram" />, onSplitViewChange };
  const { host, root } = renderPanel(props);
  try {
    expect(host.querySelector('[data-testid="hazard-split-diagram"]')).toBeNull();
    const toggle = [...host.querySelectorAll('button')].find(button => button.textContent === 'Split view');
    act(() => toggle.click());
    expect(onSplitViewChange).toHaveBeenCalledWith(true);
    act(() => root.render(<CodeArchitectureHazardPanel {...props} splitView method="STPA-Textbook" />));
    expect(host.querySelector('[data-testid="hazard-split-diagram"]')).not.toBeNull();
    const tablePane = host.querySelector('[aria-label="Code architecture hazard analysis table"]');
    expect(tablePane.textContent).toContain('Table only');
    expect(tablePane.textContent).toContain('Export CSV');
    expect(host.querySelector('[aria-label="Resize diagram and table panes"]')).not.toBeNull();
  } finally { act(() => root.unmount()); host.remove(); }
});

it('shows save failures inline and retains the preview for retry', async () => {
  const draftRun = {generatedSheets:{Summary:[['Raw Analysis Row ID','Guide Phrase Applicable'],['RAW-1','']]}};
  const onImportSummary = jest.fn().mockRejectedValue(new Error('fixture storage failure'));
  const {host,root}=renderPanel({draftRun,latestRun:null,onImportSummary});
  try {
    const input=host.querySelector('input[type="file"]');
    Object.defineProperty(input,'files',{value:[{text:async()=> 'Raw Analysis Row ID,Guide Phrase Applicable\nRAW-1,No'}]});
    await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));});
    await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='Apply CSV import').click();});
    expect(host.querySelector('[role="status"]').textContent).toContain('fixture storage failure');
    expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Apply CSV import')).toBe(true);
  } finally {act(()=>root.unmount());host.remove();}
});

it('reports unchanged CSVs inline without a browser alert', async () => {
  const draftRun={generatedSheets:{Summary:[['Raw Analysis Row ID','Guide Phrase Applicable'],['RAW-1','Yes']]}};
  const onImportSummary=jest.fn();
  const {host,root}=renderPanel({draftRun,latestRun:null,onImportSummary});
  try {
    const input=host.querySelector('input[type="file"]');
    Object.defineProperty(input,'files',{value:[{text:async()=> 'Raw Analysis Row ID,Guide Phrase Applicable\nRAW-1,Yes'}]});
    await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(host.querySelector('[role="status"]').textContent).toContain('Every row already matches');
    expect(onImportSummary).not.toHaveBeenCalled();
  } finally {act(()=>root.unmount());host.remove();}
});

it('shows the shared working icon and preparation percentage instead of the old message',()=>{
 const {host,root}=renderPanel({draftLoading:true,draftProgress:42});
 try{
  const progress=host.querySelector('[role="progressbar"]');
  expect(progress.getAttribute('aria-valuenow')).toBe('42');
  expect(progress.textContent).toBe('Preparing hazard analysis… 42%');
  expect(progress.querySelector('.xhandle-working-mark img').getAttribute('src')).toBe('/favicon.png');
  expect(host.textContent).not.toContain('Preparing hazard table…');
 }finally{act(()=>root.unmount());host.remove();}
});

it.each(['loading', 'failed'])('does not present a draft or generation action while restoration is %s', status => {
  const retry = jest.fn(), generate = jest.fn();
  const {host, root} = renderPanel({
    restoration:{status, error:status==='failed'?'Storage unavailable':'',retry},
    draftRun:{generatedSheets:{Summary:[['Function'],['Draft function']]}}, onRunAnalysis:generate,
  });
  try {
    expect(host.textContent).not.toContain('Incomplete hazard analysis draft');
    expect(host.textContent).not.toContain('Run hazard analysis');
    expect(host.textContent).toContain(status==='loading'?'Loading saved results':'Unable to load saved results');
    if (status === 'loading') {
      expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
      expect(host.querySelector('button')).toBeNull();
    } else {
      act(()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Retry loading').click());
      expect(retry).toHaveBeenCalledTimes(1);
    }
    expect(generate).not.toHaveBeenCalled();
  } finally {act(()=>root.unmount());host.remove();}
});
it('keeps the summary visible with a separate refresh failure notice',()=>{
  const {host,root}=renderPanel({latestRun:{generatedSheets:{Summary:[['Function'],['Saved function']]}},restoration:{status:'failed',error:'busy',retry:jest.fn()}});
  try {expect(host.textContent).toContain('Previously loaded results are still shown');expect(host.textContent).toContain('Summary');}
  finally{act(()=>root.unmount());host.remove();}
});
it('does not show a routine restoration loader beside already available results',()=>{
 const {host,root}=renderPanel({latestRun:{generatedSheets:{Summary:[['Function'],['Saved function']]}},restoration:{status:'loading',progress:25,retry:jest.fn()}});
 try{expect(host.textContent).toContain('Summary');expect(host.textContent).not.toMatch(/Refreshing saved results|Retry loading|25%/);}
 finally{act(()=>root.unmount());host.remove();}
});
it('preserves the upgrade cancellation control while suppressing draft preparation',()=>{
 const cancelUpgrade=jest.fn();
 const {host,root}=renderPanel({latestRun:{generatedSheets:{Summary:[['Function'],['Saved function']]}},draftLoading:true,draftProgress:80,restoration:{status:'upgrading',progress:31,cancelUpgrade}});
 try{
  expect(host.textContent).toContain('Upgrading saved table storage… 31%');
  expect(host.textContent).not.toContain('80%');
  act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Cancel upgrade').click());
  expect(cancelUpgrade).toHaveBeenCalledTimes(1);
 }finally{act(()=>root.unmount());host.remove();}
});
it('shows a separate context save warning without hiding the summary',()=>{
  const {host,root}=renderPanel({latestRun:{generatedSheets:{Summary:[['Function'],['Saved function']]}},restoration:{status:'loaded',contextError:'quota',retry:jest.fn()}});
  try{expect(host.textContent).toContain('context updates could not be saved');expect(host.textContent).toContain('Summary');}
  finally{act(()=>root.unmount());host.remove();}
});

it('keeps a validated import visible when the draft temporarily reloads, and waits before Apply',async()=>{
 const {useHazardCsvImportOwner}=require('./useHazardCsvImport');
 const worker={terminated:false,postMessage:message=>{
  if(message.operation==='cancel')return;
  queueMicrotask(()=>worker.onmessage?.({data:{id:message.id,type:'result',result:message.operation==='prepare'?{changedRowCount:1,changedColumns:['Hazard'],governedColumns:[],unknownColumns:[],conflicts:[],conflictCount:0}: {}}}));
 },terminate:()=>{worker.terminated=true;}};
 const factory=jest.spyOn(require('./createHazardCsvImportWorker'),'default').mockReturnValue(worker);
 const draft={id:'pending-draft',projectId:'stable-project',repoId:'stable-repo',generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard'],['one','']]}};
 function Workspace({loading=false}){useHazardCsvImportOwner(draft.projectId,draft.repoId);return <CodeArchitectureHazardPanel csvProjectId={draft.projectId} csvRepoId={draft.repoId} streamingCsvImport draftRun={loading?null:draft} draftLoading={loading} method="STPA-Textbook" onImportSummary={jest.fn()}/>;}
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<Workspace/>));
  const input=host.querySelector('input[aria-label="Import code architecture hazard CSV"]');
  Object.defineProperty(input,'files',{configurable:true,value:[new File(['Raw Analysis Row ID,Hazard\none,Completed'],'completed.csv')]});
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
  const apply=()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Apply CSV import');
  expect(apply().disabled).toBe(false);
  await act(async()=>root.render(<Workspace loading/>));
  await act(async()=>new Promise(resolve=>setTimeout(resolve,30)));
  expect(host.textContent).toContain('CSV validated');expect(apply().disabled).toBe(true);expect(worker.terminated).toBe(false);
  await act(async()=>root.render(<Workspace/>));expect(apply().disabled).toBe(false);
 }finally{await act(async()=>{root.unmount();await new Promise(resolve=>setTimeout(resolve,10));});host.remove();factory.mockRestore();}
});
