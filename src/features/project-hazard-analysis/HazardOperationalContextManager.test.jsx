global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("lucide-react", () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const HazardOperationalContextManager = require("./HazardOperationalContextManager").default;

describe("HazardOperationalContextManager", () => {
  it("identifies and saves the owning code architecture scope", () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      act(() => root.render(
        <HazardOperationalContextManager
          open
          scopeLabel="code-based architecture project and repository"
          contexts={[{ id: "normal", scenario: "Nominal route", mode: "Automatic" }]}
          onSave={onSave}
          onClose={onClose}
        />,
      ));

      const modal = document.body.querySelector('[role="presentation"].xhandle-modal-viewport');
      expect(modal).not.toBeNull();
      expect(modal.parentElement).toBe(document.body);
      expect(modal.className).toContain("z-[1200]");
      expect(modal.textContent).toContain("Saved to the current code-based architecture project and repository.");
      expect(modal.textContent).toContain("Uses the configured AI provider and the current code-based architecture project and repository architecture.");

      const saveButton = Array.from(modal.querySelectorAll("button"))
        .find((button) => button.textContent.includes("Save contexts"));
      act(() => saveButton.click());

      expect(onSave).toHaveBeenCalledWith([{
        id: "normal",
        scenario: "Nominal route",
        mode: "Automatic",
        conditions: "",
        assumptions: "",
      }]);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
