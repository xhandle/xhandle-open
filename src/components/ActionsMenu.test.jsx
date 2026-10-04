import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import ActionsMenu from "./ActionsMenu";

function Fixture({ onAction }) {
  const [target, setTarget] = useState(null);
  return <>
    <ActionsMenu label="Actions">
      <button onClick={onAction}>Export</button>
      <div ref={setTarget} />
    </ActionsMenu>
    {target && createPortal(<button onClick={onAction}>Table</button>, target)}
    <button>Outside</button>
  </>;
}

describe("ActionsMenu dismissal", () => {
  let host;
  let root;
  let menu;
  let onAction;
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    onAction = jest.fn();
    act(() => root.render(<Fixture onAction={onAction} />));
    menu = host.querySelector("details");
    menu.open = true;
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it.each(["Export", "Table"])("allows %s clicks after a Safari-style blur with no focus destination", (label) => {
    const summary = menu.querySelector("summary");
    const button = [...menu.querySelectorAll("button")].find(item => item.textContent === label);
    act(() => {
      summary.focus();
      button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      summary.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
      document.body.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(menu.open).toBe(true);
    act(() => button.click());
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("closes on outside pointer input and keyboard focus", () => {
    const outside = host.lastElementChild;
    act(() => outside.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(menu.open).toBe(false);
    menu.open = true;
    act(() => outside.focus());
    expect(menu.open).toBe(false);
  });

  it("handles Escape from a portaled item and returns focus to the trigger", () => {
    const button = [...menu.querySelectorAll("button")].find(item => item.textContent === "Table");
    act(() => {
      button.focus();
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(menu.querySelector("summary"));
  });
});
