import React, { useEffect, useMemo, useState } from "react";
import { Modal } from '../features/requirements/components/RequirementsViews';

const TYPE_OPTIONS = ["text", "number", "boolean", "date"];

const toSafeKey = (label) =>
  String(label)
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .toLowerCase()
    .slice(0, 48);

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
    <Modal title={`Map Attributes (Title: ${titleColumn})`} onClose={onClose} footer={<div className="flex items-center justify-end gap-2">
      <button className="rounded-md border px-3 py-1 text-sm" onClick={onClose}>Cancel</button>
      <button className="rounded-md bg-black px-3 py-1 text-sm text-white" onClick={() => onConfirm(rows.filter(row => row.enabled))}>Create attributes &amp; import</button>
    </div>}>
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

    </Modal>
  );
}
