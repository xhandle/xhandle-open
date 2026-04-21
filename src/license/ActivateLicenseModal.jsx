/**
 * xHandle: activate license modal licensing workflow.
 * This file implements part of the optional licensing layer that gates premium or deployment-sensitive behaviors in xHandle.
 * Licensing is kept separate from the main engineering flows so the core workspace stays understandable while still supporting activation and entitlement checks when needed.
 * Related files: server/license/routes.js, server/license/issue.js, src/App.js.
 */

// src/license/ActivateLicenseModal.jsx
import React, { useState } from "react";
import { useLicense } from "./LicenseContext";

export default function ActivateLicenseModal({ onClose }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const { activate, refresh } = useLicense();

  async function handleActivate() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setMsg("");

    try {
      const res = await activate(trimmed);
      await refresh?.();
      setMsg(`Activated ${String(res.plan || "pro").toUpperCase()} • ending ${res.last4 || "****"}`);
      setTimeout(() => onClose?.(), 700);
    } catch (e) {
      setMsg(e?.message || "Activation failed");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[999]" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl p-4 w-full max-w-md">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">Activate License</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Close">✕</button>
        </div>

        <label className="block text-sm text-gray-700 mt-4 mb-1">Activation code</label>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="XH-ABCD-EFGH-IJKL"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy && code.trim()) handleActivate();
          }}
          autoFocus
        />

        <div className="mt-3 flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-2 rounded border">Cancel</button>
          <button
            onClick={handleActivate}
            disabled={busy || !code.trim()}
            className={`px-3 py-2 rounded text-white ${busy || !code.trim() ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}`}
          >
            {busy ? "Checking…" : "Activate"}
          </button>
        </div>

        {msg && <p className="text-sm mt-3">{msg}</p>}
      </div>
    </div>
  );
}
