import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// A disclosure, rather than an ARIA menu: the panel also contains review text,
// comparison details and form controls. Portal it outside the scrolling editor.
export default function ArtifactActionsPopover({ status, children }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({});
  const trigger = useRef(null), panel = useRef(null);
  const panelId = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current.getBoundingClientRect();
      const width = Math.min(440, window.innerWidth - 16);
      const top = Math.min(anchor.bottom + 6, Math.max(8, window.innerHeight - 240));
      setPosition({ top, left: Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)), width, maxHeight: window.innerHeight - top - 8 });
    };
    const outside = event => {
      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    place();
    panel.current?.focus();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', place);
    };
  }, [open]);
  return <div className="artifact-overflow">
    {status && <span className="artifact-compact-status" role="status" title={status}>{status}</span>}
    <button ref={trigger} type="button" className="artifact-overflow-trigger" aria-label="Artifact actions" title="Artifact actions and proposal review" aria-expanded={open} aria-controls={open ? panelId : undefined} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>…</button>
    {open && createPortal(<div ref={panel} id={panelId} className="artifact-actions-popover" role="dialog" aria-label="Artifact actions and proposal review" tabIndex={-1} style={position}>
      <div className="artifact-popover-heading"><strong>Artifact actions</strong><button type="button" aria-label="Close artifact actions" onClick={close}>×</button></div>
      {children(close)}
    </div>, document.body)}
  </div>;
}
