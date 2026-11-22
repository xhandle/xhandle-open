import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function RenameReportDialog({ report, onRename, onClose }) {
  const [name, setName] = useState(report.title || '');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const dialog = useRef(null), input = useRef(null), mounted = useRef(true);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement;
    mounted.current = true; input.current?.focus(); input.current?.select();
    return () => { mounted.current = false; if (previous?.isConnected) previous.focus?.(); };
  }, []);
  const save = async event => {
    event.preventDefault(); if (saving || !name.trim()) return;
    setSaving(true); setError('');
    try {
      if (!await onRename(report.id, name.trim())) throw new Error('Report is unavailable');
      if (mounted.current) onClose();
    } catch {
      if (mounted.current) setError('The report could not be renamed. Please try again.');
    } finally { if (mounted.current) setSaving(false); }
  };
  return createPortal(<div className="xhandle-modal-viewport fixed inset-0 z-[1200] flex items-center justify-center p-4" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!saving) onClose(); }
    if (event.key === 'Tab') {
      const fields = [...dialog.current.querySelectorAll('input,button')].filter(element => !element.disabled);
      const first = fields[0], last = fields[fields.length - 1];
      if (!first) { event.preventDefault(); dialog.current.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}>
    <div className="absolute inset-0 bg-black/40" onClick={() => { if (!saving) onClose(); }} />
    <form ref={dialog} onSubmit={save} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={saving} tabIndex={-1} className="relative w-full max-w-md rounded-xl border bg-white p-5 shadow-xl">
      <h2 id={`${id}-title`} className="mb-4 text-lg font-semibold">Rename report</h2>
      <label htmlFor={`${id}-name`} className="mb-1 block text-sm">Report name</label>
      <input ref={input} id={`${id}-name`} value={name} maxLength={160} readOnly={saving} onChange={event => setName(event.target.value)} className="w-full rounded-md border px-3 py-2 text-sm" />
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={saving} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
        <button type="submit" disabled={saving || !name.trim()} className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save name'}</button>
      </div>
    </form>
  </div>, document.body);
}
