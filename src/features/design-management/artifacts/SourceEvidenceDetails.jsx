import { CODE_ABSTRACTIONS } from './codeArchitectureAbstraction';
import React from 'react';
import PagedDetails from './PagedDetails';
import { readableLabel, readableValue } from '../../requirements/components/readableValues';
import { availableProjects, ownerKey } from './artifactSources';

export const sourceTitle = source => source?.title || source?.artifactTitle || source?.diagramTitle || 'Untitled source';
export const relationshipLabel = value => ({ 'derived-from-project': 'Derived from project', 'originates-in-project': 'Belongs to project', 'uses-drafting-input': 'Uses drafting input', 'derived-from-diagram': 'Derived from diagram', 'element-of-diagram': 'Element of diagram', refines: 'Refines' }[value] || readableLabel(value));
export function ownerLabel(owner, manifest) {
  const saved = manifest?.entries?.find(entry => entry.sourceType === 'project' && entry.ownerProjects?.some(item => ownerKey(item) === ownerKey(owner)));
  if (saved?.title) return saved.title;
  try { return availableProjects().find(project => ownerKey(project) === ownerKey(owner))?.name || 'Unavailable source project'; } catch { return 'Unavailable source project'; }
}
export function ReadableText({ value }) {
  const text = readableValue(value);
  return <span className="whitespace-pre-wrap break-words">{text.split(/(https?:\/\/[^\s<>"'\])}]+)/g).map((part, index) => /^https?:\/\//i.test(part) ? <a key={index} href={part.replace(/[.,;]+$/, '')} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">{part}</a> : part)}</span>;
}
function SupportingReference({ reference }) {
  const url = typeof reference === 'string' ? reference : reference?.url || reference?.href;
  if (typeof url === 'string' && /^https?:\/\/\S+$/i.test(url)) return <p><a href={url} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">{reference?.title || reference?.name || url}</a>{reference?.description && <><br /><ReadableText value={reference.description} /></>}</p>;
  return <p><ReadableText value={reference} /></p>;
}
const Field = ({ label, value }) => value !== undefined && value !== null && value !== '' ? <div className="my-1"><dt className="font-medium">{label}</dt><dd><ReadableText value={value} /></dd></div> : null;

export default function SourceEvidenceDetails({ source, manifest, onOpenSource }) {
  if (!source) return <p>The supporting source is no longer available in this saved revision.</p>;
  const entries = manifest?.entries || [];
  const diagram = entries.find(entry => entry.id === source.diagramId && entry.diagramHash === source.diagramHash);
  const element = source.element;
  const module = manifest?.modules?.find(item => item.folderId === source.folderId && item.moduleId === source.moduleId);
  const nodeName = id => diagram?.snapshot?.nodes?.find(node => node.id === id)?.label;
  const type = source.sourceType || (source.rowId ? 'module-object' : 'source-notes');
  const kind = { 'architecture-diagram': 'Saved architecture diagram', 'architecture-element': source.elementType === 'edge' ? 'Diagram relationship' : element?.group ? 'Diagram boundary' : 'Diagram element', 'artifact-object': 'Document object', 'module-object': 'Design module object', project: 'Owning project', 'project-notes': 'Project source notes', 'source-notes': 'Source notes' }[type] || readableLabel(type);
  const references = [...(source.architectureEvidence || []), ...(source.upstreamSourceIds || []).map(id => entries.find(entry => entry.id === id)).filter(Boolean)];
  const linked = [...new Map(references.filter(entry => entry.id !== source.id).map(entry => [entry.id, entry])).values()];
  return <article className="source-evidence-details text-sm space-y-2">
    <h4 className="font-semibold">{sourceTitle(source)}</h4><p>{kind}{source.revision != null ? ` · Revision ${source.revision}` : ''}. This is the supporting information saved with this document.</p>
    {source.text && <p><ReadableText value={source.text} /></p>}
    {source.evidenceIssue && <p className="artifact-warning">{source.evidenceIssue === 'unknown-citation' ? 'A supporting reference could not be matched to the selected sources. This claim needs evidence review.' : source.evidenceIssue === 'missing-citation' ? 'This claim has no supporting citation and needs evidence review.' : source.evidenceIssue === 'unresolved-upstream' ? 'This claim depends on upstream information that still needs evidence review.' : 'This source has unresolved evidence. Review it before relying on its claims.'}</p>}
    <dl><Field label="Source document" value={source.artifactTitle} /><Field label="Source diagram" value={source.diagramTitle} /><Field label="Architecture level" value={source.level === 'other' ? 'Other level' : source.level != null ? `Level ${source.level}` : null} /><Field label="Scope" value={source.focus} /><Field label="Abstraction level" value={CODE_ABSTRACTIONS[source.abstraction]} />
      <Field label="Hazard analysis" value={source.analysisId} /><Field label="Analysis method" value={source.hazardMethod} /><Field label="Analysis revision" value={source.analysisRevision} /><Field label="Repository" value={source.repoId} /><Field label="Analysis row ID" value={source.sourceRowId} />
      <Field label="Design folder" value={module?.folderName} /><Field label="Source module" value={module?.name} /><Field label="Status" value={source.status ? readableLabel(source.status) : null} />
      {(source.ownerProjects || []).map(owner => <Field key={ownerKey(owner)} label={owner.workspaceType === 'code-architecture' ? 'Owning code architecture project' : 'Owning project'} value={ownerLabel(owner, manifest)} />)}
      {element && <><Field label="From" value={nodeName(element.from) || element.row?.fromFunction} /><Field label="To" value={nodeName(element.to) || element.row?.toFunction} /><Field label="Within boundary" value={nodeName(element.parentId)} /><Field label="Boundary type" value={element.groupType ? readableLabel(element.groupType) : null} /><Field label="Source files" value={element.files?.length ? element.files : null} /><Field label="Architecture allocations" value={element.architectures?.length ? element.architectures : null} /></>}
      {source.snapshot && <Field label="Diagram contents" value={`${source.snapshot.nodes.length} elements and ${source.snapshot.edges.length} relationships`} />}
      {Object.entries(source.attributes || {}).map(([key, value]) => <Field key={key} label={readableLabel(key)} value={value} />)}
    </dl>
    {source.content?.type === 'image' && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(source.content.image?.dataUrl || '') && <figure><img className="max-w-full" src={source.content.image.dataUrl} alt={source.content.image.name || sourceTitle(source)} /><figcaption>{source.content.image.name}</figcaption></figure>}
    {source.content?.type === 'table' && <div className="overflow-auto"><table className="border-collapse"><tbody>{(source.content.table?.cells || []).map((row, index) => <tr key={index}>{row.map((cell, col) => <td className="border p-2" key={col}><ReadableText value={cell} /></td>)}</tr>)}</tbody></table></div>}
    {!!element?.members?.length && <PagedDetails title={`Underlying code elements (${element.members.length})`} items={element.members} renderItem={member => <div key={member.id} className="border-b py-2"><strong>{member.label}</strong><p><ReadableText value={member.details} /></p><dl><Field label="Source files" value={member.files} /></dl></div>} />}
    {!!(element?.relationships || element?.internalRelationships)?.length && <PagedDetails title={`Supporting code relationships (${(element.relationships || element.internalRelationships).length})`} items={element.relationships || element.internalRelationships} renderItem={edge => <div key={edge.id} className="border-b py-2"><strong>{edge.row?.fromFunction || edge.from} → {edge.row?.toFunction || edge.to}: {edge.label}</strong><p><ReadableText value={edge.details} /></p><dl><Field label="Source files" value={[edge.row?.fromFile, edge.row?.toFile].filter(Boolean)} /></dl></div>} />}
    {!!element?.row?.functionalModel?.sourceTraceIds?.length && <dl><Field label="Supporting implementation relationships" value={element.row.functionalModel.sourceTraceIds} /></dl>}
    {!!source.sourceRefs?.length && <section><h5 className="font-medium">Supporting references</h5>{source.sourceRefs.map((reference, index) => <SupportingReference key={index} reference={reference} />)}</section>}
    {!!linked.length && <section><h5 className="font-medium">Supporting sources</h5><ul>{linked.map(entry => <li key={entry.id}><button type="button" className="text-indigo-700 underline text-left" onClick={() => onOpenSource?.(entry)}>{sourceTitle(entry)}</button></li>)}</ul></section>}
    {(source.links || []).map((link, index) => { const matches = entries.filter(entry => entry.id === link.toId || entry.rowId === link.toId); const target = matches.length === 1 ? matches[0] : null; return <p key={index}>{relationshipLabel(link.type)}: {target ? <button className="text-indigo-700 underline" onClick={() => onOpenSource?.(target)}>{sourceTitle(target)}</button> : 'The linked object is not included in this saved evidence.'}</p>; })}
  </article>;
}
