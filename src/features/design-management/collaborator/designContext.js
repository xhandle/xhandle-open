import { readArtifactStorage } from '../artifacts/artifactRepository';
import { loadFolders, loadRequirements } from '../../requirements/actions/requirementsState';
import { listSysMLV2Models, loadSysMLV2Model } from '../SysMLV2Modeler/sysmlV2Store';
import { consolidateHazardRows } from '../artifacts/consolidateHazardRows';
import { artifactWorkflow } from './designWorkflow';

export const DESIGN_PROVIDER = 'design-management';
export const DESIGN_SURFACE = 'design-management-surface';
export const DESIGN_DIAGRAM = 'design-management-diagram';
export const DESIGN_REVEAL = 'xhandle:design-collaborator-reveal';
export const designReference = (target, objectId = '') => `#xhandle-design=${encodeURIComponent(JSON.stringify({ kind: target.kind, id: target.id,
  ...(target.folderId ? { folderId: target.folderId } : {}), ...(target.draft !== undefined ? { draft: !!target.draft } : {}), objectId }))}`;
export const targetKey = target => JSON.stringify([target?.kind, target?.id, target?.folderId || '', !!target?.draft]);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
export function compactDesignValue(value, budget = 1800) {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value.length > budget ? { excerpt: value.slice(0, budget), truncated: true } : value;
  let remaining = budget, entries = 150, truncated = false;
  const copy = (item, depth = 0) => {
    if (remaining <= 0 || entries-- <= 0 || depth > 5) { truncated = true; return undefined; }
    if (typeof item === 'string') { const out = item.slice(0, remaining); remaining -= out.length; if (out.length < item.length) truncated = true; return out; }
    if (item == null || typeof item === 'boolean' || typeof item === 'number') return item;
    if (typeof item !== 'object') return undefined;
    const out = Array.isArray(item) ? [] : {};
    const keys = Object.keys(item); if (keys.length > 24) truncated = true;
    for (const key of keys.slice(0, 24)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      remaining -= key.length;
      const next = copy(item[key], depth + 1); if (next !== undefined) out[key] = next;
    }
    return out;
  };
  const result = copy(value);
  return truncated ? { value: result, truncated: true } : result;
}
// These are saved workflow flags, not a new engineering assessment. Keep
// unresolved evidence/wording separate from ordinary approval status.
export function designReviewState(row, { artifact = false } = {}) {
  const status = String(row.status || row.attributes?.Status || (artifact ? 'Proposed' : '')).slice(0, 100);
  const writingIssues = (Array.isArray(row.requirementWritingIssues) ? row.requirementWritingIssues : []).filter(value => typeof value === 'string' && value.trim());
  const reasons = [...writingIssues];
  const evidenceReasons = {
    'requirement-writing': 'Requirement wording needs review.',
    'missing-citation': 'A supporting source citation is missing.',
    'unknown-citation': 'A supporting reference could not be matched to the selected sources.',
    'unresolved-upstream': 'Supporting upstream content still requires evidence.',
  };
  if (row.evidenceIssue && !(row.evidenceIssue === 'requirement-writing' && writingIssues.length)) reasons.push(has(evidenceReasons, row.evidenceIssue) ? evidenceReasons[row.evidenceIssue] : `Unresolved evidence: ${row.evidenceIssue}.`);
  if (row.kind === 'gap' && !reasons.length) reasons.push('An unresolved gap is recorded.');
  const flagged = reasons.length > 0;
  const awaitingApproval = !row.heading && row.kind !== 'section' && /^proposed$/i.test(status);
  if (awaitingApproval) reasons.push('Proposed; awaiting approval.');
  return { status, needsReview: flagged || awaitingApproval, flagged, awaitingApproval,
    reasons: reasons.slice(0, 12).map(reason => reason.slice(0, 500)), reasonsTruncated: reasons.length > 12 || reasons.some(reason => reason.length > 500) };
}

