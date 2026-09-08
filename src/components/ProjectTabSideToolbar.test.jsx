global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("lucide-react", () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const ProjectTabSideToolbar = require("./ProjectTabSideToolbar").default;
const {
  ProjectTabToolbarButton,
  ProjectTabToolbarSection,
} = require("./ProjectTabSideToolbar");

describe("ProjectTabSideToolbar", () => {
  it("occupies its own opaque layout column and can collapse", () => {
    const onCollapsedChange = jest.fn();
    const onAction = jest.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      act(() => {
        root.render(
          <div className="flex">
            <ProjectTabSideToolbar
              label="Hazard Analysis tools"
              collapsed={false}
              onCollapsedChange={onCollapsedChange}
            >
              <ProjectTabToolbarSection title="Actions">
                <ProjectTabToolbarButton icon={<span>!</span>} label="Run analysis" onClick={onAction} />
              </ProjectTabToolbarSection>
            </ProjectTabSideToolbar>
            <main>Analysis content</main>
          </div>,
        );
      });

      const toolbar = host.querySelector('aside[aria-label="Hazard Analysis tools"]');
      expect(toolbar).not.toBeNull();
      expect(toolbar.className).toContain("shrink-0");
      expect(toolbar.className).toContain("bg-[#F8FAFC]");
      expect(toolbar.className).toContain("w-56");
      expect(toolbar.parentElement.querySelector("main").textContent).toBe("Analysis content");

      const collapse = host.querySelector('[aria-label="Hide Hazard Analysis tools"]');
      act(() => collapse.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(onCollapsedChange).toHaveBeenCalledWith(true);

      const action = Array.from(toolbar.querySelectorAll("button"))
        .find((button) => button.textContent.includes("Run analysis"));
      act(() => action.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(onAction).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("keeps collapsed actions accessible by name", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      act(() => {
        root.render(
          <ProjectTabSideToolbar label="Safety tools" collapsed>
            <ProjectTabToolbarSection title="Actions" collapsed>
              <ProjectTabToolbarButton icon={<span>!</span>} label="Generate reports" collapsed />
            </ProjectTabToolbarSection>
          </ProjectTabSideToolbar>,
        );
      });

      const toolbar = host.querySelector('aside[aria-label="Safety tools"]');
      expect(toolbar.className).toContain("w-14");
      expect(toolbar.querySelector('[aria-label="Generate reports"]')).not.toBeNull();
      expect(toolbar.textContent).not.toContain("Generate reports");
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
