// src/components/RegionLassoOverlay.jsx
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";

/** Geometry helpers */
function rectFromPoints(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x);
  const h = Math.abs(a.y - b.y);
  return { x, y, width: w, height: h, right: x + w, bottom: y + h };
}
/** Public API: open overlay and resolve on selection */
export function openRegionSelector({ onDone } = {}) {
  const mount = document.createElement("div");
  document.body.appendChild(mount);

  const destroy = () => {
    try { root?.unmount?.(); } catch {}
    try { mount.remove(); } catch {}
  };

  function Overlay() {
    const [dragging, setDragging] = useState(false);
    const [rect, setRect] = useState(null);
    const startRef = useRef(null);

    useEffect(() => {
      const onKey = (e) => { if (e.key === "Escape") destroy(); };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, []);

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      startRef.current = { x: e.clientX, y: e.clientY };
      setDragging(true);
      setRect({ x: e.clientX, y: e.clientY, width: 0, height: 0, right: e.clientX, bottom: e.clientY });
      e.preventDefault();
    };
    const onMouseMove = (e) => {
      if (!dragging || !startRef.current) return;
      const r = rectFromPoints(startRef.current, { x: e.clientX, y: e.clientY });
      setRect(r);
    };
    const onMouseUp = (e) => {
      const start = startRef.current;
      const selection = start && rectFromPoints(start, { x: e.clientX, y: e.clientY });
      // Remove the dimming, border, and selection hint before taking the image.
      destroy();
      if (!selection || !selection.width || !selection.height) return;
      onDone?.({
        type: "region",
        bbox: { x: selection.x, y: selection.y, width: selection.width, height: selection.height },
        capturedAt: new Date().toISOString(),
      });
    };

    return createPortal(
      <div
        role="presentation"
        data-html2canvas-ignore="true"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        style={{ position: "fixed", inset: 0, zIndex: 999999, cursor: "crosshair", background: "rgba(0,0,0,0.05)" }}
      >
        {rect && (
          <>
            <div
              style={{
                position: "fixed",
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                border: "2px solid #3b82f6",
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.25)",
                background: "rgba(59,130,246,0.06)",
                borderRadius: 6,
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "fixed",
                left: rect.x,
                top: rect.y - 28,
                padding: "2px 8px",
                background: "var(--toolbar-bg)",
                color: "white",
                fontSize: 12,
                borderRadius: 4,
              }}
            >
              {Math.max(1, Math.round(rect.width))} × {Math.max(1, Math.round(rect.height))} — release to capture (Esc to cancel)
            </div>
          </>
        )}
      </div>,
      mount
    );
  }

  const root = createRoot(mount);
  root.render(<Overlay />);

  return () => destroy();
}
