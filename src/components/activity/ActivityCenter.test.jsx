global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("lucide-react", () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { ActivitiesButton, ActivityProvider, visibleActivityEntries, useActivityCenter } = require("./ActivityCenter");

test('desktop diagnostics report failures and throttle progress without collecting normal activity messages', () => {
  jest.useFakeTimers();
  const reportActivity = jest.fn();
  const previous = window.xhandleDesktop;
  window.xhandleDesktop = {reportActivity};
  let api;
  function Capture() { api = useActivityCenter(); return null; }
  const host = document.createElement('div'), root = createRoot(host);
  try {
    act(() => root.render(<ActivityProvider><Capture /></ActivityProvider>));
    act(() => api.startActivity('private-project-id', {title:'Software Requirements',step:0,total:100,message:'Do not log this prompt'}));
    expect(reportActivity).toHaveBeenLastCalledWith(expect.objectContaining({phase:'Software Requirements',status:'running',transition:true}));
    expect(JSON.stringify(reportActivity.mock.calls)).not.toMatch(/private-project-id|Do not log/);
    const initial = reportActivity.mock.calls.length;
    act(() => api.updateActivity('private-project-id', {step:10}));
    expect(reportActivity).toHaveBeenCalledTimes(initial);
    act(() => api.finishActivity('private-project-id','error','Storage transaction failed.'));
    expect(reportActivity).toHaveBeenLastCalledWith(expect.objectContaining({status:'error',message:'Storage transaction failed.',completed:10}));
    reportActivity.mockImplementation(() => { throw new Error('Bridge unavailable'); });
    act(() => api.startActivity('other', {title:'Other'}));
    expect(api.activities.get('other').status).toBe('running');
  } finally {
    act(() => root.unmount());window.xhandleDesktop=previous;jest.clearAllTimers();jest.useRealTimers();
  }
});

test("omits paused recoverable work from Activities", () => {
  const activities = new Map([
    ["paused-review", { status: "paused", title: "Review" }],
    ["running-task", { status: "running", title: "Task" }],
  ]);
  expect(visibleActivityEntries(activities).map(([id]) => id)).toEqual(["running-task"]);
});

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
