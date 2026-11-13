import React, { useMemo, useState } from 'react';
import { architectureEditableSections } from './architectureDescription';
import { artifactObjectText } from './artifactModel';
import { ArchitectureEvidence } from './ArchitectureDiagramView';
import PagedDetails from './PagedDetails';
import ArtifactDocumentLayout from './ArtifactDocumentLayout';
import { Modal } from '../../requirements/components/RequirementsViews';

export default function ArchitectureDocument({ meta, manifest, objects, draft, onOpenDiagram }) {
  const sections = useMemo(() => architectureEditableSections(meta, manifest, objects), [meta, manifest, objects]);
  const [evidence, setEvidence] = useState(null);
  const descriptionIds = new Set(sections.flatMap(section => [section.object.id, ...section.paragraphs.map(paragraph => paragraph.object.id)]));
  const notes = objects.filter(object => !descriptionIds.has(object.id) && !object.deleted && (object.manual || !['section', 'diagram', 'architecture-element'].includes(object.kind)));
  const contents = [...sections.map(section => ({ id: `architecture-description-${section.id}`, title: section.object.title })), ...(notes.length ? [{ id: 'architecture-description-notes', title: 'Document annotations and decisions' }] : []), { id: 'architecture-description-sources', title: 'Source register' }];
  return <ArtifactDocumentLayout sections={contents}><article className="artifact-paper architecture-description">
    <header className="artifact-cover"><p>{draft ? 'PROPOSED ARCHITECTURE DESCRIPTION' : 'ARCHITECTURE DESCRIPTION'}</p><h1>{meta.title}</h1>{meta.description && <p>{meta.description}</p>}<p>{meta.config.system} · Revision {meta.revision || '—'}</p><p>Derived from the saved diagrams at their selected abstraction levels.</p><button type="button" className="text-indigo-700 underline" onClick={() => onOpenDiagram()}>Open Diagram view</button></header>
    {sections.map(section => <section key={section.id} id={`architecture-description-${section.id}`}><h2 data-artifact-object-id={section.object.id} data-object-field="Title" tabIndex={0}>{section.object.title}</h2>{section.object.text && <p className="artifact-body" data-artifact-object-id={section.object.id} data-object-field="Description" tabIndex={0}>{section.object.text}</p>}{section.paragraphs.map((paragraph, index) => <div key={index} className="artifact-object" data-artifact-object-id={paragraph.object.id} tabIndex={0}><p data-object-field="Description" className="artifact-body">{paragraph.object.text}</p>{!!paragraph.references.length && <div className="artifact-citations">Supporting diagram elements: {paragraph.references.map((reference, refIndex) => <button type="button" key={`${reference.sourceId}:${refIndex}`} className="text-indigo-700 underline" onClick={() => { const source = manifest?.entries?.find(entry => entry.id === reference.sourceId); if (source && !source.diagramId && !source.snapshot) setEvidence(source); else onOpenDiagram(reference); }}>{reference.title}</button>)}</div>}</div>)}</section>)}
    {!!notes.length && <section id="architecture-description-notes"><h2>Document annotations and decisions</h2>{notes.map(object => <section key={object.id} data-artifact-object-id={object.id} tabIndex={0}><h3 data-object-field="Title">{object.title}</h3><p data-object-field="Description" className="artifact-body">{artifactObjectText(object)}</p>{(object.sourceEvidence || []).map(source => <button type="button" key={source.id} className="text-indigo-700 underline mr-2" onClick={() => setEvidence(source)}>{source.title || 'Supporting source'}</button>)}</section>)}</section>}
    <section id="architecture-description-sources"><h2>Source register</h2><p>The full saved evidence remains available here, including details beyond this concise description.</p><PagedDetails title={`Supporting sources (${manifest?.entries?.length || 0})`} items={manifest?.entries || []} renderItem={source => <p key={source.id}><button type="button" className="text-indigo-700 underline" onClick={() => setEvidence(source)}>{source.title || 'Supporting source'}</button></p>} /></section>
    {evidence && <Modal title="Supporting source" onClose={() => setEvidence(null)}><ArchitectureEvidence source={evidence} manifest={manifest} objects={objects} /></Modal>}
  </article></ArtifactDocumentLayout>;
}