export function compactDesignObject(row, target) {
  const attrs = row.attributes || {};
  return { id: row.id, title: row.title || row.name || row.label || '', kind: row.kind || row.type || (row.heading ? 'section' : 'requirement'),
    parentId: row.parentId || row.ownerId || null, text: compactDesignValue(row.text ?? row.description ?? attrs.Description ?? '', 3500),
    review: compactDesignValue(designReviewState(row, { artifact: target.kind === 'artifact' }), 2000),
    ...(row.evidenceIssue ? { evidenceIssue: row.evidenceIssue } : {}),
    ...(row.proposedKind ? { proposedKind: row.proposedKind } : {}),
    attributes: Object.fromEntries(Object.entries(attrs).filter(([, value]) => typeof value !== 'object').slice(0, 24).map(([key, value]) => [key, compactDesignValue(value, 600)])),
    ...(row.content?.type === 'table' ? { table: compactDesignValue(row.content.table?.cells, 5000), tableRowCount: row.content.table?.cells?.length || 0 } : {}),
    ...(row.data ? { diagramData: compactDesignValue(row.data, 1800) } : {}),
    ...(row.sourceId ? { sourceId: row.sourceId } : {}),
    ...(row.sourceIds ? { sourceIds: row.sourceIds.slice(0, 16), sourceCount: row.sourceIds.length } : {}),
    ...(row.links ? { links: compactDesignValue(row.links, 1800) } : {}),
    ...(row.sourceId && row.targetId ? { sourceId: row.sourceId, targetId: row.targetId, type: row.type, label: row.label, description: compactDesignValue(row.description || '') } : {}),
    ...(row.hazardTrackingRow ? { assessmentCount: row.hazardAssessments?.length || row.assessments?.length || 0, originalAssessmentsReadOnly: true } : {}),
    reference: designReference(target, row.id) };
}

// Read only the requested document. No source capture, migration or generation
// side effects are allowed on this conversational read path.
export async function readDesignTarget(target) {
  if (!target || typeof target.id !== 'string' || !target.id) throw Error('Choose a saved Design Management document or model.');
  if (target.kind === 'artifact') return readArtifactStorage(async db => {
    const tx = db.transaction(['metadata', 'jobs', 'revisions']);
    const meta = await tx.objectStore('metadata').get(target.id);
    if (!meta || meta.deleted || !meta.templateId) throw Error('The design document no longer exists.');
    const job = await tx.objectStore('jobs').get(target.id);
    const revision = meta.revision ? await tx.objectStore('revisions').get(`${meta.id}:${meta.revision}`) : null;
    const program = meta.programId ? await tx.objectStore('metadata').get(meta.programId) : null;
    await tx.done;
    if (target.draft && !job) throw Error('This saved draft is no longer available.');
    const record = target.draft ? job : revision;
    const objects = target.draft ? Object.values(job.sections || {}).flat() : revision?.objects || [];
    return { target: { kind: 'artifact', id: meta.id, draft: !!target.draft }, title: meta.title, meta, job, revision, program,
      version: target.draft ? `draft:${job.token}:${job.version}:${meta.revision}` : `revision:${meta.revision}`,
      objects: objects.filter(row => !row.deleted), sources: record?.sources?.entries || [],
      readOnly: meta.templateId === 'traceability-matrix' || !record || job?.state === 'generating' || program?.state === 'generating' };
  });
  if (target.kind === 'module') {
    const folder = loadFolders().find(row => row.id === target.folderId);
    const module = folder?.modules?.find(row => row.id === target.id);
    if (!module) throw Error('The design module no longer exists.');
    const objects = loadRequirements().filter(row => (row.folderId ?? row.projectId) === folder.id && (row.moduleId === module.id || (!row.moduleId && row.module === module.name)));
    return { target: { kind: 'module', id: module.id, folderId: folder.id }, title: module.name, objects, sources: [], folder, module };
  }
  if (target.kind === 'sysml') {
    // loadSysMLV2Model deliberately falls back to the active model. Never let
    // that convenience retarget an exact conversational reference.
    const model = loadSysMLV2Model(target.id, null);
    if (!model || model.id !== target.id) throw Error('The selected SysML model no longer exists.');
    return { target: { kind: 'sysml', id: model.id }, title: model.name, objects: [...model.elements, ...model.relationships], sources: [], model };
  }
  throw Error('This Design Management target is read-only catalog information. Open a document or model to edit it.');
}

