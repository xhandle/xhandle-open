import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function ArtifactObjectMenu({ target, disabled, onClose, onEdit, onView, onHistory, tableOnly = false, onDelete }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });
  useLayoutEffect(() => {
    const bounds = ref.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(target.x, window.innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(target.y, window.innerHeight - bounds.height - 8)) });
    ref.current.querySelector('button:not(:disabled)')?.focus();
  }, [target]);
  useEffect(() => {
    const outside = event => { if (!ref.current?.contains(event.target)) onClose(); };
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); target.element?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const items = [...ref.current.querySelectorAll('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', key); };
  }, [onClose, target]);
  const run = action => { onClose(); action(); };
  return createPortal(<div ref={ref} role="menu" aria-label={`Actions for ${target.object.title}`} className="artifact-object-menu" style={{ position: 'fixed', ...position, zIndex: 10000 }}>
    <button role="menuitem" disabled={disabled} onClick={() => run(() => onEdit(target.object, target.field))}>Edit object</button>
    {tableOnly && onDelete && <button role="menuitem" disabled={disabled} onClick={() => run(() => onDelete(target.object.id))}>Remove assessment</button>}
    {!tableOnly && [['outline', 'Outline'], ['table', 'Table'], ['TRACE', 'Traceability'], ['document', 'Document']].map(([view, label]) => <button key={view} role="menuitem" onClick={() => run(() => onView(view, target.object.id))}>Show in {label}</button>)}
    {onHistory && <button role="menuitem" onClick={() => run(() => onHistory(target.object.id))}>Object history</button>}
  </div>, document.body);
}
