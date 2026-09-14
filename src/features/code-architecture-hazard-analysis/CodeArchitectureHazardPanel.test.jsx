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
