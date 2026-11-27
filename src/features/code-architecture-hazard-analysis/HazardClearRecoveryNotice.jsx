import React from 'react';

export default function HazardClearRecoveryNotice({ status, busy, onRestore }) {
  if (!status) return null;
  return <div role="status" className="m-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
    <p>{status.message || 'Hazard analysis cleared. A recovery snapshot is saved for this repository.'}</p>
    {status.canUndo && <button type="button" disabled={busy} onClick={onRestore} className="mt-2 rounded-md border border-blue-300 bg-white px-3 py-1.5 font-medium disabled:opacity-50">
      {busy ? 'Restoring…' : 'Restore cleared analysis'}
    </button>}
  </div>;
}
