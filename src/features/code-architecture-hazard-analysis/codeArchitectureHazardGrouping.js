import {sha256} from "hash.js";

export const HAZARD_GROUP_LABEL_LIMIT = 512;
export const HAZARD_LAYOUT_LIMIT_BYTES = 32 * 1024 * 1024;

function clean(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function headerIndex(headers = [], names = []) {
  const normalized = headers.map(normalize);
  return names.map(normalize).map((name) => normalized.indexOf(name)).find((index) => index >= 0) ?? -1;
}

export function filterCodeArchitectureHazardRowsByContext(headers = [], rowItems = [], selectedContextId = "all") {
  if (!selectedContextId || selectedContextId === "all") return rowItems;
  const contextIndex = headerIndex(headers, ["Operational Context ID", "Context ID"]);
  if (contextIndex < 0) return [];
  return rowItems.filter(({ row }) => clean(row?.[contextIndex]) === selectedContextId);
}

// The saved-row worker uses the same identity/label rules without retaining
// every row's cells while it builds the complete scroll order.
export function createCodeArchitectureHazardGroupDescriptor(headers = [], {bounded = false} = {}) {
  const fromIndex = headerIndex(headers, ["Function (From)", "From Function", "Source Function"]);
  const actionIndex = headerIndex(headers, ["Control Action", "Unsafe Control Action", "UCA", "Action"]);
  const toIndex = headerIndex(headers, ["Function (To)", "To Function", "Target Function"]);
  return (row = [], fallbackIndex = 0) => {
    const from = fromIndex >= 0 ? clean(row[fromIndex]) : "";
    const action = actionIndex >= 0 ? clean(row[actionIndex]) : "";
    const to = toIndex >= 0 ? clean(row[toIndex]) : "";
    const key = [from, action, to].map(normalize).join("::") || `interface-${fallbackIndex}`;
    const label = [from || "Unknown source", action || "unspecified action", to || "Unknown target"].join(" → ");
    // Hash the complete normalized identity, including text beyond the display
    // label. All remote keys use one namespace; user text cannot imitate it.
    return bounded ? {
      key: sha256().update(key).digest("hex"),
      // Joining individual characters detaches the preview from a large V8
      // sliced-string backing store instead of retaining the original label.
      label: label.length > HAZARD_GROUP_LABEL_LIMIT ? label.slice(0, HAZARD_GROUP_LABEL_LIMIT - 1).split("").join("") + "…" : label,
    } : {key, label};
  };
}

// The outline retains numeric coordinates and bounded group descriptions only.
// Account for both index arrays, group/map entries, strings and spare array
// capacity. This is a conservative estimate, not an exact process-heap measure.
export function createCodeArchitectureHazardLayout(headers = [], {maxBytes = HAZARD_LAYOUT_LIMIT_BYTES} = {}) {
  let metadataBytes = 128 + headers.reduce((bytes, header) => bytes + 32 + String(header ?? "").length * 2, 0);
  const checkBudget = (additional = 0) => {
    if (metadataBytes + additional > maxBytes) {
      throw new Error("The matching rows exceed the safe table outline size. Narrow the table filters and try again.");
    }
  };
  checkBudget();
  const describe = createCodeArchitectureHazardGroupDescriptor(headers, {bounded: true});
  const groups = [], groupsByKey = new Map(), indices = [];
  return {
    addRow(rowIndex, row) {
      const descriptor = describe(row, rowIndex);
      let group = groupsByKey.get(descriptor.key);
      const additional = 32 + (group ? 0 : 256 + descriptor.key.length * 2 + descriptor.label.length * 2);
      checkBudget(additional);
      metadataBytes += additional;
      if (!group) {
        group = {...descriptor, rowCount: 0, rowIndices: []};
        groupsByKey.set(group.key, group);
        groups.push(group);
      }
      group.rowIndices.push(rowIndex);
      group.rowCount++;
      indices.push(rowIndex);
    },
    finish() { return {headers, groups, indices, total: indices.length, metadataBytes}; },
  };
}

export function buildCodeArchitectureHazardGroups(headers = [], rowItems = []) {
  const describe = createCodeArchitectureHazardGroupDescriptor(headers);
  const groups = [];
  const groupsByKey = new Map();

  (Array.isArray(rowItems) ? rowItems : []).forEach((item, fallbackIndex) => {
    const row = Array.isArray(item?.row) ? item.row : [];
    const { key: interfaceKey, label } = describe(row, fallbackIndex);
    let group = groupsByKey.get(interfaceKey);
    if (!group) {
      group = {
        key: interfaceKey,
        label,
        rowCount: 0,
        items: [],
      };
      groupsByKey.set(interfaceKey, group);
      groups.push(group);
    }

    group.items.push(item);
    group.rowCount += 1;
  });

  return groups;
}
