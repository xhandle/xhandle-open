import { readableValue } from './readableValues';
// Shared original requirements views. Both legacy modules and engineering artifacts use these components.
import React from "react";
import { Copy, Layers, Link2, Table as TableIcon, FileText, Network, Plus, Image as ImageIcon, Grid3x3, Edit3, Trash2, ArrowUp, ArrowDown, IndentDecrease, IndentIncrease, History, X } from "lucide-react";
const STATUSES = ["Proposed", "Approved", "Rejected"];
const VIEW_MODES = { OUTLINE: "outline", TABLE: "table", TRACE: "TRACE" };

export function buildIndex(rows) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const children = new Map();
  for (const r of rows) {
    const p = r.parentId || null;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(r);
  }
  for (const list of children.values()) list.sort((a,b)=> (a.order??0)-(b.order??0) || (a.title||'').localeCompare(b.title||''));
  return { byId, children };
}

export function computeNumbering(moduleRows) {
  const { children } = buildIndex(moduleRows);
  const res = new Map();
  function dfs(parentId, prefix=[]) {
    const list = children.get(parentId||null) || [];
    list.forEach((node, idx) => {
      const num = [...prefix, idx+1];
      res.set(node.id, num.join('.'));
      dfs(node.id, num);
    });
  }
  dfs(null, []);
  return res;
}

