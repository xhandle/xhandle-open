import React, { useEffect, useMemo, useRef, useState } from "react";
import { Columns3 } from "lucide-react";

export default function ColumnVisibilityMenu({
  columns = [],
  hiddenKeys = [],
  onChange,
  buttonLabel = "Columns",
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const hiddenSet = useMemo(() => new Set(hiddenKeys), [hiddenKeys]);
  const visibleCount = columns.filter((column) => !hiddenSet.has(column.key)).length;

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const updateHidden = (nextSet) => {
    onChange?.(Array.from(nextSet));
  };

  const toggleColumn = (columnKey) => {
    const next = new Set(hiddenSet);
    if (next.has(columnKey)) {
      next.delete(columnKey);
    } else if (visibleCount > 1) {
      next.add(columnKey);
    }
    updateHidden(next);
  };

  const showAll = () => updateHidden(new Set());

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        title="Show or hide table columns"
      >
        <Columns3 size={14} />
        <span>{buttonLabel}</span>
        {hiddenSet.size > 0 && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
            {columns.length - hiddenSet.size}/{columns.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-700 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <div className="text-xs font-semibold">Visible Columns</div>
            <button
              type="button"
              className="text-[11px] font-semibold text-[#2D7DFE]"
              onClick={showAll}
            >
              Show all
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {columns.map((column) => {
              const hidden = hiddenSet.has(column.key);
              const disableHide = !hidden && visibleCount <= 1;
              return (
                <label
                  key={column.key}
                  className={`flex items-start gap-2 rounded-md px-2 py-2 text-xs ${
                    disableHide ? "cursor-not-allowed opacity-60" : "hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!hidden}
                    disabled={disableHide}
                    onChange={() => toggleColumn(column.key)}
                  />
                  <span className="break-words">{column.label || column.key}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
