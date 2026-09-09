export const HAZARD_DIAGRAM_LINK_HEADERS = new Set([
  "Function (From)",
  "Function (To)",
  "Control Action",
  "Subsystem Allocation",
]);

function cellForHeader(headers = [], row = [], headerName = "") {
  const index = headers.findIndex((header) => String(header || "").trim() === headerName);
  return index >= 0 ? String(row[index] || "").trim() : "";
}

export function buildHazardDiagramFocusTarget(headers = [], row = [], columnIndex = -1) {
  const header = String(headers[columnIndex] || "").trim();
  const label = String(row[columnIndex] || "").trim();
  if (!HAZARD_DIAGRAM_LINK_HEADERS.has(header) || !label) return null;

  const fromFunction = cellForHeader(headers, row, "Function (From)");
  const toFunction = cellForHeader(headers, row, "Function (To)");
  const controlAction = cellForHeader(headers, row, "Control Action");
  const subsystem = cellForHeader(headers, row, "Subsystem Allocation");

  if (header === "Control Action") {
    return { kind: "edge", label, fromFunction, toFunction, controlAction, subsystem };
  }

  if (header === "Subsystem Allocation") {
    return { kind: "subsystem", label, fromFunction, toFunction, controlAction, subsystem };
  }

  return { kind: "function", label, fromFunction, toFunction, controlAction, subsystem };
}

export function getHazardDiagramLinkLabel(target) {
  if (target?.kind === "edge") return "View control action in diagram";
  if (target?.kind === "subsystem") return "View subsystem in diagram";
  return "View function in diagram";
}
