import React, { useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function ArtifactDocumentLayout({ sections, children }) {
  const [collapsed, setCollapsed] = useState(false);
  const outlineId = useId();
  const reader = useRef(null);
  const navigate = (event, id) => {
    event.preventDefault();
    const pane = reader.current;
    const target = [...pane.querySelectorAll('[id]')].find(element => element.id === id);
    if (!target) return;
    // Scroll only the document, without changing the workspace's hash route.
    pane.scrollTop += target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 20;
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };
  return <div className="artifact-document-layout" data-outline-collapsed={collapsed}>
    <aside className="artifact-document-outline">
      <div className="artifact-document-outline-heading">
        {!collapsed && <span>Contents</span>}
        <button type="button" aria-label={collapsed ? 'Show document outline' : 'Hide document outline'} title={collapsed ? 'Show document outline' : 'Hide document outline'} aria-expanded={!collapsed} aria-controls={outlineId} onClick={() => setCollapsed(value => !value)}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
      <nav id={outlineId} aria-label="Document contents" hidden={collapsed}>
        {sections.map((section, index) => <a key={section.id} href={`#${section.id}`} onClick={event => navigate(event, section.id)}>{index + 1}. {section.title}</a>)}
      </nav>
    </aside>
    <div ref={reader} className="artifact-document-reader" role="region" aria-label="Document pages" tabIndex={0}>{children}</div>
  </div>;
}
