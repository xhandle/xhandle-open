import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './artifacts.css';
import { useDesignActions } from '../DesignActionsContext';

// A disclosure with grouped commands. Portal it outside the scrolling editor.
export default function ArtifactActionsPopover({ status, children, label = 'Artifact actions', panelLabel = label === 'Artifact actions' ? 'Artifact actions and proposal review' : label, compact = false, primary = false }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({});
  const trigger = useRef(null), panel = useRef(null);
  const panelId = useId();
  const shared = useDesignActions();
  const register = primary ? shared?.register : null;
  useLayoutEffect(() => register?.(panelId), [register, panelId]);
  const combined = primary && !!shared;
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current.getBoundingClientRect();
      const width = Math.min(compact ? 300 : 340, window.innerWidth - 16);
      const top = Math.min(anchor.bottom + 6, Math.max(8, window.innerHeight - 240));
      setPosition({ top, left: Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)), width, maxHeight: window.innerHeight - top - 8 });
    };
    const outside = event => {
      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    const scroll = event => { if (!panel.current?.contains(event.target)) setOpen(false); };
    place();
    panel.current?.focus();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open, compact]);
  const disclosure = <div className="artifact-overflow">
    {status && <span className="artifact-compact-status" role="status" title={status}>{status}</span>}
    <button ref={trigger} type="button" className="artifact-overflow-trigger" aria-label={label} title={panelLabel} aria-expanded={open} aria-controls={open ? panelId : undefined} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>…</button>
    {open && createPortal(<div ref={panel} id={panelId} className="artifact-actions-popover" data-compact={compact || undefined} role="dialog" aria-label={panelLabel} tabIndex={-1} style={position}>
      <div className="artifact-popover-heading"><strong>{label}</strong><button type="button" aria-label={`Close ${label.toLowerCase()}`} onClick={close}>×</button></div>
      {children(close)}
      {combined && <section className="design-workspace-actions" aria-label="Design Management actions">
        {shared.workspaceActions(close)}
      </section>}
    </div>, document.body)}
  </div>;
  return combined ? (shared.host ? createPortal(disclosure, shared.host) : null) : disclosure;
}
