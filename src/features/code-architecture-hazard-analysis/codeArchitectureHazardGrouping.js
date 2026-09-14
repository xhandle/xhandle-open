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

export function buildCodeArchitectureHazardGroups(headers = [], rowItems = []) {
  const fromIndex = headerIndex(headers, ["Function (From)", "From Function", "Source Function"]);
  const actionIndex = headerIndex(headers, ["Control Action", "Unsafe Control Action", "UCA", "Action"]);
  const toIndex = headerIndex(headers, ["Function (To)", "To Function", "Target Function"]);
  const groups = [];
  const groupsByKey = new Map();

  (Array.isArray(rowItems) ? rowItems : []).forEach((item, fallbackIndex) => {
    const row = Array.isArray(item?.row) ? item.row : [];
    const from = fromIndex >= 0 ? clean(row[fromIndex]) : "";
    const action = actionIndex >= 0 ? clean(row[actionIndex]) : "";
    const to = toIndex >= 0 ? clean(row[toIndex]) : "";
    const interfaceKey = [from, action, to].map(normalize).join("::") || `interface-${fallbackIndex}`;
    let group = groupsByKey.get(interfaceKey);
    if (!group) {
      group = {
        key: interfaceKey,
        label: [from || "Unknown source", action || "unspecified action", to || "Unknown target"].join(" → "),
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
