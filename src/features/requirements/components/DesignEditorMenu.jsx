import React, { useEffect, useRef, useState } from 'react';

// Callers supply only commands supported by the current document.
export default function DesignEditorMenu({ menus }) {
  const [open, setOpen] = useState(null);
  const bar = useRef(null);
  const triggers = useRef({});
  useEffect(() => {
    const close = event => { if (!bar.current?.contains(event.target)) setOpen(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  return <div ref={bar} data-menubar role="menubar" aria-label="Design editor commands" className="flex flex-wrap gap-1 text-gray-800" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(null); triggers.current[open]?.focus(); }
  }}>
    {menus.filter(menu => menu.items?.length).map(menu => <div key={menu.label} className="relative">
      <button ref={element => { triggers.current[menu.label] = element; }} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === menu.label} className="rounded px-3 py-1.5 text-sm hover:bg-gray-100" onClick={() => setOpen(value => value === menu.label ? null : menu.label)}>{menu.label}</button>
      {open === menu.label && <div role="menu" aria-label={menu.label} className="absolute left-0 z-50 mt-1 min-w-[220px] rounded-md border bg-white py-1 shadow">
        {menu.items.map((item, index) => item.text
          ? <p key={index} className="max-w-xs px-3 py-2 text-sm text-gray-600">{item.text}</p>
          : <button key={item.label} type="button" role="menuitem" disabled={item.disabled} className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => { setOpen(null); item.onSelect(); }}>{item.label}</button>)}
      </div>}
    </div>)}
  </div>;
}