export async function designCatalog(request = {}) {
  const folders = loadFolders();
  const artifacts = await readArtifactStorage(async db => (await db.getAll('metadata')).filter(row => !row.deleted));
  let rows = [
    ...folders.map(folder => ({ kind: 'folder', id: folder.id, title: folder.name, parentId: folder.parentId || null, description: folder.description || '' })),
    ...folders.flatMap(folder => (folder.modules || []).map(module => ({ kind: 'module', id: module.id, folderId: folder.id, title: module.name, description: module.description || '' }))),
    ...artifacts.map(meta => ({ kind: meta.templateId ? 'artifact' : 'project', id: meta.id, folderId: meta.folderId, projectId: meta.programId, title: meta.title, templateId: meta.templateId, revision: meta.revision, description: meta.description || '' })),
    ...listSysMLV2Models(null).map(model => ({ kind: 'sysml', ...model, title: model.name })),
  ];
  if (request.folderId) rows = rows.filter(row => row.folderId === request.folderId || row.parentId === request.folderId);
  if (request.projectId) rows = rows.filter(row => row.projectId === request.projectId || row.id === request.projectId);
  if (request.query) rows = rows.filter(row => `${row.title} ${row.description} ${row.templateId || ''}`.toLowerCase().includes(String(request.query).toLowerCase()));
  return page(rows.map(row => ({ ...row, description: compactDesignValue(row.description || '', 500), reference: designReference(row) })), request);
}
export function page(rows, { offset = 0, limit = 12 } = {}, project = row => row) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 24) throw Error('Use a nonnegative offset and a page limit from 1 to 24.');
  const items = [];
  let bytes = 0;
  for (const item of rows.slice(offset, offset + limit)) {
    const row = project(item);
    const size = JSON.stringify(row).length;
    if (items.length && bytes + size > 24000) break;
    items.push(row); bytes += size;
  }
  return { total: rows.length, offset, items, nextOffset: offset + items.length < rows.length ? offset + items.length : null, truncated: offset > 0 || items.length < rows.length };
}
export async function readDesignEvidence(request = {}, currentTarget) {
  if (request.operation === 'catalog') return { operation: 'catalog', ...await designCatalog(request) };
  if (!['objects', 'review', 'sources', 'diagram', 'table'].includes(request.operation)) throw Error('Supported design reads are catalog, objects, review, sources, diagram and table.');
  if (request.ids && (!Array.isArray(request.ids) || request.ids.length > 24 || request.ids.some(id => typeof id !== 'string'))) throw Error('Read at most 24 exact object IDs at a time.');
  const data = await readDesignTarget(request.target || currentTarget);
  // A version covers canonical content, not a bounded/truncated projection.
  const { semanticHash } = await import('../artifacts/artifactModel');
  const version = data.version || semanticHash(data.model || data.objects);
  if (request.operation === 'table') {
    const object = data.objects.find(row => row.id === request.objectId), cells = object?.content?.table?.cells;
    if (object?.content?.type !== 'table' || !Array.isArray(cells)) throw Error('Choose an exact embedded-table object from the document.');
    const columnOffset = request.columnOffset || 0, columnLimit = request.columnLimit || 12;
    if (!Number.isInteger(columnOffset) || columnOffset < 0 || !Number.isInteger(columnLimit) || columnLimit < 1 || columnLimit > 24) throw Error('Use a nonnegative column offset and up to 24 columns.');
    const { offset } = page([], request);
    // Page first, then attach absolute row/column coordinates. Never ship an
    // entire large cell matrix merely to answer a question about one cell.
    const projected = page(cells.slice(request.offset || 0, (request.offset || 0) + (request.limit || 12)).map((line, index) => ({ id: object.id, tableRowIndex: (request.offset || 0) + index,
      columnCount: line.length, cells: line.slice(columnOffset, columnOffset + columnLimit).map((text, i) => ({ column: columnOffset + i, text: compactDesignValue(text, 800) })) })), { limit: request.limit || 12 });
    return { operation: 'table', target: data.target, title: data.title, version, total: cells.length, offset,
      items: projected.items, nextOffset: offset + projected.items.length < cells.length ? offset + projected.items.length : null,
      truncated: projected.items.length < cells.length || columnOffset > 0 || projected.items.some(row => columnOffset + row.cells.length < row.columnCount), editableIds: projected.items.length ? [object.id] : [], reference: designReference(data.target, object.id) };
  }
  let rows, project = row => row, reviewCounts;
  if (['objects', 'review'].includes(request.operation)) {
    if (data.meta?.templateId === 'hazard-tracking-list') {
      rows = consolidateHazardRows(data.objects).map(group => ({ ...(group.rows.find(row => request.ids?.includes(row.id)) || group.rows[0]), title: group.issueTitle, text: group.issueBody,
        attributes: { ...group.attributes, HTR: group.recordId }, issueTitle: group.issueTitle, issueDescription: group.issueBody,
        assessmentCount: group.rows.length, groupId: group.id }));
      project = row => ({ ...compactDesignObject(row, data.target), issueTitle: row.issueTitle, issueDescription: compactDesignValue(row.issueDescription, 3500),
        assessmentCount: row.assessmentCount, groupId: row.groupId, editableFields: ['issueTitle', 'issueDescription'] });
    } else { rows = data.objects; project = row => compactDesignObject(row, data.target); }
    if (request.operation === 'review') {
      // Match against all canonical objects before paging. HTLs use the same
      // consolidated records as the table, never the underlying assessments.
      rows = rows.filter(row => !row.deleted && designReviewState(row, { artifact: data.target.kind === 'artifact' }).needsReview);
      const byId = new Map(data.objects.map(row => [row.id, row]));
      project = row => ({ id: row.id, title: String(row.title || row.name || row.label || '').slice(0, 300), kind: row.kind || row.type,
        parentId: row.parentId || row.ownerId || null, parentTitle: String(byId.get(row.parentId || row.ownerId)?.title || '').slice(0, 300),
        text: String(row.text ?? row.description ?? row.attributes?.Description ?? '').slice(0, 3500),
        textTruncated: String(row.text ?? row.description ?? row.attributes?.Description ?? '').length > 3500,
        review: designReviewState(row, { artifact: data.target.kind === 'artifact' }), reference: designReference(data.target, row.id) });
    }
  }
  if (request.operation === 'sources') { rows = data.sources; project = source => ({ id: source.id, title: source.title, sourceType: source.sourceType, sourceArtifactId: source.artifactId,
    sourceRowId: source.sourceRowId, text: compactDesignValue(source.text || source.description || source.snapshot || source, 6000), readOnly: true }); }
  if (request.operation === 'diagram') {
    if (data.model) rows = data.objects.map(row => compactDesignObject(row, data.target));
    else rows = data.sources.filter(source => source.sourceType === 'architecture-diagram' && (!request.sourceId || source.id === request.sourceId)).flatMap(source => [
      { id: source.id, title: source.title, nodeCount: source.snapshot?.nodes?.length || 0, edgeCount: source.snapshot?.edges?.length || 0, readOnly: true },
      ...(source.snapshot?.nodes || []).map(row => ({ ...compactDesignObject({ ...row, title: row.label || row.data?.label || row.title }, data.target), diagramId: source.id, readOnly: true })),
      ...(source.snapshot?.edges || []).map(row => ({ id: row.id, source: row.source || row.from, target: row.target || row.to, label: row.label || row.data?.label || '', diagramId: source.id, readOnly: true })),
    ]);
  }
  if (request.ids) {
    rows = rows.filter(row => request.ids.includes(row.id));
  }
  if (request.query) {
    const query = String(request.query).slice(0, 500).toLowerCase();
    rows = rows.filter(row => [row.id, row.title, row.name, row.label, row.text, row.description,
      ...Object.values(row.attributes || {}).filter(value => typeof value !== 'object')].some(value => String(value || '').toLowerCase().includes(query)));
  }
  if (request.operation === 'review') {
    const flaggedCount = rows.filter(row => designReviewState(row, { artifact: data.target.kind === 'artifact' }).flagged).length;
    reviewCounts = { flaggedCount, approvalOnlyCount: rows.length - flaggedCount };
  }
  const result = page(rows, request, project);
  return { operation: request.operation, target: data.target, title: data.title, version, readOnly: !!data.readOnly, templateId: data.meta?.templateId,
    ...(data.target.kind === 'artifact' ? { workflow: artifactWorkflow(data) } : {}),
    reference: designReference(data.target), ...result, ...reviewCounts,
    // Only exact local object identities are eligible for proposals. Source
    // diagrams and citations cannot become editable through a model response.
    editableIds: request.operation === 'objects' ? result.items.map(row => row.id) : data.model ? result.items.map(row => row.id) : [] };
}

export function assertPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw Error('Invalid design record.');
}
export { has };
