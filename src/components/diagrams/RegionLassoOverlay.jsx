/**
 * xHandle: region lasso overlay diagram renderer.
 * This file supports xHandle's diagram rendering layer, which turns functional decomposition rows and related engineering data into interactive visual models.
 * Diagram components are the visual counterpart to the worksheet-driven pipelines, helping users inspect relationships, adjust layouts, and understand how system functions connect.
 * Related files: src/App.js, src/features/functional-architecture/generateFunctionalDecompositionFromGitHub.js, src/components/getLLMLayoutFromRows.js.
 */

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
/**
 * rectsIntersect renders a diagram-focused React component. It gives users access to interactive diagram inspection and editing while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param r1 Input consumed by this step of the xHandle workflow.
 * @param r2 Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function rectsIntersect(r1, r2) {
  return !(
    r2.left > r1.right ||
    r2.right < r1.x ||
    r2.top > r1.bottom ||
    r2.bottom < r1.y
  );
}

/** Text extraction within a viewport rect using TextNode walker + Range rects */
function extractTextInViewportRect(viewRect) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const style = window.getComputedStyle(parent);
      if (style && (style.visibility === "hidden" || style.display === "none")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const chunks = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    for (const r of rects) {
      const rr = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      if (rectsIntersect(viewRect, rr)) {
        chunks.push(node.nodeValue.trim());
        break;
      }
    }
  }

  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

/** Table → Markdown (simple header + rows) */
function tableToMarkdown(tableEl) {
  const rows = Array.from(tableEl.querySelectorAll("tr"));
  if (!rows.length) return "";
  const cells = (tr, sel) => Array.from(tr.querySelectorAll(sel)).map(td => (td.innerText || "").trim());

  const headerRow = cells(rows[0], "th,td");
  const bodyRows = rows.slice(1).map(r => cells(r, "td,th"));

  const head = `| ${headerRow.join(" | ")} |`;
  const sep  = `| ${headerRow.map(() => "---").join(" | ")} |`;
  const body = bodyRows.map(r => `| ${r.join(" | ")} |`).join("\n");
  return [head, sep, body].filter(Boolean).join("\n");
}

/** First table intersecting selection */
function extractFirstTableMarkdownInRect(viewRect) {
  const tables = Array.from(document.querySelectorAll("table"));
  for (const t of tables) {
    const r = t.getBoundingClientRect();
    const rr = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    if (rectsIntersect(viewRect, rr)) return tableToMarkdown(t);
  }
  return "";
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
    const onMouseUp = () => {
      if (!rect) { destroy(); return; }
      const viewRect = { left: rect.x, right: rect.right, top: rect.y, bottom: rect.bottom };
      const text = extractTextInViewportRect(viewRect);
      const tableMarkdown = extractFirstTableMarkdownInRect(viewRect);

      const payload = {
        type: "region",
        bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        text,
        tableMarkdown: tableMarkdown || null,
        capturedAt: new Date().toISOString(),
      };

      // Broadcast for listeners
      window.dispatchEvent(new CustomEvent("xhandle:copilot-add-context", { detail: payload }));
      onDone?.(payload);
      destroy();
    };

    return createPortal(
      <div
        role="presentation"
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
                background: "#111827",
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
