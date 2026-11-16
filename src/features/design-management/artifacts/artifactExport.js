import { diagramWithPresentation, listArchitecturePresentations } from './architecturePresentation';
import { architectureDescriptionObjects } from './architectureDescription';
import { architecturePages } from './architecturePages';
import { readableValue } from '../../requirements/components/readableValues';
import { architectureImage, architectureSVG } from './architectureGraph';
import { artifactObjectText } from './artifactModel';
import { hazardTrackingMarkdown, hazardTrackingCSV, hazardTrackingWord, hazardTrackingPDF } from './hazardTrackingExport';

export function orderedObjects(objects) {
  const children = new Map();
  objects.forEach((object, index) => {
    if (object.deleted) return;
    const key = object.parentId || null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push({ object, index });
  });
  const output = [], visited = new Set(), pending = [];
  const addChildren = parent => {
    const siblings = (children.get(parent) || []).sort((a, b) => (a.object.order ?? a.index) - (b.object.order ?? b.index));
    for (let index = siblings.length - 1; index >= 0; index--) pending.push(siblings[index].object);
  };
  addChildren(null);
  while (pending.length) {
    const object = pending.pop();
    if (visited.has(object.id)) continue;
    visited.add(object.id); output.push(object); addChildren(object.id);
  }
  return output;
}
export function portableArtifact(meta, revision, baselines = [], revisions = [revision]) {
  return { format: 'xhandle-design-artifact', schemaVersion: 1, metadata: meta, revision, revisions, baselines };
}
const supportingNames = (object, revision) => (object.sourceIds || []).map(id => (object.sourceEvidence || []).find(source => source.id === id)?.title || revision.sources.entries.find(source => source.id === id)?.title || 'Unavailable supporting source').join('; ');
const sourceDescription = source => [source.text, source.artifactTitle && `Source document: ${source.artifactTitle}`, source.revision && `Revision ${source.revision}`, source.diagramTitle && `Diagram: ${source.diagramTitle}`, ...Object.entries(source.attributes || {}).map(([key, value]) => `${key}: ${readableValue(value)}`)].filter(Boolean).join(' — ');
const safetyLabel = object => object.attributes?.['Safety Significant'] === 'Yes' ? 'Safety significant' : object.attributes?.['Safety Significant'] === 'Needs review' ? 'Safety significance needs review' : '';
function documentObjects(meta, revision) {
  if (meta.templateId !== 'architecture') return orderedObjects(revision.objects);
  const description = architectureDescriptionObjects(meta, revision.sources, revision.objects);
  const descriptionIds = new Set(description.map(object => object.id));
  return [...description, ...orderedObjects(revision.objects).filter(object => !descriptionIds.has(object.id) && (object.manual || !['section', 'diagram', 'architecture-element'].includes(object.kind)))];
}
export function artifactMarkdown(meta, revision, diagramImages = {}) {
  if (meta.templateId === 'hazard-tracking-list') return hazardTrackingMarkdown(meta, revision);
  const diagrams = meta.templateId === 'architecture' ? revision.sources.entries.filter(e => e.sourceType === 'architecture-diagram').flatMap(architecturePages) : [];
  return [`# ${meta.title}`, ...(meta.description ? [meta.description] : []), `Revision ${revision.number} · Working engineering document`, ...diagrams.map(diagram => { const image = diagramImages[diagram.id] || (diagram.workspaceType !== 'functional' ? `data:image/svg+xml,${encodeURIComponent(architectureSVG(diagram))}` : null); return image ? `![${diagram.title.replace(/[[\]]/g, '')}](${image})` : `Diagram: ${diagram.title} (saved diagram included in the portable JSON snapshot)`; }), ...documentObjects(meta, revision).flatMap(o => [...(o.title ? [`${o.kind === 'section' ? '##' : '###'} ${o.title}`] : []), artifactObjectText(o), ...(safetyLabel(o) ? [safetyLabel(o)] : []), o.sourceIds.length ? `Sources: ${supportingNames(o, revision)}${o.manual ? ' (evidence retained with manual object; see portable JSON for the exact snapshot)' : ''}` : '']), '## Source register', ...revision.sources.entries.map(e => `- ${e.title || 'Untitled source'}${sourceDescription(e) ? ` — ${sourceDescription(e)}` : ''}`)].join('\n\n');
}
export async function exportArtifact(format, meta, revision, baselines = [], revisions = [revision]) {
  if (!revision) throw new Error('Accept a proposal before exporting.');
  const name = meta.title.replace(/[^a-z0-9_-]+/gi, '-');
  let blob;
  const tracking = meta.templateId === 'hazard-tracking-list';
  if (tracking && format === 'csv') blob = new Blob([hazardTrackingCSV(revision.objects)], { type: 'text/csv;charset=utf-8' });
  if (tracking && format === 'docx') blob = await hazardTrackingWord(meta, revision);
  if (tracking && format === 'pdf') blob = await hazardTrackingPDF(meta, revision);
  if (format === 'json') blob = new Blob([JSON.stringify({ ...portableArtifact(meta, revision, baselines, revisions), presentations: await listArchitecturePresentations(meta.id) }, null, 2)], { type: 'application/json' });
  if (format === 'md') {
    const images = {};
    if (meta.templateId === 'architecture') for (const diagram of revision.sources.entries.filter(e => e.sourceType === 'architecture-diagram').flatMap(architecturePages)) {
      images[diagram.id] = (await architectureImage(await diagramWithPresentation(meta.id, diagram))).data;
    }
    blob = new Blob([artifactMarkdown(meta, revision, images)], { type: 'text/markdown' });
  }
  if (!tracking && format === 'docx') {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } = await import('docx');
    const paragraphs = [new Paragraph({ text: meta.title, heading: HeadingLevel.TITLE }), new Paragraph(`Revision ${revision.number} · Working engineering document · ${meta.config.system}`)];
    if (meta.description) paragraphs.push(new Paragraph(meta.description));
    if (meta.templateId === 'architecture') for (const diagram of revision.sources.entries.filter(e => e.sourceType === 'architecture-diagram').flatMap(architecturePages)) {
      const image = await architectureImage(await diagramWithPresentation(meta.id, diagram)), scale = Math.min(560 / image.width, 620 / image.height);
      paragraphs.push(new Paragraph({ text: diagram.title, heading: HeadingLevel.HEADING_1 }), new Paragraph({ children: [new ImageRun({ data: image.data, transformation: { width: image.width * scale, height: image.height * scale }, type: 'png' })] }));
    }
    for (const o of documentObjects(meta, revision)) {
      if (o.title) paragraphs.push(new Paragraph({ text: o.title, heading: o.kind === 'section' ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2 }));
      artifactObjectText(o).split('\n').forEach(text => paragraphs.push(new Paragraph(text)));
      if (safetyLabel(o)) paragraphs.push(new Paragraph(safetyLabel(o)));
      if (o.sourceIds.length) paragraphs.push(new Paragraph({ children: [new TextRun({ text: `Sources: ${supportingNames(o, revision)}${o.manual ? ' — evidence retained with manual object' : ''}`, italics: true, size: 18 })] }));
    }
    paragraphs.push(new Paragraph({ text: 'Source register', heading: HeadingLevel.HEADING_1 }));
    revision.sources.entries.forEach(e => paragraphs.push(new Paragraph(`${e.title || 'Untitled source'}${sourceDescription(e) ? ` — ${sourceDescription(e)}` : ''}`)));
    blob = await Packer.toBlob(new Document({ sections: [{ children: paragraphs }] }));
  }
  if (!tracking && format === 'pdf') {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF(); let y = 25;
    const line = (text, size = 10) => {
      pdf.setFontSize(size);
      for (const part of pdf.splitTextToSize(text || ' ', 170)) {
        if (y > 275) { pdf.addPage(); y = 24; }
        pdf.text(part, 20, y); y += size * 0.45;
      }
      y += 4;
    };
    line(meta.title, 22); if (meta.description) line(meta.description); line(`Revision ${revision.number} | Working engineering document | ${meta.config.system}`);
    if (meta.templateId === 'architecture') for (const diagram of revision.sources.entries.filter(e => e.sourceType === 'architecture-diagram').flatMap(architecturePages)) {
      const image = await architectureImage(await diagramWithPresentation(meta.id, diagram)), scale = Math.min(170 / image.width, 210 / image.height);
      pdf.addPage(); y = 24; line(diagram.title, 14); pdf.addImage(image.data, 'PNG', 20, y, image.width * scale, image.height * scale); pdf.addPage(); y = 24;
    }
    documentObjects(meta, revision).forEach(o => { if (o.title) line(o.title, o.kind === 'section' ? 16 : 12); if (o.text || o.evidenceIssue || o.hazardTrackingRow) line(artifactObjectText(o)); if (safetyLabel(o)) line(safetyLabel(o), 8); if (o.sourceIds.length) line(`Sources: ${supportingNames(o, revision)}${o.manual ? ' — evidence retained with manual object' : ''}`, 8); });
    line('Source register', 16); revision.sources.entries.forEach(e => line(`${e.title || 'Untitled source'}${sourceDescription(e) ? ` — ${sourceDescription(e)}` : ''}`, 8));
    for (let i = 1; i <= pdf.getNumberOfPages(); i++) { pdf.setPage(i); pdf.setFontSize(8); pdf.text(`${i} / ${pdf.getNumberOfPages()}`, 180, 290); }
    blob = pdf.output('blob');
  }
  if (!blob) throw new Error('Unknown export format.');
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${name}-r${revision.number}.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
