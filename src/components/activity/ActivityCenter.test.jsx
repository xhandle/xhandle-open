global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("lucide-react", () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { ActivitiesButton, ActivityProvider } = require("./ActivityCenter");

describe("ActivitiesButton", () => {
  let host;
  let root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <ActivityProvider>
          <ActivitiesButton />
        </ActivityProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  test("renders its dropdown in a viewport-level topmost portal", () => {
    const button = host.querySelector('button[title="Activities"]');
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const dropdown = document.getElementById("activities-dropdown");
    expect(dropdown).not.toBeNull();
    expect(dropdown.className).toContain("fixed");
    expect(dropdown.className).toContain("z-[2147483000]");
    expect(dropdown.parentElement).toBe(document.body);
    expect(host.contains(dropdown)).toBe(false);
    expect(dropdown.textContent).toContain("No active activities.");
  });

  test("closes the portal with Escape and restores focus to the trigger", () => {
    const button = host.querySelector('button[title="Activities"]');
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(document.getElementById("activities-dropdown")).not.toBeNull();

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    expect(document.getElementById("activities-dropdown")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
