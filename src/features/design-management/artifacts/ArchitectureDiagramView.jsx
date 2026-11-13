import { architecturePages, architecturePageForElement } from './architecturePages';
import PagedDetails from './PagedDetails';
import SourceEvidenceDetails, { sourceTitle } from './SourceEvidenceDetails';
import ArrangedArchitectureDiagram from './ArrangedArchitectureDiagram';
import { diagramWithPresentation, presentationKey } from './architecturePresentation';
import NativeArchitectureDiagram from './NativeArchitectureDiagram';
import React, { useMemo, useState, useEffect, useId, useRef } from 'react';
import NativeCodeArchitectureDiagram from './NativeCodeArchitectureDiagram';
import { downloadArchitecture } from './architectureGraph';
import 'reactflow/dist/style.css';
import './architectureDiagram.css';
import { Modal } from '../../requirements/components/RequirementsViews';

export function ArchitectureDiagrams({ artifactId, manifest, initialDiagramId, focusId, objects = [], onExportActionChange }) {
  const arranged = useRef(null);
  const diagrams = useMemo(() => (manifest?.entries || []).filter(source => source.sourceType === 'architecture-diagram' && source.snapshot), [manifest]);
  const [selection, setSelection] = useState(initialDiagramId || diagrams[0]?.id || '');
  const [elementId, setElementId] = useState(focusId || '');
  const [canvasFocus, setCanvasFocus] = useState(focusId || '');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const inspectorId = useId();
  const [openedEvidence, setOpenedEvidence] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [exportError, setExportError] = useState('');
  const diagram = diagrams.find(source => source.id === selection) || diagrams[0];
  const pages = useMemo(() => diagram ? architecturePages(diagram) : [], [diagram]);
  const [pageIndex, setPageIndex] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => { setPageIndex(architecturePageForElement(pages, focusId)); }, [pages, focusId]);
  const currentIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const displayed = pages[currentIndex];
  const elements = useMemo(() => (manifest?.entries || []).filter(source => source.diagramId === diagram?.id && source.sourceType === 'architecture-element'), [manifest, diagram]);
  const visibleIds = useMemo(() => new Set([...(displayed?.snapshot.nodes || []), ...(displayed?.snapshot.edges || [])].flatMap(item => [item.id, displayed?.displayOwners?.[item.id]].filter(Boolean))), [displayed]);
  const matches = useMemo(() => elements.filter(source => query.trim() ? `${source.title} ${source.elementId}`.toLowerCase().includes(query.trim().toLowerCase()) : visibleIds.has(source.elementId)), [elements, query, visibleIds]);
  const chooseElement = id => { setElementId(id); setCanvasFocus(id); if (!visibleIds.has(id)) setPageIndex(architecturePageForElement(pages, id)); };
  useEffect(() => {
    if (!onExportActionChange || !displayed) return undefined;
    onExportActionChange({
      label: exporting ? 'Exporting diagram…' : `Export ${pages.length > 1 ? 'current view' : 'diagram'} (PNG)`,
      disabled: exporting || restoring,
      restore: artifactId ? async () => {
        setRestoring(true); setExportError('');
        try { await arranged.current?.restoreSourceLayout(); }
        catch (error) { setExportError(error.message); }
        finally { setRestoring(false); }
      } : null,
      run: async () => {
        setExporting(true); setExportError('');
        try { await arranged.current?.flush(); await downloadArchitecture(artifactId ? await diagramWithPresentation(artifactId, displayed) : displayed); }
        catch (error) { setExportError(error.message); }
        finally { setExporting(false); }
      },
    });
    return () => onExportActionChange(null);
  }, [onExportActionChange, artifactId, displayed, pages.length, exporting, restoring]);
  if (!diagram) return <p>No saved diagram snapshot is available for this revision.</p>;
  const selected = elements.find(source => source.elementId === elementId);
  return <section className="architecture-diagrams">
    <div className="architecture-diagram-toolbar" title={`${diagram.snapshot.nodes.length} elements · ${diagram.snapshot.edges.length} relationships`}>
      {diagrams.length > 1 ? <select aria-label="Source diagram" value={diagram.id} onChange={event => { setSelection(event.target.value); setElementId(''); setCanvasFocus(''); setQuery(''); setPageIndex(0); }}>{diagrams.map(source => <option key={source.id} value={source.id}>{source.title}{source.level != null ? ` · Level ${source.level}` : ''}</option>)}</select> : <span className="architecture-diagram-source">{diagram.title}{diagram.level != null ? ` · Level ${diagram.level}` : ''}</span>}
      {!onExportActionChange && <button type="button" disabled={exporting} onClick={async () => { setExporting(true); setExportError(''); try { await arranged.current?.flush(); await downloadArchitecture(artifactId ? await diagramWithPresentation(artifactId, displayed) : displayed); } catch (error) { setExportError(error.message); } finally { setExporting(false); } }}>{exporting ? 'Exporting…' : `Export ${pages.length > 1 ? 'current view' : 'diagram'} (PNG)`}</button>}
    </div>
    {exportError && <p role="alert">{exportError}</p>}
    {pages.length > 1 && <div className="artifact-actions" role="group" aria-label="Architecture views"><button type="button" disabled={!currentIndex} onClick={() => { setPageIndex(currentIndex - 1); setElementId(''); setCanvasFocus(''); }}>Previous view</button><span>View {currentIndex + 1} of {pages.length} · {displayed.snapshot.nodes.length} elements · {displayed.snapshot.edges.length} relationships</span><button type="button" disabled={currentIndex === pages.length - 1} onClick={() => { setPageIndex(currentIndex + 1); setElementId(''); setCanvasFocus(''); }}>Next view</button></div>}
    {diagram.workspaceType === 'functional' && !diagram.snapshot.native && <p className="text-sm my-2">This revision predates saved diagram styling. Generate an update to capture the current project layout.</p>}
    {diagram.workspaceType === 'code-architecture' && diagram.snapshot.projectionVersion !== 2 && <p className="text-sm my-2">This snapshot uses the earlier architecture grouping. Generate an update to match the source project’s selected abstraction.</p>}
    {artifactId ? <div className="architecture-canvas" aria-label={`Diagram snapshot: ${displayed.title}`}><ArrangedArchitectureDiagram ref={arranged} key={presentationKey(artifactId, displayed)} artifactId={artifactId} diagram={displayed} focusId={canvasFocus} onSelect={setElementId} /></div> : diagram.workspaceType === 'functional' ? <div className="architecture-canvas" aria-label={`Diagram snapshot: ${diagram.title}`}><NativeArchitectureDiagram key={`${diagram.id}:${diagram.diagramHash}`} diagram={diagram} focusId={canvasFocus} onSelect={setElementId} /></div> : <div className="architecture-canvas" aria-label={`Diagram snapshot: ${displayed.title}`}><NativeCodeArchitectureDiagram key={displayed.id} diagram={displayed} focusId={canvasFocus} onSelect={setElementId} /></div>}
    <div className={`architecture-inspector-tray${inspectorOpen ? ' is-open' : ''}`}>
      <button type="button" className="architecture-inspector-toggle" aria-expanded={inspectorOpen} aria-controls={inspectorOpen ? inspectorId : undefined} onClick={() => setInspectorOpen(open => !open)}>
        <span aria-hidden="true">{inspectorOpen ? '▾' : '▴'}</span>
        <span>{inspectorOpen ? 'Hide element details' : 'Show element details'}</span>
        {selected && <span className="architecture-inspector-selection" title={selected.title}>{selected.title}</span>}
      </button>
      {inspectorOpen && <div id={inspectorId} role="region" aria-label="Element details" className="architecture-inspector"><p className="text-xs text-slate-500">{diagram.snapshot.nodes.length} elements · {diagram.snapshot.edges.length} relationships. Saved from the source project for this revision.</p>{pages.length > 1 && <p className="text-sm">This architecture is shown in smaller views. Search across all views below; document exports include every view.</p>}{(pages.length > 1 || elements.length > 200) && <label className="block">Find an element or relationship<input className="border rounded p-1 ml-2" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search all views" /></label>}{matches.length > 200 && <p>Showing the first 200 matches. Refine your search to find another element.</p>}<label className="block">Inspect element<select className="border rounded p-1 ml-2 max-w-full" value={elementId} onChange={event => chooseElement(event.target.value)}><option value="">Choose an element or relationship</option>{selected && !matches.slice(0, 200).includes(selected) && <option value={selected.elementId}>{selected.elementType}: {selected.title}</option>}{matches.slice(0, 200).map(source => <option key={source.id} value={source.elementId}>{source.elementType}: {source.title}</option>)}</select></label>
    {selected && <div className="rounded border p-3 my-2"><SourceEvidenceDetails source={selected} manifest={manifest} onOpenSource={setOpenedEvidence} />
      <p className="text-sm mt-2">Linked objects in this artifact:</p><ul>{objects.filter(object => !object.deleted && (object.sourceEvidence || []).some(source => source.id === selected.id || (source.architectureEvidence || []).some(e => e.id === selected.id))).map(object => <li key={object.id}>{object.title}</li>)}</ul>
    </div>}</div>}
    </div>
    {openedEvidence && <Modal title="Supporting source" onClose={() => setOpenedEvidence(null)}><ArchitectureEvidence source={openedEvidence} manifest={manifest} objects={objects} /></Modal>}
  </section>;
}
export function ArchitectureEvidence({ source, manifest, objects }) {
  const [open, setOpen] = useState(false);
  const [supporting, setSupporting] = useState(null);
  if (!source) return <p>Source record unavailable.</p>;
  const diagram = source.snapshot ? source : manifest?.entries?.find(entry => entry.id === source.diagramId && entry.diagramHash === source.diagramHash);
  return <>
    {source.diagramId && <><p>{source.diagramTitle}{source.level ? ` · Level ${source.level}` : ''}{source.elementType ? ` · ${source.elementType}` : ''}</p>{diagram?.snapshot ? <button type="button" className="border rounded px-2 py-1 my-2" onClick={() => setOpen(true)}>View source diagram</button> : <p>The saved element details are shown below. The full diagram is not included in this evidence snapshot.</p>}</>}
    <SourceEvidenceDetails source={source} manifest={manifest} onOpenSource={setSupporting} />
    {supporting && <Modal title="Supporting source" onClose={() => setSupporting(null)}><ArchitectureEvidence source={supporting} manifest={manifest} objects={objects} /></Modal>}
    {open && <Modal title="Source diagram and element" onClose={() => setOpen(false)}><ArchitectureDiagrams manifest={{ entries: [diagram, ...(manifest?.entries || []).filter(entry => entry.id !== diagram.id && entry.diagramHash === diagram.diagramHash)] }} initialDiagramId={diagram.id} focusId={source.elementId} objects={objects} /></Modal>}
  </>;
}
export function ArchitectureTrace({ objects, manifest }) {
  const [opened, setOpened] = useState(null);
  const links = useMemo(() => objects.filter(object => !object.deleted).flatMap(object => (object.sourceEvidence || []).flatMap(source => [source, ...(source.architectureEvidence || [])]).filter(source => source.diagramId).map(source => ({ object, source }))), [objects]);
  if (!links.length) return null;
  return <><PagedDetails title={`Diagram and element traceability (${links.length} links)`} items={links} renderItem={({ object, source }, index) => <p data-artifact-object-id={object.id} key={`${object.id}:${source.id}:${index}`}>{object.title} → {source.diagramTitle}: <button className="text-indigo-700 underline" onClick={() => setOpened(source)}>{sourceTitle(source)}</button></p>} />
    {opened && <Modal title="Architecture trace source" onClose={() => setOpened(null)}><ArchitectureEvidence source={opened} manifest={manifest} objects={objects} /></Modal>}
  </>;
}
