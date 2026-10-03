import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Minus, Plus, Pencil, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadAttachmentPreview } from '../lib/collaboratorAttachmentPreviews';

function PreviewImage({ source, name, zoom }) {
  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const [fitWidth, setFitWidth] = useState(null);
  function measure() {
    const container = containerRef.current;
    const img = imageRef.current;
    if (!container || !img?.naturalWidth) return;
    const scale = Math.min(1, container.clientWidth / img.naturalWidth, container.clientHeight / img.naturalHeight);
    setFitWidth(img.naturalWidth * scale);
  }
  useEffect(() => {
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (containerRef.current) observer?.observe(containerRef.current);
    return () => observer?.disconnect();
  }, []);
  return <div ref={containerRef} className="h-full w-full overflow-auto">
    <div className="flex min-h-full min-w-full items-center justify-center" style={{ width: fitWidth ? fitWidth * zoom / 100 : '100%' }}>
      <img ref={imageRef} src={source} alt={name} onLoad={measure} className="block shrink-0 rounded-lg"
        style={{ width: fitWidth ? fitWidth * zoom / 100 : 'auto', maxWidth: fitWidth ? 'none' : '100%', height: 'auto' }} />
    </div>
  </div>;
}

export default function AttachmentPreview({ attachment, onClose, onEdit }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(100);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    (attachment.preview ? Promise.resolve(attachment.preview) : loadAttachmentPreview(attachment)).then(value => {
      if (!cancelled) { setPreview(value); setLoading(false); }
    }, () => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; document.body.style.overflow = overflow; previousFocus?.focus?.(); };
  }, [attachment]);

  function download() {
    if (!preview || preview.downloadable === false) return;
    const url = preview.imageDataUrl || URL.createObjectURL(new Blob([preview.text], { type: preview.type || 'text/plain' }));
    const link = document.createElement('a');
    link.href = url; link.download = preview.name || 'attachment'; link.click();
    if (!preview.imageDataUrl) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function onKeyDown(event) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'Tab') {
      const buttons = [...dialogRef.current.querySelectorAll('button:not(:disabled), a[href]')];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  return createPortal(
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Attachment preview: ${attachment.name}`}
      className="fixed inset-0 z-[1500] flex flex-col bg-black/90 text-white" onKeyDown={onKeyDown}>
      <div className="flex shrink-0 items-center justify-between gap-4 p-4">
        <span className="truncate text-sm">{attachment.name}</span>
        <div className="flex gap-3">
          {onEdit && <button type="button" aria-label="Edit attachment" title="Edit attachment" onClick={onEdit}
            className="rounded-full bg-white p-3 text-neutral-800"><Pencil size={20} /></button>}
          <button type="button" aria-label="Download attachment" title="Download attachment" disabled={!preview || preview.downloadable === false}
            className="rounded-full bg-white p-3 text-neutral-800 disabled:opacity-40" onClick={download}><Download size={20} /></button>
          <button ref={closeRef} type="button" aria-label="Close attachment preview" title="Close" onClick={onClose}
            className="rounded-full bg-white p-3 text-neutral-800"><X size={20} /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-6" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
        {loading ? <p role="status" className="text-center">Loading preview…</p> : !preview ?
          <p role="status" className="text-center">Preview unavailable. This attachment may predate saved previews or its stored content may have been removed.</p> :
          preview.imageDataUrl ? (
            <PreviewImage source={preview.imageDataUrl} name={preview.name} zoom={zoom} />
          ) : (
            <article className="mx-auto max-w-6xl overflow-auto rounded-xl bg-white p-6 text-neutral-900 shadow-xl">
              {/markdown|\.md$/i.test(`${preview.type} ${preview.name}`) ?
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                  table: ({ children }) => <table className="w-full border-collapse text-left text-sm">{children}</table>,
                  th: ({ children }) => <th className="border bg-neutral-100 p-2">{children}</th>,
                  td: ({ children }) => <td className="border p-2 align-top">{children}</td>,
                }}>{preview.text}</ReactMarkdown> : <pre className="whitespace-pre-wrap break-words text-sm font-mono">{preview.text}</pre>}
            </article>
          )}
      </div>
      {preview?.imageDataUrl && <div className="flex shrink-0 justify-center p-4">
        <div className="flex items-center gap-3 rounded-full bg-white p-1 text-neutral-800">
          <button aria-label="Zoom out" disabled={zoom <= 25} className="rounded-full bg-neutral-100 p-3 disabled:opacity-40" onClick={() => setZoom(value => Math.max(25, value - 25))}><Minus size={20} /></button>
          <button aria-label="Reset zoom" className="min-w-16" onClick={() => setZoom(100)}>{zoom}%</button>
          <button aria-label="Zoom in" disabled={zoom >= 300} className="rounded-full bg-neutral-100 p-3 disabled:opacity-40" onClick={() => setZoom(value => Math.min(300, value + 25))}><Plus size={20} /></button>
        </div>
      </div>}
    </div>, document.body,
  );
}
