jest.mock("lucide-react", () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const ReadmeModal = require("./ReadmeModal").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

describe("ReadmeModal Collaborator guidance", () => {
  it("documents the supported prompted review and revision workflows", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      act(() => root.render(<ReadmeModal open onClose={jest.fn()} />));
      const text = host.textContent;

      expect(text).toContain("Collaborator Prompt Cookbook");
      expect(text).toContain("Audit the current functional decomposition");
      expect(text).toContain("Revise the current functional decomposition based on this feedback");
      expect(text).toContain("Reevaluate the subsystem allocation");
      expect(text).toContain("Safety Significance is marked Needs Review");
      expect(text).toContain("Safety Significance is marked Yes");
      expect(text).toContain("Use the controls in Hazard Analysis");

      const navigation = host.querySelector('nav[aria-label="Guide sections"]');
      const cookbookLink = navigation.querySelector('a[href="#guide-prompt-cookbook"]');
      expect(cookbookLink).not.toBeNull();
      expect(host.querySelector("#guide-prompt-cookbook")).not.toBeNull();

      const collapse = host.querySelector('[aria-label="Collapse guide navigation"]');
      act(() => collapse.click());
      expect(host.querySelector('[aria-label="Expand guide navigation"]')).not.toBeNull();
      expect(cookbookLink.getAttribute("title")).toBe("Prompt Cookbook");
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
