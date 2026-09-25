global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("lucide-react", () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const HazardAnalysisRecoveryModal = require("./HazardAnalysisRecoveryModal").default;

const listing = (revisions) => ({ status: "ok", revisions });
const revision = (overrides = {}) => ({
  revision: 3,
  updatedAt: "2026-09-21T10:00:00.000Z",
  rowCount: 210,
  lastWriteReason: "before-vibe-review",
  pinned: true,
  ...overrides,
});

function mount(props) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<HazardAnalysisRecoveryModal {...props} />));
  const dialog = document.body.querySelector('[role="dialog"]');
  const buttons = () => Array.from(document.body.querySelectorAll("button"));
  return {
    host, root, dialog,
    text: () => (dialog ? dialog.textContent : ""),
    click: (label) => {
      const target = buttons().find((button) => button.textContent.trim() === label);
      if (!target) throw new Error(`No button labelled "${label}"`);
      act(() => target.click());
      return target;
    },
    button: (label) => buttons().find((button) => button.textContent.trim() === label),
    cleanup: () => { act(() => root.unmount()); host.remove(); },
  };
}

describe("HazardAnalysisRecoveryModal", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("renders nothing until opened", () => {
    const view = mount({ open: false, listing: listing([revision()]) });
    expect(view.dialog).toBeNull();
    view.cleanup();
  });

  it("lists saved versions newest first", () => {
    const view = mount({ open: true, listing: listing([
      revision({ revision: 1, rowCount: 5, lastWriteReason: "vibe-review:safetySignificant", pinned: false }),
      revision({ revision: 2 }),
    ]) });

    const order = Array.from(view.dialog.querySelectorAll("tbody tr"))
      .map((row) => row.cells[1].textContent);
    expect(order).toEqual(["2", "1"]);
    expect(view.text()).toContain("Review decision (safetySignificant)");
    view.cleanup();
  });

  it("marks a pinned checkpoint as kept and names why it was saved", () => {
    const view = mount({ open: true, listing: listing([revision({ pinned: true })]) });
    expect(view.text()).toContain("Kept");
    expect(view.text()).toContain("Before a Vibe Review");
    view.cleanup();
  });

  it("offers recovery instead of an empty analysis when the head is gone", () => {
    const view = mount({ open: true, headMissing: true, listing: listing([revision()]) });
    expect(view.text()).toContain("missing or unreadable");
    expect(view.text()).toContain("Nothing has been deleted");
    view.cleanup();
  });

  it("distinguishes unavailable storage from having no backup", () => {
    const view = mount({ open: true, listing: { status: "unavailable", revisions: [] } });
    expect(view.text()).toContain("does not mean they are gone");
    view.cleanup();
  });

  it("says plainly when a project has no history yet", () => {
    const view = mount({ open: true, listing: listing([]) });
    expect(view.text()).toContain("no saved versions for this project yet");
    view.cleanup();
  });

  it("previews a version without restoring it", () => {
    const onPreview = jest.fn();
    const onRestore = jest.fn();
    const view = mount({ open: true, listing: listing([revision({ revision: 7 })]), onPreview, onRestore });

    view.click("Preview");

    expect(onPreview).toHaveBeenCalledWith(7);
    expect(onRestore).not.toHaveBeenCalled();
    view.cleanup();
  });

  it("shows previewed content", () => {
    const view = mount({
      open: true,
      listing: listing([revision()]),
      previewRevision: { revision: 3, analysisResult: { Summary: [["Hazard"], ["Loss of braking"]] } },
    });
    expect(view.text()).toContain("Preview of version 3");
    expect(view.text()).toContain("Loss of braking");
    view.cleanup();
  });

  it("restores the chosen version", () => {
    const onRestore = jest.fn();
    const view = mount({ open: true, listing: listing([revision({ revision: 9 })]), onRestore });

    view.click("Restore");

    expect(onRestore).toHaveBeenCalledWith(9);
    view.cleanup();
  });

  it("blocks further restores while one is in flight", () => {
    const view = mount({ open: true, busyRevision: 9, listing: listing([revision({ revision: 9 })]) });
    expect(view.button("Restoring…").disabled).toBe(true);
    view.cleanup();
  });

  it("tells the user a restore can itself be undone", () => {
    const view = mount({ open: true, listing: listing([revision()]) });
    expect(view.text()).toContain("keeps the current version in history");
    view.cleanup();
  });
});
