import React, { useEffect, useRef } from 'react';

export default function AnalysisModeModal({ selection, onChoose }) {
  const dialog = useRef(null);
  useEffect(() => {
    if (!selection) return undefined;
    const previous = document.activeElement;
    dialog.current?.querySelector('button')?.focus();
    return () => previous?.isConnected && previous.focus?.();
  }, [selection]);
  if (!selection) return null;
  const onKeyDown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onChoose(null); }
    if (event.key !== 'Tab') return;
    const buttons = [...dialog.current.querySelectorAll('button')];
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="xhandle-modal-viewport fixed inset-0 z-[120] flex items-center justify-center p-4" onKeyDown={onKeyDown}>
    <div className="absolute inset-0 bg-black/40" onClick={() => onChoose(null)} />
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="analysis-mode-title" aria-describedby="analysis-mode-description" className="relative w-full max-w-lg rounded-xl border bg-white p-6 shadow-xl">
      <h2 id="analysis-mode-title" className="text-lg font-semibold">Replace or append analysis?</h2>
      <div id="analysis-mode-description" className="mt-3 space-y-3 text-sm text-slate-700">
        <p>This repository already has saved analysis. Selected file types: <strong>{selection.extensions.join(', ')}</strong>.</p>
        <p><strong>Replace analysis</strong> reruns the selected file types. Earlier results outside this selection become historical.</p>
        <p><strong>Append to analysis</strong> keeps the existing results, adds selected files that have not been analyzed, and checks connections in both directions with earlier files. Previously analyzed files must be unchanged.</p>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => onChoose(null)}>Cancel</button>
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => onChoose('replace')}>Replace analysis</button>
        <button type="button" className="rounded bg-[#2D7DFE] px-3 py-2 text-sm text-white" onClick={() => onChoose('append')}>Append to analysis</button>
      </div>
    </div>
  </div>;
}
