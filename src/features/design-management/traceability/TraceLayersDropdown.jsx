import React, { useEffect, useId, useRef, useState } from 'react';

export default function TraceLayersDropdown({ layers, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const host = useRef(null), trigger = useRef(null), panelId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!host.current?.contains(event.target)) setOpen(false); };
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const toggle = id => onChange(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]);
  return <div className="project-trace-layers" ref={host}>
    <button ref={trigger} type="button" aria-label="Layers" title="Choose relationship types" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(value => !value)}>
      Layers <span>{selected.length === layers.length ? 'All' : `${selected.length} / ${layers.length}`}</span> <span aria-hidden="true">⌄</span>
    </button>
    {open && <div id={panelId} className="project-trace-layers-panel" role="group" aria-label="Traceability layers">
      <p className="project-trace-layers-heading">Relationship types</p>
      <div className="project-trace-layers-actions"><button type="button" onClick={() => onChange(layers.map(layer => layer.id))}>Select all</button><button type="button" onClick={() => onChange([])}>Deselect all</button></div>
      <div className="project-trace-layers-options">{layers.map(layer => <label key={layer.id}>
        <input type="checkbox" checked={selected.includes(layer.id)} onChange={() => toggle(layer.id)} />{layer.label}
      </label>)}</div>
      {!layers.length && <p>No recorded relationships.</p>}
    </div>}
  </div>;
}
