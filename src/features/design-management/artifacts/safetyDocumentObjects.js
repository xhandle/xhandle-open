import { semanticHash } from './artifactModel';
import { projectHazardTrackingFields } from './hazardTrackingFields';

// Only the HTL projects raw assessments; Safety Requirements synthesizes its consolidated records.
export function safetyDocumentObjects(meta, section, manifest) {
  if (meta.templateId !== 'hazard-tracking-list') throw new Error('Safety Requirements must be generated from consolidated HTR sources.');
  return hazardTrackingObjects(meta, section, manifest);
}

function hazardTrackingObjects(meta, section, manifest) {
  const sources = manifest.entries.filter(source => source.sourceType === 'hazard-analysis-row');
  const parentId = `${meta.id}:${section.id}`;
  const objects = [{ id: parentId, sectionId: section.id, parentId: null, title: section.title, text: '', kind: 'section', sourceIds: [], manual: false }];
  const add = (source, suffix, title, text, attributes, row = false) => objects.push({
    id: `${meta.id}:${section.id}:${semanticHash(source.id).slice(0, 24)}:${suffix}`, sectionId: section.id, parentId, title: title.slice(0, 300), text, kind: 'narrative', manual: false,
    sourceIds: [source.id], evidenceHash: manifest.hash, sourceEvidence: [source], ...(row ? { hazardTrackingRow: true, attributes } : {}),
  });
  if (section.id === 's2') {
    for (const source of sources) {
      const attributes = projectHazardTrackingFields(source.attributes);
      add(source, 'assessment', attributes.Function || attributes.Hazard || `Assessment ${source.sourceRowId}`, '', attributes, true);
    }
    return objects;
  }
  return objects;
}
