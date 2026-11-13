import { organizeAtomicSafetyRequirements } from './atomicSafetyRequirements';

const present = value => typeof value === 'string' && value.trim() && !/^(?:n\/?a|none|not applicable|not specified|unknown|tbd|needs? review|—|-)[.!]?$/i.test(value.trim());
export const recordedValues = (source, field) => (Array.isArray(source.attributes?.[field]) ? source.attributes[field] : [source.attributes?.[field]]).filter(present);

function verificationDetails(evidence) {
  const methods = [...new Set(evidence.flatMap(source => recordedValues(source, 'Verification')))];
  const length = methods.reduce((total, method) => total + method.length, Math.max(0, methods.length - 1));
  return { methods, value: !methods.length ? 'Unresolved — no recorded verification method' : length <= 2000 ? methods.join('\n') : `${methods.length} recorded verification methods — see linked HTR evidence.`, sourceIds: evidence.filter(source => recordedValues(source, 'Verification').length).map(source => source.id) };
}
function matchesRecordedMethods(value, methods) {
  let offset = 0;
  for (let index = 0; index < methods.length; index++) {
    if (index) { if (value[offset] !== '\n') return false; offset++; }
    if (!value.startsWith(methods[index], offset)) return false;
    offset += methods[index].length;
  }
  return offset === value.length;
}

// Older generated drafts copied every linked method into each requirement.
// Replace only that exact derived copy; user edits and source snapshots survive.
export function compactSafetyRequirementMetadata(objects, manifest) {
  const sources = new Map((manifest?.entries || []).map(source => [source.id, source]));
  return objects.map(object => {
    if (object.manual || (object.kind !== 'requirement' && object.proposedKind !== 'requirement') || typeof object.attributes?.Verification !== 'string') return object;
    const evidence = (object.sourceEvidence?.length ? object.sourceEvidence : object.sourceIds?.map(id => sources.get(id)) || []).filter(source => source?.sourceType === 'hazard-tracking-record');
    if (!evidence.length) return object;
    const details = verificationDetails(evidence);
    if (!Array.isArray(object.verificationSourceIds) && !matchesRecordedMethods(object.attributes.Verification, details.methods)) return object;
    if (object.attributes.Verification === details.value && JSON.stringify(object.verificationSourceIds) === JSON.stringify(details.sourceIds)) return object;
    return { ...object, attributes: { ...object.attributes, Verification: details.value }, verificationSourceIds: details.sourceIds };
  });
}

export function prepareSafetyRequirements(objects) {
  const seen = new Map();
  for (const object of organizeAtomicSafetyRequirements(objects)) {
    if (object.kind === 'section') { seen.set(object.id, object); continue; }
    const evidence = (object.sourceEvidence || []).filter(source => source.sourceType === 'hazard-tracking-record');
    const verification = object.kind === 'requirement' ? verificationDetails(evidence) : null;
    const unsupported = object.kind === 'requirement' && !evidence.some(source => recordedValues(source, 'Safety Constraint').length);
    const next = { ...object, ...(unsupported ? { kind: 'gap', proposedKind: 'requirement', evidenceIssue: 'missing-safety-constraint',
      text: `Unresolved: the cited HTRs contain no recorded safety constraint supporting a requirement. Define the protective action and acceptance criteria before adopting this proposal.\n\nProposed wording for review:\n${object.text}` } : {}),
      attributes: { ...object.attributes, HTR: [...new Set(evidence.map(source => source.recordId))].join(', '),
        'Source Hazard Tracking List': [...new Set(evidence.map(source => source.artifactTitle))].join(', '),
        ...(verification ? { Verification: verification.value } : {}),
      },
      ...(verification ? { verificationSourceIds: verification.sourceIds } : {}),
    };
    const key = `${next.parentId || ''}:${next.kind}:${next.text.trim().replace(/\s+/g, ' ')}`;
    const previous = seen.get(key);
    if (!previous) { seen.set(key, next); continue; }
    previous.sourceIds = [...new Set([...previous.sourceIds, ...next.sourceIds])];
    previous.sourceEvidence = [...new Map([...previous.sourceEvidence, ...next.sourceEvidence].map(source => [source.id, source])).values()];
    previous.attributes.HTR = [...new Set(previous.sourceEvidence.map(source => source.recordId).filter(Boolean))].join(', ');
    previous.attributes['Source Hazard Tracking List'] = [...new Set(previous.sourceEvidence.map(source => source.artifactTitle).filter(Boolean))].join(', ');
    if (next.kind === 'requirement') {
      const verification = verificationDetails(previous.sourceEvidence);
      previous.attributes.Verification = verification.value;
      previous.verificationSourceIds = verification.sourceIds;
    }
  }
  return [...seen.values()];
}

export function safetyRequirementCoverage(meta, sources, sections) {
  const records = sources.entries.filter(source => source.sourceType === 'hazard-tracking-record');
  const requirements = Object.values(sections).flat().filter(object => object.kind === 'requirement');
  const covered = new Set(requirements.flatMap(object => object.sourceIds));
  const gaps = [
    ['constraint', 'Safety constraint missing', records.filter(source => !recordedValues(source, 'Safety Constraint').length), 'Define the protective action and testable acceptance criteria for these consolidated safety issues. No requirement has been inferred from the issue title alone.'],
    ['coverage', 'Safety requirement coverage needs review', records.filter(source => recordedValues(source, 'Safety Constraint').length && !covered.has(source.id)), 'These HTRs have recorded constraints but no linked safety requirement in this proposal. Review their coverage before accepting the document.'],
    ['verification', 'Verification method missing', records.filter(source => !recordedValues(source, 'Verification').length), 'Define verification methods and acceptance criteria for these HTRs. Verification completion cannot be inferred.'],
  ];
  return gaps.flatMap(([key, title, evidence, text]) => {
    const objects = [];
    for (let index = 0; index < evidence.length; index += 100) {
      const sourceEvidence = evidence.slice(index, index + 100), htrs = sourceEvidence.map(source => source.recordId).join(', ');
      objects.push({ id: `${meta.id}:s6:coverage-${key}-${index}`, key: `coverage-${key}-${index}`, sectionId: 's6', parentId: `${meta.id}:s6`,
        title, text: `${text}\n\nHTRs: ${htrs}.`, kind: 'gap', sourceIds: sourceEvidence.map(source => source.id), sourceEvidence,
        evidenceHash: sources.hash, manual: false, attributes: { HTR: htrs } });
    }
    return objects;
  });
}
