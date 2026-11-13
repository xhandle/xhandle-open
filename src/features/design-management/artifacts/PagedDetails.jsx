import React, { useState } from 'react';

// Closed evidence lists should not mount thousands of hidden DOM elements.
export default function PagedDetails({ title, items, renderItem }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const current = Math.min(page, Math.max(0, Math.ceil(items.length / 50) - 1));
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>{title}</summary>{open && <>
    {items.slice(current * 50, (current + 1) * 50).map(renderItem)}
    {items.length > 50 && <div className="artifact-actions"><button type="button" disabled={!current} onClick={() => setPage(current - 1)}>Previous</button><span>{current * 50 + 1}–{Math.min((current + 1) * 50, items.length)} of {items.length}</span><button type="button" disabled={(current + 1) * 50 >= items.length} onClick={() => setPage(current + 1)}>Next</button></div>}
  </>}</details>;
}
