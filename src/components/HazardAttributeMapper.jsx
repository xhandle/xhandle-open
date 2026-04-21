/**
 * xHandle: hazard attribute mapper shared application component.
 * This file implements a reusable application-level component or helper that participates in xHandle's end-to-end engineering workflows.
 * Shared components connect the main workspace, diagrams, copilot features, reporting, and local persistence so individual features can cooperate as one system.
 * Related files: src/App.js, src/lib/storage/indexedDB.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

import React, { useEffect, useMemo, useState } from "react";

const TYPE_OPTIONS = ["text", "number", "boolean", "date"];

/**
 * toSafeKey renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param label Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const toSafeKey = (label) =>
  String(label)
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .toLowerCase()
    .slice(0, 48);

/**
 * guessType renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param val Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const guessType = (val) => {
  if (val === "true" || val === "false" || typeof val === "boolean") return "boolean";
  if (!isNaN(Number(val)) && val !== "" && val !== null && val !== undefined) return "number";
  if (typeof val === "string" && /\d{4}-\d{2}-\d{2}/.test(val)) return "date";
  return "text";
};

export default function HazardAttributeMapper({
  open,
  onClose,
  columns = [],              // string[]
  titleColumn,               // string
  sampleRow = {},            // object (one row from the dataset)
  onConfirm,                 // (mappings) => void
}) {
  // ✅ Hooks must always run
  const initial = useMemo(
    () =>
      (columns || [])
        .filter((c) => c !== titleColumn)
        .map((c) => ({
          sourceCol: c,
          enabled: true,
          attrKey: toSafeKey(c),
          type: guessType(sampleRow?.[c]),
          required: false,
        })),
    [columns, titleColumn, sampleRow]
  );

  const [rows, setRows] = useState(initial);
  useEffect(() => setRows(initial), [initial]);

  // Only decide to render (or not) AFTER hooks have been called
  if (!open) return null;

  const update = (i, patch) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  return (
    <div className="fixed inset-0 z-[999]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold">
              Map Attributes (Title: <span className="font-mono">{titleColumn}</span>)
            </h3>
            <button
              className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="p-4 overflow-y-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Use</th>
                  <th className="py-2">Source Column</th>
                  <th className="py-2">Attribute Key</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Required</th>
                  <th className="py-2">Sample</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.sourceCol} className="border-b">
                    <td className="py-2">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(e) => update(i, { enabled: e.target.checked })}
                      />
                    </td>
                    <td className="py-2 font-mono">{row.sourceCol}</td>
                    <td className="py-2">
                      <input
                        className="w-full rounded border px-2 py-1"
                        value={row.attrKey}
                        onChange={(e) => update(i, { attrKey: e.target.value })}
                        placeholder="attribute_key"
                      />
                    </td>
                    <td className="py-2">
                      <select
                        className="rounded border px-2 py-1"
                        value={row.type}
                        onChange={(e) => update(i, { type: e.target.value })}
                      >
                        {TYPE_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2">
                      <input
                        type="checkbox"
                        checked={row.required}
                        onChange={(e) => update(i, { required: e.target.checked })}
                      />
                    </td>
                    <td className="py-2 text-gray-500">
                      <span className="font-mono">
                        {String(sampleRow?.[row.sourceCol] ?? "")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-md border px-3 py-1 text-sm"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-black px-3 py-1 text-sm text-white"
                onClick={() => onConfirm(rows.filter((r) => r.enabled))}
              >
                Create attributes & import
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
