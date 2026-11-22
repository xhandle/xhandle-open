import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './reportDocumentLayout.css';

// Use the rendered document as the outline source, so fenced code, HTML,
// formatted headings and Setext headings agree with what the reader sees.
export default function ReportDocumentLayout({ documentKey, children, fitViewport = false }) {
  const prefix = `report-${useId().replace(/[^a-z0-9_-]/gi, '')}`;
  const host = useRef(null), reader = useRef(null), toggle = useRef(null);
  const nodes = useRef([]), synchronize = useRef(null);
  const [headings, setHeadings] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [compact, setCompact] = useState(false);
  const outlineId = `${prefix}-contents`;

  useLayoutEffect(() => {
    const element = host.current;
    let previous;
    const measure = () => {
      const narrow = element.getBoundingClientRect().width < 560;
      if (narrow !== previous) { previous = narrow; setCompact(narrow); setCollapsed(narrow); }
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);

  useLayoutEffect(() => {
    const pane = reader.current;
    let updateFrame = 0, scrollFrame = 0;
    const updateActive = () => {
      scrollFrame = 0;
      const elements = nodes.current;
      if (!elements.length) { setActiveId(''); return; }
      let current = elements[0].id;
      const top = pane.getBoundingClientRect().top;
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= top + 48) current = element.id;
        else break;
      }
      if (pane.scrollHeight > pane.clientHeight + 1 && pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2) current = elements[elements.length - 1].id;
      setActiveId(current);
    };
    const sync = () => {
      cancelAnimationFrame(updateFrame);
      updateFrame = 0;
      const seen = new Set();
      nodes.current = [...pane.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(element => element.textContent.trim() && !element.closest('svg,[hidden],[aria-hidden="true"]'));
      const reserved = new Set(nodes.current.map(element => element.id).filter(Boolean));
      const entries = nodes.current.map((element, index) => {
        if (!element.id || seen.has(element.id)) {
          const base = `${prefix}-heading-${index}`;
          let id = base, suffix = 1;
          while (reserved.has(id) || seen.has(id)) id = `${base}-${suffix++}`;
          element.id = id;
        }
        seen.add(element.id);
        return { id: element.id, title: element.textContent.replace(/\s+/g, ' ').trim(), level: Number(element.tagName.slice(1)) };
      });
      setHeadings(previous => JSON.stringify(previous) === JSON.stringify(entries) ? previous : entries);
      updateActive();
    };
    const scheduleSync = () => { if (!updateFrame) updateFrame = requestAnimationFrame(sync); };
    const onScroll = () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateActive); };
    pane.scrollTop = 0;
    synchronize.current = sync;
    sync();
    // Markdown renderers may replace heading nodes on appearance changes.
    // Refresh references without resetting the reader's current position.
    const observer = new MutationObserver(scheduleSync);
    observer.observe(pane, { childList: true, subtree: true, characterData: true });
    pane.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      synchronize.current = null;
      observer.disconnect(); pane.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(updateFrame); cancelAnimationFrame(scrollFrame);
    };
  }, [documentKey, prefix]);

  const navigate = (event, id) => {
    event.preventDefault();
    const pane = reader.current;
    // A parent renderer can replace headings between the observer's frame and
    // this click. Resolve the current DOM before using the saved outline IDs.
    synchronize.current?.();
    const target = nodes.current.find(element => element.id === id);
    if (!target || !pane.contains(target)) return;
    pane.scrollTop += target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 20;
    target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true });
    setActiveId(id);
    if (compact) setCollapsed(true);
  };
  const minimumLevel = headings.length ? Math.min(...headings.map(heading => heading.level)) : 1;

  return <div ref={host} className={`report-document-layout${fitViewport ? ' report-document-layout--fill' : ''}`} data-outline-collapsed={collapsed} data-compact={compact}>
    <aside className="report-document-outline" onKeyDown={event => {
      if (event.key === 'Escape' && !collapsed) { event.preventDefault(); event.stopPropagation(); setCollapsed(true); toggle.current?.focus(); }
    }}>
      <div className="report-document-outline-heading">
        {!collapsed && <span>Contents</span>}
        <button ref={toggle} type="button" aria-label={collapsed ? 'Show report contents' : 'Hide report contents'} title={collapsed ? 'Show report contents' : 'Hide report contents'} aria-expanded={!collapsed} aria-controls={outlineId} onClick={() => setCollapsed(value => !value)}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
      <nav id={outlineId} aria-label="Report contents" hidden={collapsed}>
        {headings.map(heading => <a key={heading.id} href={`#${heading.id}`} aria-current={activeId === heading.id ? 'location' : undefined} style={{ paddingInlineStart: 8 + (heading.level - minimumLevel) * 12 }} onClick={event => navigate(event, heading.id)}>{heading.title}</a>)}
        {!headings.length && <p>No sections in this report.</p>}
      </nav>
    </aside>
    <div ref={reader} className="report-document-reader" role="region" aria-label="Report document" tabIndex={0}>{children}</div>
  </div>;
}
