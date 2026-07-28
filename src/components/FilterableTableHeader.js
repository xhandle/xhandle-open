import React, { useEffect, useMemo, useRef, useState } from "react";

const BLANK_VALUE = "(blank)";

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "object" && "value" in value) return String(value.value ?? "").trim();
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value).trim();
}

function filterValue(value) {
  return cellText(value) || BLANK_VALUE;
}

export function useColumnFilters(rows = [], getCell = (row, index) => row?.[index]) {
  const [filters, setFilters] = useState({});
  const [searches, setSearches] = useState({});
  const [openIndex, setOpenIndex] = useState(null);
  const filterRefs = useRef({});

  useEffect(() => {
    const onMouseDown = (event) => {
      if (openIndex == null) return;
      const node = filterRefs.current[openIndex];
      if (node && !node.contains(event.target)) setOpenIndex(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [openIndex]);

  const filteredRows = useMemo(() => {
    const activeEntries = Object.entries(filters).filter(([, values]) => Array.isArray(values) && values.length > 0);
    if (!activeEntries.length) return rows;
    return rows.filter((row) => activeEntries.every(([index, allowed]) => {
      const value = filterValue(getCell(row, Number(index)));
      return allowed.includes(value);
    }));
  }, [filters, getCell, rows]);

  const getOptions = (index, search = "") => {
    const query = String(search || "").trim().toLowerCase();
    const options = Array.from(new Set(rows.map((row) => filterValue(getCell(row, index)))));
    return options
      .filter((value) => !query || value.toLowerCase().includes(query))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
      .slice(0, 500);
  };

  const setFilterValues = (index, values) => {
    setFilters((prev) => {
      const next = { ...prev };
      const clean = Array.from(new Set(values || []));
      if (clean.length) next[index] = clean;
      else delete next[index];
      return next;
    });
  };

  const toggleFilterValue = (index, value) => {
    setFilters((prev) => {
      const current = prev[index] || [];
      const nextValues = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      const next = { ...prev };
      if (nextValues.length) next[index] = nextValues;
      else delete next[index];
      return next;
    });
  };

  const activeFilterCount = Object.values(filters).reduce((sum, values) => sum + (Array.isArray(values) && values.length ? 1 : 0), 0);

  return {
    filters,
    searches,
    openIndex,
    filterRefs,
    filteredRows,
    activeFilterCount,
    setOpenIndex,
    setSearches,
    getOptions,
    setFilterValues,
    toggleFilterValue,
    clearAllFilters: () => setFilters({}),
  };
}

export function FilterableHeaderCell({
  label,
  index,
  className = "",
  style,
  filterState,
  onResizeStart,
}) {
  const {
    filters,
    searches,
    openIndex,
    filterRefs,
    setOpenIndex,
    setSearches,
    getOptions,
    setFilterValues,
    toggleFilterValue,
  } = filterState;
  const selectedValues = filters[index] || [];
  const search = searches[index] || "";
  const isOpen = openIndex === index;
  const options = isOpen ? getOptions(index, search) : [];

  return (
    <th className={`relative ${className}`} style={style}>
      <div ref={(el) => { filterRefs.current[index] = el; }} className="relative">
        <button
          type="button"
          onClick={() => setOpenIndex(isOpen ? null : index)}
          className={`flex w-full items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs font-semibold ${
            selectedValues.length ? "border-[#2D7DFE] bg-white text-[#1E61D6]" : "border-slate-200 bg-white/70 text-slate-700"
          }`}
          title={`Filter ${label || `Column ${index + 1}`}`}
        >
          <span className="min-w-0 whitespace-normal break-words">{label || `Column ${index + 1}`}</span>
          <span className="inline-flex shrink-0 items-center gap-1 pt-0.5">
            {selectedValues.length > 0 && (
              <span className="rounded-full bg-[#2D7DFE] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {selectedValues.length}
              </span>
            )}
            <span className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
          </span>
        </button>

        {isOpen && (
          <div className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-700 shadow-xl">
            <div className="border-b border-slate-100 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="truncate text-xs font-semibold">{label || `Column ${index + 1}`}</div>
                {selectedValues.length > 0 && (
                  <button
                    type="button"
                    className="text-[11px] font-medium text-[#2D7DFE]"
                    onClick={() => setFilterValues(index, [])}
                  >
                    Clear
                  </button>
                )}
              </div>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearches((prev) => ({ ...prev, [index]: event.target.value }))}
                placeholder="Search values..."
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-[#2D7DFE]"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setFilterValues(index, options)}
                  className="rounded border border-slate-200 px-2 py-1 text-[11px] hover:bg-slate-50"
                >
                  Select visible
                </button>
                <button
                  type="button"
                  onClick={() => setFilterValues(index, [])}
                  className="rounded border border-slate-200 px-2 py-1 text-[11px] hover:bg-slate-50"
                >
                  Clear all
                </button>
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto p-2">
              {options.length === 0 ? (
                <div className="px-2 py-3 text-xs text-slate-500">No matching values</div>
              ) : options.map((value) => (
                <label key={value} className="flex items-start gap-2 rounded-md px-2 py-2 text-xs hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedValues.includes(value)}
                    onChange={() => toggleFilterValue(index, value)}
                  />
                  <span className="break-words">{value}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      {typeof onResizeStart === "function" && (
        <button
          type="button"
          aria-label={`Resize ${label || `Column ${index + 1}`}`}
          title="Drag to resize column"
          onMouseDown={(event) => onResizeStart(event, index)}
          onClick={(event) => event.stopPropagation()}
          className="absolute right-0 top-0 h-full w-2 cursor-col-resize border-0 bg-transparent p-0 hover:bg-[#2D7DFE]/20"
        />
      )}
    </th>
  );
}