export function RowActionsBar({
    disabled,
    selection,
    numbering,
    onClear,
    onNewChild,
    onEdit,
    onDelete,
    onMoveUp,
    onMoveDown,
    onPromote,
    onDemote,
    onHistory,
    viewMode,
    setViewMode,
    documentView = false,
    diagramView = false,
    onSetContent,     // ← receives { type: "image"| "table", ... }
  }) {
    const label = selection
      ? `${numbering?.get?.(selection.id) ? numbering.get(selection.id) + " — " : ""}${selection.title || selection.id}`
      : "No requirement selected";

    const [showTableMaker, setShowTableMaker] = React.useState(false);
    const fileRef = React.useRef(null);

    function onPickImage(file) {
      if (!file) return;
      const fr = new FileReader();
      fr.onload = () => onSetContent?.({
        type: "image",
        image: { dataUrl: String(fr.result || ""), name: file.name }
      });
      fr.readAsDataURL(file);
    }

    return (
        <div className="requirements-row-actions flex flex-wrap items-center gap-2">
             <div className="flex flex-wrap items-center gap-1">

{/* View toggle */}
<div className="inline-flex overflow-hidden rounded border">
  <button
    className={`p-2 ${viewMode === VIEW_MODES.OUTLINE ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
    onClick={() => setViewMode(VIEW_MODES.OUTLINE)}
    title="Outline view"
    aria-pressed={viewMode === VIEW_MODES.OUTLINE}
  >
    <Layers className="h-4 w-4" />
  </button>
  <div className="w-px bg-gray-200" />
  <button
    className={`p-2 ${viewMode === VIEW_MODES.TABLE ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
    onClick={() => setViewMode(VIEW_MODES.TABLE)}
    title="Table view"
    aria-pressed={viewMode === VIEW_MODES.TABLE}
  >
    <TableIcon className="h-4 w-4" />
  </button>
  <div className="w-px bg-gray-200" />
  <button
    className={`p-2 ${viewMode === VIEW_MODES.TRACE ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
    onClick={() => setViewMode(VIEW_MODES.TRACE)}
    title="Traceability view"
    aria-pressed={viewMode === VIEW_MODES.TRACE}
  >
    <Link2 className="h-4 w-4" />
  </button>
  {documentView && <><div className="w-px bg-gray-200" /><button className={`p-2 ${viewMode === 'document' ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`} onClick={() => setViewMode('document')} title="Document view" aria-pressed={viewMode === 'document'}><FileText className="h-4 w-4" /></button></>}
  {diagramView && <><div className="w-px bg-gray-200" /><button className={`p-2 ${viewMode === 'diagram' ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`} onClick={() => setViewMode('diagram')} title="Diagram view" aria-label="Diagram view" aria-pressed={viewMode === 'diagram'}><Network className="h-4 w-4" /></button></>}
</div>

          {/* New child */}
          <button
            onClick={onNewChild}
            disabled={disabled}
            title="New child"
            className="rounded border p-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            aria-disabled={disabled}
          >
            <Plus className="h-4 w-4" />
          </button>

          {/* Insert image */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { onPickImage(e.target.files?.[0]); e.target.value = ""; }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!selection || disabled}
            title="Insert image (renders in place of title)"
            className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50"
          >
            <ImageIcon className="h-4 w-4" />
          </button>

          {/* Insert table */}
          <button
            onClick={() => setShowTableMaker(true)}
            disabled={!selection || disabled}
            title="Insert table (renders in place of title)"
            className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50"
          >
            <Grid3x3 className="h-4 w-4" />
          </button>

          <div className="mx-1 h-5 w-px bg-gray-200" />

          {/* Edit / Delete */}
          <button
            onClick={onEdit}
            disabled={!selection || disabled}
            title="Edit"
            className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50"
          >
            <Edit3 className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            disabled={!selection || disabled}
            title="Delete"
            className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>

          <div className="mx-1 h-5 w-px bg-gray-200" />

          {/* Ordering / hierarchy */}
          <button onClick={onMoveUp} disabled={!selection || disabled} title="Move up"
                  className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button onClick={onMoveDown} disabled={!selection || disabled} title="Move down"
                  className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50">
            <ArrowDown className="h-4 w-4" />
          </button>
          <button onClick={onPromote} disabled={!selection || disabled} title="Promote (outdent)"
                  className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50">
            <IndentDecrease className="h-4 w-4" />
          </button>
          <button onClick={onDemote} disabled={!selection || disabled} title="Demote (indent)"
                  className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50">
            <IndentIncrease className="h-4 w-4" />
          </button>

          <div className="mx-1 h-5 w-px bg-gray-200" />

          {/* History / clear */}
          <button onClick={onHistory} disabled={!selection} title="History"
                  className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50">
            <History className="h-4 w-4" />
          </button>
          <button onClick={onClear} title="Clear selection" className="rounded border p-2 hover:bg-gray-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        {showTableMaker && (
          <QuickTableModal
            onCancel={() => setShowTableMaker(false)}
            onSave={(cells) => {
              onSetContent?.({ type: "table", table: { cells } });
              setShowTableMaker(false);
            }}
          />
        )}
      </div>
    );
  }

export function OutlinePanel({
  moduleName, rows, numbering,
  onCreateChild, onEdit, onDelete,
  onMoveUp, onMoveDown, onPromote, onDemote,
  onShowHistory,
  onInlineUpdate,
  disabled,
  selectedId,
  selectedIds,         // add this
  onSelect,            // update to accept (id, event)
}) {

    const { children } = buildIndex(rows);

    const [editState, setEditState] = React.useState({ id: null, title: "" });
    const [editTable, setEditTable] = React.useState({ open: false, row: null, cells: [[]] });

    const inputRef = React.useRef(null);

    React.useEffect(() => {
      if (editState.id && inputRef.current) inputRef.current.focus();
    }, [editState.id]);

    function startInlineEdit(node) {
      if (disabled) return;
      onSelect?.(node.id);
      setEditState({ id: node.id, title: node.title || "" });
    }
    function commitInlineEdit() {
      if (!editState.id) return;
      const cur = rows.find(r => r.id === editState.id);
      const nextTitle = editState.title.trim();
      setEditState({ id: null, title: "" });
      if (!disabled && cur && nextTitle !== (cur.title || "")) {
        onInlineUpdate?.(cur, { title: nextTitle });
      }
    }
    function cancelInlineEdit() {
      setEditState({ id: null, title: "" });
    }

    function renderBranch(parentId) {
      const list = children.get(parentId || null) || [];
      return list.map(node => {
        const isSelected = selectedId === node.id || selectedIds?.has?.(node.id);
        const isEditing = editState.id === node.id;

        return (
          <div key={node.id} className="border-t first:border-t-0">
           <div
  className={`flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50 ${isSelected ? "bg-blue-50 ring-1 ring-blue-300" : ""}`}
  role="button"
  tabIndex={0}
  aria-selected={isSelected}
  onMouseDown={(e) => {
    const t = e.target;
    const tag = t.tagName;
    const interactive =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      tag === "BUTTON" ||
      t.isContentEditable;
    if (interactive) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault();
    }
  }}
  onClick={(e) => onSelect?.(node.id, e)}
  data-artifact-object-id={node.id}
  onDoubleClick={(e) => { e.stopPropagation(); !disabled && onEdit(node); }}
  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect?.(node.id); }}
>

              <div className="w-24 shrink-0 text-xs font-mono text-gray-500">
                {numbering.get(node.id)}
              </div>

              <div className="flex-1">
                {isEditing ? (
                  <input
                    ref={inputRef}
                    className="w-full rounded border px-2 py-1 text-sm"
                    value={editState.title}
                    onChange={(e) => setEditState(s => ({ ...s, title: e.target.value }))}
                    onBlur={commitInlineEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitInlineEdit(); }
                      if (e.key === "Escape") { e.preventDefault(); cancelInlineEdit(); }
                    }}
                  />
                ) : node?.content?.type === "image" ? (
                  <img
                    src={node.content?.image?.dataUrl}
                    alt={node.title || node.content?.image?.name || "image"}
                    className="max-h-24 rounded"
                    onDoubleClick={(e) => { e.stopPropagation(); onEdit(node); }}
                  />
                ) : node?.content?.type === "table" ? (
                    <div
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (disabled) return;
                        setEditTable({
                          open: true,
                          row: node,
                          cells: Array.isArray(node.content?.table?.cells) ? node.content.table.cells : [[]],
                        });
                      }}
                    >
                      <MiniTable cells={node.content?.table?.cells || []} />
                    </div>
                  ) : (

<div
  className={node.heading ? "font-semibold" : "font-medium"}
  title="Double-click to edit title"
  onDoubleClick={(e) => { e.stopPropagation(); startInlineEdit(node); }}
>
  {node.title || <span className="text-gray-400">(untitled)</span>}
</div>

                )}

                <div className="text-xs text-gray-500">
                  {node.status} · v{node.version} · {(node.updatedAt || "").replace("T", " ").slice(0, 16)}
                </div>
              </div>
            </div>

            <div className="pl-8">{renderBranch(node.id)}</div>
          </div>
        );
      });
    }

    return (
      <div className="requirements-outline-panel mt-4 overflow-hidden rounded-xl border bg-white">
        <div className="border-b px-3 py-2 text-sm text-gray-600">{moduleName} — Outline</div>
        <div className="requirements-outline-scroll max-h-[55vh] overflow-auto">{renderBranch(null)}</div>
        {!rows.length && (
          <div className="p-6 text-center text-sm text-gray-500">
            No items in this module. Click <span className="font-medium">New</span> or <span className="font-medium">Import</span>.
          </div>
        )}
        {editTable.open && (
  <QuickTableModal
    title="Edit Table"
    initial={editTable.cells}
    onCancel={() => setEditTable({ open: false, row: null, cells: [[]] })}
    onSave={(cells) => {
      if (editTable.row) {
        onInlineUpdate?.(editTable.row, { content: { type: "table", table: { cells } } });
      }
      setEditTable({ open: false, row: null, cells: [[]] });
    }}
  />
)}

      </div>
    );
  }

export function TablePanel({ rows, numbering, moduleName, attrColumns = [],
  onEdit, onDelete, onCreate, canCreate,
  onInlineUpdate, onShowHistory,
  onSelect, selectedId, selectedIds, disabled = false, hideRequirementTitles = false }) {

      // ────────────── Column Model (order must match rendering) ──────────────
  const columns = React.useMemo(() => {
    const fixedBefore = [
      { key: "id",       label: "ID" },
      { key: "title",    label: "Title" },
    ];
    const attrs = (attrColumns || []).map((k) => ({ key: `attr:${k}`, label: k }));
    const fixedAfter = [
      { key: "status",   label: "Status" },
      { key: "version",  label: "Version" },
      { key: "updatedAt",label: "Updated" },
      { key: "links",    label: "Links" },
    ];
    return [...fixedBefore, ...attrs, ...fixedAfter];
  }, [attrColumns]);

  // Reasonable defaults per column
  const defaultWidthFor = React.useCallback((key) => {
    if (key === "id") return 160;
    if (key === "title") return 340;
    if (key.startsWith("attr:")) return 180;
    if (key === "status") return 120;
    if (key === "version") return 100;
    if (key === "updatedAt") return 170;
    if (key === "links") return 90;
    return 150;
  }, []);

  // Persist widths per module
  const STORAGE_KEY = React.useMemo(
    () => `xhandle:table-colwidths:${moduleName || "default"}`,
    [moduleName]
  );

  // Initialize widths from storage or defaults
  const [colWidths, setColWidths] = React.useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
      }
    } catch {}
    return {};
  });

  // Ensure any new columns get a width
  React.useEffect(() => {
    setColWidths((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const c of columns) {
        if (!next[c.key]) {
          next[c.key] = defaultWidthFor(c.key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [columns, defaultWidthFor]);

  // Persist on change
  React.useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(colWidths)); } catch {}
  }, [STORAGE_KEY, colWidths]);

  // Resize interaction
  const MIN_WIDTH = 60;
  const startResize = (key, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[key] ?? defaultWidthFor(key);

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const w = Math.max(MIN_WIDTH, startW + dx);
      setColWidths((m) => ({ ...m, [key]: w }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const resetWidth = (key) => {
    setColWidths((m) => ({ ...m, [key]: defaultWidthFor(key) }));
  };

  const renderAttrVal = v => v == null ? '' : readableValue(v);

    const [editState, setEditState] = React.useState({ id: null, title: "" });
    const [editTable, setEditTable] = React.useState({ open: false, row: null, cells: [[]] });
    const [copiedId, setCopiedId] = React.useState(null);

    const inputRef = React.useRef(null);

    React.useEffect(() => {
      if (editState.id && inputRef.current) inputRef.current.focus();
    }, [editState.id]);

    function startInlineEdit(row) {
      if (disabled) return;
      setEditState({ id: row.id, title: row.title || "" });
    }
    function commitInlineEdit() {
      if (!editState.id) return;
      const row = rows.find(r => r.id === editState.id);
      const nextTitle = (editState.title || "").trim();
      setEditState({ id: null, title: "" });
      if (!disabled && row && nextTitle !== (row.title || "")) {
        onInlineUpdate?.(row, { title: nextTitle });
      }
    }
    function cancelInlineEdit() {
      setEditState({ id: null, title: "" });
    }

    async function copyRequirementId(id) {
      const text = String(id || "");
      if (!text) return;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }
        setCopiedId(text);
        window.setTimeout(() => setCopiedId((current) => (current === text ? null : current)), 1200);
      } catch {
        setCopiedId(null);
      }
    }

    return (
      <div className="requirements-table-panel mt-4 rounded-xl border bg-white">
        {/* NEW: scrolling container for both axes */}
        <div className="requirements-table-scroll relative max-h-[60vh] overflow-x-auto overflow-y-auto">
          <table className="min-w-full text-sm table-fixed" style={{ width: columns.reduce((total, column) => total + (colWidths[column.key] ?? defaultWidthFor(column.key)), 0) }}>
            <colgroup>
              {columns.map((c) => (
                <col
                  key={`col-${c.key}`}
                  style={{ width: (colWidths[c.key] ?? defaultWidthFor(c.key)) + "px" }}
                />
              ))}
            </colgroup>

            {/* NEW: sticky header */}
            <thead className="sticky top-0 z-20 bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                {columns.map((c) => (
                  <th
                    key={`h-${c.key}`}
                    title={c.label}
                    // note the extra sticky/bg/z classes on the th itself too
                    className="relative px-3 py-2 text-left font-medium select-none sticky top-0 bg-gray-50 z-20"
                  >
                    <span>{c.label}</span>
                    {/* Resize handle (unchanged) */}
                    <span
                      role="separator"
                      aria-label={`Resize column ${c.label}`}
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-gray-300"
                      onMouseDown={(e) => startResize(c.key, e)}
                      onDoubleClick={() => resetWidth(c.key)}
                    />
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => {
const isSelected = selectedId === r.id || selectedIds?.has?.(r.id);
const isEditing = editState.id === r.id;

                return (
                  <tr
  key={r.id}
  className={`border-t hover:bg-gray-50 ${isSelected ? "bg-blue-50 ring-1 ring-blue-300" : ""}`}
  onMouseDown={(e) => {
    const t = e.target;
    const tag = t.tagName;
    const interactive =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      tag === "BUTTON" ||
      t.isContentEditable;
    if (interactive) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault();
    }
  }}
  onClick={(e) => onSelect?.(r.id, e)}
  data-artifact-object-id={r.id}
  onDoubleClick={(e) => { e.stopPropagation(); if (!disabled) onEdit(r); }}
  role="button"
  aria-selected={isSelected}
>
                    <td className="group/id-cell px-3 py-2 align-top font-mono text-[11px] text-gray-500">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate" title={r.id}>{r.id}</span>
                        <button
                          type="button"
                          title={copiedId === r.id ? "Copied" : "Copy requirement ID"}
                          aria-label={`Copy requirement ID ${r.id}`}
                          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent transition ${
                            copiedId === r.id
                              ? "bg-emerald-50 text-emerald-700 opacity-100"
                              : "text-gray-400 opacity-0 hover:border-gray-200 hover:bg-white hover:text-gray-700 focus:opacity-100 group-hover/id-cell:opacity-100"
                          }`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            copyRequirementId(r.id);
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>

                    <td className="px-3 py-2 align-top">
                      {(() => {
                        const num = numbering?.get?.(r.id);
                        const Prefix = num ? (
                          <span
                            className="shrink-0 whitespace-nowrap font-mono text-[11px] text-gray-500 min-w-[3.5rem] text-right"
                            style={{ display: "inline-block" }}
                            aria-hidden="true"
                          >
                            {num}
                          </span>
                        ) : null;

                        if (hideRequirementTitles && (r.kind === 'requirement' || r.proposedKind === 'requirement')) return Prefix;

                        if (isEditing) {
                          return (
                            <div className="flex items-start gap-2">
                              {Prefix}
                              <input
                                ref={inputRef}
                                className="w-full rounded border px-2 py-1 text-sm"
                                value={editState.title}
                                onChange={(e) => setEditState((s) => ({ ...s, title: e.target.value }))}
                                onBlur={commitInlineEdit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { e.preventDefault(); commitInlineEdit(); }
                                  if (e.key === "Escape") { e.preventDefault(); cancelInlineEdit(); }
                                }}
                              />
                            </div>
                          );
                        }

                        if (r?.content?.type === "image") {
                          return (
                            <div className="flex items-start gap-2">
                              {Prefix}
                              <img
                                src={r.content?.image?.dataUrl}
                                alt={r.title || r.content?.image?.name || "image"}
                                className="max-h-16 rounded"
                                onDoubleClick={(e) => { e.stopPropagation(); if (!disabled) onEdit(r); }}
                              />
                            </div>
                          );
                        }

                        if (r?.content?.type === "table") {
                          return (
                            <div
                              className="flex items-start gap-2"
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (disabled) return;
                        setEditTable({
                                  open: true,
                                  row: r,
                                  cells: Array.isArray(r.content?.table?.cells) ? r.content.table.cells : [[]],
                                });
                              }}
                            >
                              {Prefix}
                              <div className="max-h-28 overflow-auto">
                                <MiniTable cells={r.content?.table?.cells || []} dense />
                              </div>
                            </div>
                          );
                        }

                        return (
<div
  className="flex items-start gap-2"
  title="Double-click to edit title"
  onDoubleClick={(e) => { e.stopPropagation(); startInlineEdit(r); }}
>
  {Prefix}
  <div className={`whitespace-normal break-words leading-snug ${r.heading ? "font-semibold" : "font-medium"}`}>
    {r.title || <span className="text-gray-400">(untitled)</span>}
  </div>
</div>

                        );
                      })()}
                    </td>

                    {/* attribute cells */}
                    {attrColumns.map((k) => (
                      <td key={`c-${r.id}-${k}`} data-object-field={k} className="px-3 py-2">
                        {renderAttrVal(r.attributes?.[k])}
                      </td>
                    ))}

                    <td className="px-3 py-2">
                      <select
                        className="rounded border px-2 py-1 text-sm"
                        value={r.status || "Proposed"}
                        disabled={disabled}
                        onChange={(e) => onInlineUpdate(r, { status: e.target.value })}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>

                    <td className="px-3 py-2">{r.version ?? 1}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {(r.updatedAt || "").replace("T", " ").slice(0, 16)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{(r.links || []).length}</td>
                  </tr>
                );
              })}

              {!rows.length && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-gray-500">
                    No requirements yet.{" "}
                    {canCreate && (
                      <>
                        Click <span className="font-medium">New</span> or use <span className="font-medium">Import</span>.
                      </>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editTable.open && !disabled && <QuickTableModal title="Edit Table" initial={editTable.cells} onCancel={() => setEditTable({ open: false, row: null, cells: [[]] })} onSave={cells => { onInlineUpdate?.(editTable.row, { content: { type: 'table', table: { cells } } }); setEditTable({ open: false, row: null, cells: [[]] }); }} />}
      </div>
    );
  }

export function MiniTable({ cells = [[]], dense = false }) {
    const cls = dense ? "px-1 py-0.5" : "px-2 py-1";
    return (
      <table className="border border-gray-200 rounded">
        <tbody>
          {(cells.length ? cells : [[]]).map((row, i) => (
            <tr key={i}>
              {(row.length ? row : [""]).map((c, j) => (
                <td key={j} className={`border border-gray-200 text-xs ${cls}`}>{String(c ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

export function QuickTableModal({ title = "Insert Table", initial, onCancel, onSave }) {
    // If `initial` is provided, prefill from it
    const initialRows = Array.isArray(initial) && initial.length ? initial.length : 3;
    const initialCols = Array.isArray(initial?.[0]) && initial[0].length ? initial[0].length : 3;

    const [rows, setRows] = React.useState(initialRows);
    const [cols, setCols] = React.useState(initialCols);
    const [grid, setGrid] = React.useState(
      Array.from({ length: initialRows }, (_, i) =>
        Array.from({ length: initialCols }, (_, j) => initial?.[i]?.[j] ?? "")
      )
    );

    // When rows/cols change, preserve existing cells
    React.useEffect(() => {
      setGrid((g) => {
        const r = Math.max(1, rows), c = Math.max(1, cols);
        const next = Array.from({ length: r }, (_, i) =>
          Array.from({ length: c }, (_, j) => g[i]?.[j] ?? "")
        );
        return next;
      });
    }, [rows, cols]);

    return (
      <Modal title={title} onClose={onCancel}>
        <div className="space-y-3">
          <div className="flex gap-3">
            <Field label="Rows">
              <input
                type="number"
                min={1}
                className="w-24 rounded border px-2 py-1 text-sm"
                value={rows}
                onChange={(e) => setRows(Number(e.target.value || 1))}
              />
            </Field>
            <Field label="Cols">
              <input
                type="number"
                min={1}
                className="w-24 rounded border px-2 py-1 text-sm"
                value={cols}
                onChange={(e) => setCols(Number(e.target.value || 1))}
              />
            </Field>
          </div>

          <div className="overflow-auto max-h-72 rounded border p-2">
            <table className="text-xs">
              <tbody>
                {grid.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => (
                      <td key={j} className="border border-gray-200">
                        <input
                          className="w-28 px-2 py-1 text-xs outline-none"
                          value={cell}
                          onChange={(e) => {
                            const v = e.target.value;
                            setGrid((g) =>
                              g.map((rr, ii) =>
                                ii === i
                                  ? rr.map((cc, jj) => (jj === j ? v : cc))
                                  : rr
                              )
                            );
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2">
            <button className="rounded border px-3 py-2 text-sm hover:bg-gray-50" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="rounded bg-[#2D7DFE] px-3 py-2 text-sm text-white hover:bg-[#1E61D6]"
              onClick={() => onSave(grid)}
            >
              Save
            </button>
          </div>
        </div>
      </Modal>
    );
  }

export function TraceabilityView({
  allRequirements = [],
  selectedModule,
  activeFolderId,
  folderNameById = {},
  pageSize = Infinity,
}) {
  const [mode, setMode] = React.useState("REFINES"); // "REFINES" | "REFINED_BY"

  const [pages, setPages] = React.useState({});
  React.useEffect(() => setPages({}), [allRequirements, selectedModule, activeFolderId, mode]);

  const memo = React.useMemo(() => {
    const all = Array.isArray(allRequirements) ? allRequirements : [];

    // Seed = only items in the selected module & active folder
    const seed = all.filter((r) => {
      if (selectedModule && r.module !== selectedModule) return false;
      if (activeFolderId && (r.folderId ?? r.projectId) !== activeFolderId) return false;
      return true;
    });

    // Map for resolving titles/modules/folders for ANY node (not just seed)
    const byId = new Map(all.map((r) => [r.id, r]));
    const seedSet = new Set(seed.map((r) => r.id));

    // Helper to pull folder label
    const folderOf = (r) => folderNameById?.[r?.folderId ?? r?.projectId] ?? "—";

    // -------- Refines OUT of the seed (module → anything)
    const edgesOut = [];
    const dangling = [];

    for (const r of seed) {
      const links = Array.isArray(r.links) ? r.links : [];
      for (const l of links) {
        if (!l?.toId) continue;
        if (String(l.type || "").toLowerCase() !== "refines") continue;

        const fromFolder = folderOf(r);
        if (byId.has(l.toId)) {
          const toReq = byId.get(l.toId);
          edgesOut.push({
            type: "refines",
            from: r.id,
            fromTitle: r.title || "",
            fromModule: r.module || "",
            fromFolder,
            to: l.toId,
            toTitle: toReq?.title || "",
            toModule: toReq?.module || "",
            toFolder: folderOf(toReq),
          });
        } else {
          // missing target → dangling
          dangling.push({
            type: "refines",
            from: r.id,
            fromTitle: r.title || "",
            fromModule: r.module || "",
            fromFolder,
            to: l.toId,
          });
        }
      }
    }

    // -------- Refines INTO the seed (anything → module)
    const edgesInRaw = [];
    for (const r of all) {
      const links = Array.isArray(r.links) ? r.links : [];
      for (const l of links) {
        if (!l?.toId) continue;
        if (String(l.type || "").toLowerCase() !== "refines") continue;
        if (!seedSet.has(l.toId)) continue;

        const toReq = byId.get(l.toId);
        edgesInRaw.push({
          type: "refines",
          from: r.id,
          fromTitle: r.title || "",
          fromModule: r.module || "",
          fromFolder: folderOf(r),
          to: l.toId,
          toTitle: toReq?.title || "",
          toModule: toReq?.module || "",
          toFolder: folderOf(toReq),
        });
      }
    }

    // -------- Orphans within the module context:
    // no outgoing "refines" FROM seed AND no incoming "refines" INTO seed
    const outgoingFromSeed = new Map();
    edgesOut.forEach((e) => outgoingFromSeed.set(e.from, (outgoingFromSeed.get(e.from) || 0) + 1));

    const incomingToSeed = new Map();
    edgesInRaw.forEach((e) => incomingToSeed.set(e.to, (incomingToSeed.get(e.to) || 0) + 1));

    const orphans = seed.filter(
      (r) => (outgoingFromSeed.get(r.id) || 0) === 0 && (incomingToSeed.get(r.id) || 0) === 0
    );

    // Stats reflect the seeded set; edges count reflects the current mode
    const stats = {
      nodes: seed.length,
      edges: edgesOut.length,
      dangling: dangling.length,
      orphans: orphans.length,
    };

    return { edgesOut, edgesInRaw, dangling, orphans, stats, seed };
  }, [allRequirements, selectedModule, activeFolderId, folderNameById]);

  const { edgesOut, edgesInRaw, dangling, orphans, stats } = memo;

  // For "refined by", show SUBJECT (seed item) on the left and the REFINER on the right
  const viewEdges =
    mode === "REFINES"
      ? edgesOut
      : edgesInRaw.map((e) => ({
          type: "refined by",
          from: e.to,
          fromTitle: e.toTitle,
          fromModule: e.toModule,
          fromFolder: e.toFolder,
          to: e.from,
          toTitle: e.fromTitle,
          toModule: e.fromModule,
          toFolder: e.fromFolder,
        }));

  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : Infinity;
  const page = (key, items) => Math.min(pages[key] || 0, Math.max(0, Math.ceil(items.length / size) - 1));
  const visible = (key, items) => size === Infinity ? items : items.slice(page(key, items) * size, (page(key, items) + 1) * size);
  const pagination = (key, items) => items.length > size && <nav aria-label={`${key} pages`} className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs">
    <button disabled={page(key, items) === 0} onClick={() => setPages(previous => ({ ...previous, [key]: page(key, items) - 1 }))}>Previous</button>
    <span>{page(key, items) * size + 1}–{Math.min((page(key, items) + 1) * size, items.length)} of {items.length}</span>
    <button disabled={(page(key, items) + 1) * size >= items.length} onClick={() => setPages(previous => ({ ...previous, [key]: page(key, items) + 1 }))}>Next</button>
  </nav>;

  const PathLine = ({ folder, module }) => (
    <div className="text-[11px] text-gray-500">[{folder || "—"} / {module || "—"}]</div>
  );

  return (
    <div className="grid grid-cols-12 gap-4 mt-4">
      {/* Left: metrics + lists */}
      <div className="col-span-12 lg:col-span-4 space-y-4">
        {/* Metrics (sticky) */}
    <div className="rounded-xl border bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Traceability Metrics</h3>
          </div>

          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-gray-500">Nodes</dt><dd className="font-medium">{stats.nodes}</dd></div>
            <div><dt className="text-gray-500">Edges</dt><dd className="font-medium">{mode === "REFINES" ? edgesOut.length : edgesInRaw.length}</dd></div>
            <div><dt className="text-gray-500">Orphans</dt><dd className="font-medium">{stats.orphans}</dd></div>
            <div><dt className="text-gray-500">Dangling Refs</dt><dd className="font-medium">{stats.dangling}</dd></div>
          </dl>
        </div>

        {/* Dangling list (sticky header inside, scroll body) */}
        {!!dangling.length && (
          <div className="rounded-xl border bg-white">
            <div className="max-h-[32vh] overflow-auto">
              <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b px-4 py-2">
                <h4 className="text-sm font-semibold">Dangling “refines” Links</h4>
              </div>
              <ul className="p-4 space-y-2 text-xs">
                {visible("Dangling links", dangling).map((d, i) => (
                  <li key={`${d.from}-${d.to}-${i}`} data-artifact-object-id={d.from} className="leading-tight">
                    <PathLine folder={d.fromFolder} module={d.fromModule} />
                    <div className="text-[11px] text-gray-400 font-mono">{d.from}</div>
                    <div className="text-[13px] font-medium">
                      {d.fromTitle || <span className="text-gray-400">(untitled)</span>}
                    </div>
                    <div>
                      <span className="mx-1">—refines→</span>
                      <code className="bg-gray-50 px-1 py-0.5 rounded">(missing) {d.to}</code>
                    </div>
                  </li>
                ))}
              </ul>
              {pagination("Dangling links", dangling)}
            </div>
          </div>
        )}

        {/* Orphans (sticky header inside, scroll body) */}
        {!!orphans.length && (
          <div className="rounded-xl border bg-white">
            <div className="max-h-[45vh] overflow-auto">
              <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b px-4 py-2">
                <h4 className="text-sm font-semibold">Orphans (no in/out “refines”)</h4>
              </div>
              <ul className="p-4 space-y-2 text-sm">
                {visible("Orphans", orphans).map((r) => {
                  const folder = folderNameById?.[r.folderId ?? r.projectId] ?? "—";
                  return (
                    <li key={r.id} data-artifact-object-id={r.id} className="leading-tight">
                      <PathLine folder={folder} module={r.module} />
                      <div className="text-[11px] text-gray-400 font-mono">{r.id}</div>
                      <div className="truncate">
                        {r.title || <span className="text-gray-400">(untitled)</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {pagination("Orphans", orphans)}
            </div>
          </div>
        )}
      </div>

      {/* Right: links table (sticky head, scroll body) */}
      <div className="col-span-12 lg:col-span-8 rounded-xl border bg-white">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <h3 className="text-sm font-semibold">
            Links — {mode === "REFINES" ? "Refines" : "Refined by"}
          </h3>
          <div className="inline-flex overflow-hidden rounded border">
            <button
              className={`px-2 py-1 text-xs ${mode === "REFINES" ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
              onClick={() => setMode("REFINES")}
              aria-pressed={mode === "REFINES"}
            >
              Refines
            </button>
            <button
              className={`px-2 py-1 text-xs ${mode === "REFINED_BY" ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
              onClick={() => setMode("REFINED_BY")}
              aria-pressed={mode === "REFINED_BY"}
            >
              Refined by
            </button>
          </div>
        </div>

        {pagination("Relationships", viewEdges)}
        <div className="relative max-h-[520px] overflow-auto">
          {!viewEdges.length ? (
            <div className="p-4 text-sm text-gray-500">No links found for this view.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-20 bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="px-2 py-2 text-left">
                    {mode === "REFINES" ? "From (module item)" : "Subject (module item)"}
                  </th>
                  <th className="px-2 py-2 text-left">Relation</th>
                  <th className="px-2 py-2 text-left">
                    {mode === "REFINES" ? "To" : "Refiner"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible("Relationships", viewEdges).map((e, i) => (
                  <tr key={i} className="border-t align-top">
                    <td className="px-2 py-2">
                      <div className="leading-tight" data-artifact-object-id={e.from}>
                        <PathLine folder={e.fromFolder} module={e.fromModule} />
                        <div className="text-[11px] text-gray-400 font-mono">{e.from}</div>
                        <div className="font-medium">
                          {e.fromTitle || <span className="text-gray-400">(untitled)</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2">{e.type}</td>
                    <td className="px-2 py-2">
                      <div className="leading-tight" data-artifact-object-id={e.to}>
                        <PathLine folder={e.toFolder} module={e.toModule} />
                        <div className="text-[11px] text-gray-400 font-mono">{e.to}</div>
                        <div className="font-medium">
                          {e.toTitle || <span className="text-gray-400">(untitled)</span>}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export function Field({label, children}){ return (<label className="block"><div className="mb-1 text-xs font-medium text-gray-700">{label}</div>{children}</label>); }

export function Modal({ title, onClose, children }) {
    return (
      <div className="xhandle-modal-viewport fixed inset-0 z-[999]">
        <div
          className="absolute inset-0 bg-black/40"
          onClick={onClose}
          aria-hidden
        />
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[90vh] rounded-2xl bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-semibold">{title}</h3>
              <button
                className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                onClick={onClose}
              >
                ✕
              </button>
            </div>
            {/* Scrollable content area */}
            <div className="p-4 overflow-y-auto flex-1">{children}</div>
          </div>
        </div>
      </div>
    );
  }
