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
