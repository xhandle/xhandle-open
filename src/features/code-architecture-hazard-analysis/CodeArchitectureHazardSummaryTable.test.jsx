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
