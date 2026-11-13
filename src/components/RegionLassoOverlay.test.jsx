import React from "react";
import { openRegionSelector } from "./RegionLassoOverlay";

const { act } = React;
global.IS_REACT_ACT_ENVIRONMENT = true;

describe("screen region selection", () => {
  let close;
  afterEach(() => { act(() => close?.()); });

  it("removes the overlay before capturing the final drag rectangle", () => {
    const broadcast = jest.fn();
    window.addEventListener("xhandle:copilot-add-context", broadcast);
    const onDone = jest.fn(() => {
      expect(document.querySelector('[data-html2canvas-ignore="true"]')).toBeNull();
    });
    try {
      act(() => { close = openRegionSelector({ onDone }); });
      const overlay = document.querySelector('[data-html2canvas-ignore="true"]');
      act(() => overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 200, clientY: 150 })));
      act(() => overlay.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 100 })));
      act(() => overlay.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 50, clientY: 60 })));
      expect(onDone).toHaveBeenCalledWith(expect.objectContaining({
        type: "region", bbox: { x: 50, y: 60, width: 150, height: 90 },
      }));
      expect(broadcast).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("xhandle:copilot-add-context", broadcast);
    }
  });

  it("does not capture an empty click or a canceled selection", () => {
    const onDone = jest.fn();
    act(() => { close = openRegionSelector({ onDone }); });
    const overlay = document.querySelector('[data-html2canvas-ignore="true"]');
    act(() => overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 20, clientY: 30 })));
    act(() => overlay.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 20, clientY: 30 })));
    expect(onDone).not.toHaveBeenCalled();
    act(() => { close = openRegionSelector({ onDone }); });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector('[data-html2canvas-ignore="true"]')).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });
});
