/**
 * xHandle: export drawio shared UI utility.
 * This file provides shared helper logic used by frontend components, often as a compatibility layer while imports converge on the newer lib-oriented architecture.
 * Keeping reusable helpers in one place reduces duplication across feature surfaces and makes local-first data handling, exports, and copilot context easier to evolve safely.
 * Related files: src/lib/storage/indexedDB.js, src/lib/storage/requirementsStore.ts, src/components/XHandleCopilotView.jsx.
 */

// utils/exportDrawio.js
// Convert React Flow nodes/edges into draw.io (mxGraphModel) XML and trigger a download.

function escapeXml(text = "") {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
  
  /**
   * reactFlowToDrawioXML
   * @param Array nodes - React Flow nodes (id, position, data, width/height if available)
   * @param Array edges - React Flow edges (id, source, target, label)
   * @param Object opts  - { pageWidth, pageHeight, nodeSize, nodeStyle, edgeStyle }
   * @returns {string} - XML string representing an <mxGraphModel/>
   */
  export function reactFlowToDrawioXML(
    nodes,
    edges,
    opts = {}
  ) {
    const pageWidth  = opts.pageWidth  ?? 1920;
    const pageHeight = opts.pageHeight ?? 1080;
  
    // Default node size if RF hasn’t measured yet:
    const defaultNodeW = opts.nodeSize?.width  ?? 180;
    const defaultNodeH = opts.nodeSize?.height ?? 80;
  
    // Basic, readable draw.io styles (tweak to your brand):
    const nodeStyle =
      opts.nodeStyle ??
      "rounded=1;whiteSpace=wrap;html=1;strokeColor=#334155;fillColor=#EEF2FF;fontColor=#0F172A;shadow=0;arcSize=12;spacing=8;";
    const edgeStyle =
      opts.edgeStyle ??
      "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;strokeColor=#94A3B8;strokeWidth=2;";
  
    // mxGraph requires a root with two parents: id="0" and a layer cell id="1"
    const head = `<?xml version="1.0" encoding="UTF-8"?>
  <mxGraphModel dx="1200" dy="1200" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">
    <root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
  `;
  
    const nodeCells = nodes
      .map((n) => {
        // React Flow often has n.measured?.width/height or n.width/height; fall back if missing
        const w = Math.max(1, Number(n.width ?? n.measured?.width ?? defaultNodeW));
        const h = Math.max(1, Number(n.height ?? n.measured?.height ?? defaultNodeH));
  
        // RF uses {x,y} top-left; draw.io geometry is also top-left → direct mapping
        const x = Math.round(n.position?.x ?? 0);
        const y = Math.round(n.position?.y ?? 0);
  
        // Prefer data.label → otherwise id
        const label =
          (n.data && (n.data.label || n.data.name || n.data.title)) ||
          n.label ||
          n.id;
  
        return `    <mxCell id="${escapeXml(n.id)}" value="${escapeXml(
          String(label)
        )}" style="${escapeXml(nodeStyle)}" vertex="1" parent="1">
        <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>
      </mxCell>`;
      })
      .join("\n");
  
    const edgeCells = edges
      .map((e, idx) => {
        const id = e.id || `e-${idx + 1}`;
        const label = e.label ? escapeXml(String(e.label)) : "";
        // Ensure source/target match node ids
        const source = escapeXml(e.source);
        const target = escapeXml(e.target);
  
        // If you want waypoints, you can add <mxPoint .../> inside <mxGeometry>
        return `    <mxCell id="${escapeXml(
          id
        )}" value="${label}" style="${escapeXml(
          edgeStyle
        )}" edge="1" parent="1" source="${source}" target="${target}">
        <mxGeometry relative="1" as="geometry"/>
      </mxCell>`;
      })
      .join("\n");
  
    const tail = `
    </root>
  </mxGraphModel>
  `;
  
    return head + (nodeCells ? nodeCells + "\n" : "") + edgeCells + tail;
  }
  
  /**
   * downloadDrawioXml
   * Produces and downloads a .xml that draw.io can import.
   */
  export function downloadDrawioXml(nodes, edges, filename = "diagram.drawio.xml", opts = {}) {
    const xml = reactFlowToDrawioXML(nodes, edges, opts);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  