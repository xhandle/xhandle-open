import { semanticHash } from '../artifacts/artifactModel';
import { requirementWritingIssues, REQUIREMENT_WRITING_GUIDANCE } from '../artifacts/requirementWriting';
import { SYSML_ELEMENT_TYPES, SYSML_RELATIONSHIP_TYPES } from '../SysMLV2Modeler/sysmlV2Types';
import { assertPlainRecord, has, readDesignTarget, targetKey } from './designContext';
import { consolidateHazardRows } from '../artifacts/consolidateHazardRows';
import { hazardIssueEvidenceHash } from '../artifacts/hazardIssueEvidence';

const OBJECT_KINDS = ['section', 'narrative', 'requirement', 'decision', 'gap', 'interface'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const jsonClone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const boundedText = (value, max = 16000) => { if (typeof value !== 'string' || value.length > max) throw Error(`Use text no longer than ${max} characters.`); return value; };
const invalid = message => { throw Error(message); };
export const designVersion = data => data.version || semanticHash(data.model || data.objects);

function attributeName(field) {
  const name = field.slice('attributes.'.length);
  if (!name.trim() || name.length > 100 || ['__proto__', 'constructor', 'prototype'].includes(name) || /^_/.test(name)) throw Error('This attribute cannot be edited by Collaborator.');
  return name;
}
function fieldValue(row, field) {
  if (field.startsWith('attributes.')) return row.attributes?.[attributeName(field)];
  return row[field];
}
function setField(row, field, value) {
  if (field.startsWith('attributes.')) return { ...row, attributes: { ...row.attributes, [attributeName(field)]: value } };
  return { ...row, [field]: value };
}
function validateField(data, row, field, value) {
  if (data.target.kind === 'sysml') {
    const relationship = SYSML_RELATIONSHIP_TYPES.includes(row.type);
    const allowed = relationship ? ['label', 'description', 'sourceId', 'targetId', 'type'] : ['name', 'description', 'ownerId'];
    if (!allowed.includes(field)) invalid('This SysML field is protected or unsupported.');
    if (field === 'type' && !SYSML_RELATIONSHIP_TYPES.includes(value)) invalid('Unsupported SysML relationship type.');
    if (value !== null) boundedText(value, field === 'description' ? 16000 : 300);
    if (['name', 'sourceId', 'targetId'].includes(field) && !value?.trim()) invalid('This SysML field cannot be empty.');
    return;
  }
  if (row.hazardTrackingRow) {
    if (!['issueTitle', 'issueDescription'].includes(field)) invalid('Original hazard assessments, HTR numbers and consolidated source columns are protected. Edit issueTitle or issueDescription.');
    boundedText(value, field === 'issueTitle' ? 300 : 4000); if (!value.trim()) invalid('The actionable issue text cannot be empty.'); return;
  }
  if (data.target.kind === 'module' && field === 'links') {
    if (!Array.isArray(value) || value.length > 30) invalid('Use at most 30 local module links.');
    for (const link of value) {
      assertPlainRecord(link);
      if (Object.keys(link).some(key => !['toId', 'type'].includes(key)) || !data.objects.some(object => object.id === link.toId)
        || !['refines', 'traces', 'satisfies', 'verifies', 'derives', 'related'].includes(link.type)) invalid('A link needs a supported relationship type and a local module object.');
    }
    return;
  }
  if (field.startsWith('attributes.')) {
    attributeName(field);
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') invalid('Attribute values must be text, numbers or booleans.');
    if (typeof value === 'number' && !Number.isFinite(value)) invalid('Attribute values must be finite.');
    if (typeof value === 'string') boundedText(value, 4000);
    return;
  }
  if (!['title', 'text', 'parentId', 'sourceIds', 'status', 'order', 'tableCell'].includes(field)) invalid('This document field is protected or unsupported.');
  if (field === 'title') { boundedText(value, 300); if (!value.trim()) invalid('A title cannot be empty.'); }
  if (field === 'text') boundedText(value);
  if (field === 'parentId' && value !== null) boundedText(value, 500);
  if (field === 'order' && (!Number.isFinite(value) || value < 0)) invalid('Use a nonnegative order.');
  if (field === 'status' && !['Proposed', 'Approved', 'Rejected'].includes(value)) invalid('Unsupported document status.');
  if (field === 'sourceIds' && (!Array.isArray(value) || value.length > 100 || value.some(id => !data.sources.some(source => source.id === id)))) invalid('Use only exact supporting source IDs from this document.');
}
function validateTree(rows, parentField) {
  const byId = new Map(rows.map(row => [row.id, row]));
  if (byId.size !== rows.length) invalid('Duplicate object IDs are not allowed.');
  const checked = new Set();
  for (const row of rows) {
    const path = new Set(); let current = row;
    while (current && !checked.has(current.id)) {
      if (path.has(current.id)) invalid('The proposed hierarchy contains a cycle.');
      path.add(current.id);
      if (current[parentField] && !byId.has(current[parentField])) invalid('A parent is missing or belongs to another document.');
      current = byId.get(current[parentField]);
    }
    for (const id of path) checked.add(id);
  }
}

// Pure preview/validation is also rerun at Apply; no model-selected field can
// bypass these rules by being placed in a replacement record.
export function applyDesignActions(data, actions) {
  if (!Array.isArray(actions) || !actions.length || actions.length > 40) invalid('Propose between 1 and 40 changes to one document or model.');
  let rows = [...data.objects]; const previews = [], undo = []; const touched = new Set();
  for (const action of actions) {
    assertPlainRecord(action);
    if (Object.keys(action).some(key => !['operation', 'objectId', 'field', 'value', 'record', 'id', 'reason', 'before', 'after', 'target'].includes(key))) invalid('Unsupported design action fields.');
    const operation = action.operation;
    if (!['update', 'create', 'delete'].includes(operation)) invalid('Use create, update or delete for local design objects.');
    const index = rows.findIndex(row => row.id === action.objectId), row = rows[index];
    if (operation !== 'create' && !row) invalid('The target object is missing or belongs to another document.');
    const touch = `${action.objectId}:${operation === 'update' ? action.field + (action.field === 'tableCell' ? `:${action.value?.row}:${action.value?.column}` : '') : '*'}`;
    if (touched.has(touch) || touched.has(`${action.objectId}:*`)) invalid('The same object or field was changed twice in one proposal.');
    touched.add(touch);
    if (operation === 'create') {
      if (data.meta?.templateId === 'hazard-tracking-list') invalid('HTR creation and consolidation must retain assessment provenance. Use the artifact consolidation workflow.');
      assertPlainRecord(action.record);
      const input = action.record;
      const allowed = data.target.kind === 'sysml' ? ['type', 'name', 'description', 'ownerId', 'sourceId', 'targetId', 'label'] : ['kind', 'title', 'text', 'parentId', 'sourceIds'];
      if (Object.keys(input).some(key => !allowed.includes(key))) invalid('The new object contains protected fields.');
      if (!action.objectId || rows.some(item => item.id === action.objectId)) invalid('The new object ID is invalid or already exists.');
      let next;
      if (data.target.kind === 'sysml') {
        if (![...SYSML_ELEMENT_TYPES, ...SYSML_RELATIONSHIP_TYPES].includes(input.type)) invalid('Unsupported SysML type.');
        next = { id: action.objectId, ...input };
        if (SYSML_RELATIONSHIP_TYPES.includes(next.type)) { boundedText(next.sourceId, 300); boundedText(next.targetId, 300); }
        else { boundedText(next.name, 300); if (!next.name.trim()) invalid('Name the new SysML element.'); }
        if (has(input, 'description')) boundedText(input.description);
      } else {
        if (!OBJECT_KINDS.includes(input.kind)) invalid('Unsupported document object kind.');
        boundedText(input.title, 300); boundedText(input.text || '');
        if (!input.title.trim()) invalid('Name the new document object.');
        const parent = rows.find(item => item.id === input.parentId);
        if (!parent) invalid('Create new content beneath an existing parent title in this document.');
        next = { id: action.objectId, title: input.title, text: input.text || '', kind: input.kind, parentId: parent.id,
          sectionId: parent.sectionId, sourceIds: input.sourceIds || [], manual: true,
          ...(data.target.kind === 'module' ? { heading: input.kind === 'section', folderId: data.folder.id, projectId: data.folder.id, module: data.module.name, moduleId: data.module.id,
            attributes: { Description: input.text || '' } } : {}) };
        validateField(data, next, 'sourceIds', next.sourceIds);
      }
      rows.push(next); previews.push({ ...action, before: null, after: input }); undo.unshift({ operation: 'remove-created', objectId: next.id });
    } else if (operation === 'delete') {
      if (row.hazardTrackingRow || data.meta?.templateId === 'hazard-tracking-list') invalid('HTRs and their assessments cannot be discarded through conversational edits.');
      if (row.id === data.model?.rootElementId) invalid('The root SysML package cannot be deleted.');
      if (rows.some(item => (item.parentId || item.ownerId || item.packageId) === row.id)) invalid('Remove or reparent every child explicitly before deleting its parent.');
      if (data.model && rows.some(item => item.sourceId === row.id || item.targetId === row.id)) invalid('Remove the connected relationships explicitly before deleting this element.');
      if (data.model?.traceLinks?.some(link => link.sourceId === row.id || link.targetId === row.id)) invalid('Remove the element’s trace links in the model before deleting it.');
      rows.splice(index, 1); previews.push({ ...action, before: { title: row.title || row.name, text: row.text || row.description || row.attributes?.Description }, after: null });
      undo.unshift({ operation: 'restore-deleted', object: row, index });
    } else {
      validateField(data, row, action.field, action.value);
      let next, before, moduleDescription;
      if (row.hazardTrackingRow && ['issueTitle', 'issueDescription'].includes(action.field)) {
        const group = consolidateHazardRows(rows).find(group => group.rows.some(item => item.id === row.id));
        const sectionIndex = rows.findIndex(item => item.kind === 'section' && item.sectionId === 's2');
        if (!group || sectionIndex < 0) invalid('This HTR has no saved consolidation section. Finish consolidation before editing its issue.');
        const section = rows[sectionIndex], summaries = section.hazardIssueSummaries || {}, previous = summaries[group.id];
        before = action.field === 'issueTitle' ? group.issueTitle : group.issueBody;
        rows[sectionIndex] = { ...section, manual: true, hazardIssueSummaries: { ...summaries, [group.id]: {
          title: group.issueTitle, description: group.issueBody, ...previous,
          [action.field === 'issueTitle' ? 'title' : 'description']: action.value, evidenceHash: hazardIssueEvidenceHash(group), manual: true,
        } } };
        previews.push({ ...action, before, after: action.value });
        undo.unshift({ operation: 'restore-issue', sectionId: section.id, groupId: group.id, previous, manual: section.manual });
        continue;
      } else if (action.field === 'tableCell') {
        const { row: r, column: c, text } = action.value || {};
        const cells = row.content?.table?.cells;
        if (row.content?.type !== 'table' || !Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || !Array.isArray(cells?.[r]) || c >= cells[r].length) invalid('That embedded-table cell is outside the saved table.');
        boundedText(text, 4000); before = { row: r, column: c, text: cells[r][c] };
        const updated = cells.map((line, i) => i === r ? line.map((cell, j) => j === c ? text : cell) : line);
        next = { ...row, content: { ...row.content, table: { ...row.content.table, cells: updated } } };
      } else {
        before = fieldValue(row, action.field); next = setField(row, action.field, jsonClone(action.value));
        if (data.target.kind === 'module' && action.field === 'text') {
          moduleDescription = { value: row.attributes?.Description, absent: !has(row.attributes, 'Description'), textAbsent: !has(row, 'text') };
          before = row.attributes?.Description ?? row.text;
          next.attributes = { ...next.attributes, Description: action.value };
          if (moduleDescription.textAbsent) delete next.text;
        }
      }
      rows[index] = { ...next, manual: true };
      previews.push({ ...action, before: jsonClone(before) ?? null, after: action.value });
      undo.unshift({ operation: 'restore-field', objectId: row.id, field: action.field, value: jsonClone(moduleDescription ? row.text : before), absent: moduleDescription?.textAbsent ?? before === undefined, manual: row.manual,
        ...(moduleDescription ? { moduleDescription } : {}) });
    }
  }
  validateTree(data.model ? rows.filter(row => !SYSML_RELATIONSHIP_TYPES.includes(row.type)).map(row => ({ ...row, ownerId: row.ownerId || row.packageId })) : rows, data.model ? 'ownerId' : 'parentId');
  if (data.target.kind === 'module' && rows.some(row => row.links?.some(link => data.objects.some(object => object.id === link.toId) && !rows.some(object => object.id === link.toId)))) invalid('Remove or update incoming links before deleting a linked requirement.');
  if (data.model) {
    const elements = new Set(rows.filter(row => SYSML_ELEMENT_TYPES.includes(row.type)).map(row => row.id));
    if (rows.some(row => SYSML_RELATIONSHIP_TYPES.includes(row.type) && (!elements.has(row.sourceId) || !elements.has(row.targetId)))) invalid('A diagram relationship endpoint is missing or outside this model.');
  }
  for (const row of rows.filter(row => actions.some(action => action.objectId === row.id))) {
    const requirement = row.kind === 'requirement' || /Requirement(?:Definition|Usage)/.test(row.type || '') || (data.target.kind === 'module' && !row.heading && row.kind === 'requirement');
    if (requirement) {
      const issues = requirementWritingIssues(row.text || row.description || row.attributes?.Description || '');
      if (issues.length) invalid(`Requirement wording needs correction: ${issues.join(' ')}`);
    }
  }
  return { objects: rows, previews, undo };
}

export function undoDesignActions(objects, changes) {
  let rows = [...objects];
  for (const change of changes) {
    if (change.operation === 'remove-created') rows = rows.filter(row => row.id !== change.objectId);
    else if (change.operation === 'restore-deleted') rows.splice(change.index, 0, change.object);
    else if (change.operation === 'restore-issue') rows = rows.map(row => {
      if (row.id !== change.sectionId) return row;
      const summaries = { ...row.hazardIssueSummaries };
      if (change.previous) summaries[change.groupId] = change.previous; else delete summaries[change.groupId];
      return { ...row, manual: change.manual, hazardIssueSummaries: summaries };
    });
    else {
      rows = rows.map(row => {
        if (row.id !== change.objectId) return row;
        if (change.field === 'tableCell') {
          const { row: r, column: c, text } = change.value;
          return { ...row, manual: change.manual, content: { ...row.content, table: { ...row.content.table, cells: row.content.table.cells.map((line, i) => i === r ? line.map((cell, j) => j === c ? text : cell) : line) } } };
        }
        const next = { ...setField(row, change.field, change.value), manual: change.manual };
        if (change.absent) {
          if (change.field.startsWith('attributes.')) delete next.attributes[attributeName(change.field)]; else delete next[change.field];
        }
        if (change.moduleDescription) {
          next.attributes = { ...next.attributes, Description: change.moduleDescription.value };
          if (change.moduleDescription.absent) delete next.attributes.Description;
        }
        return next;
      });
    }
  }
  return rows;
}

export async function prepareDesignProposal(raw, evidence = [], threadId) {
  assertPlainRecord(raw);
  if (typeof raw.summary !== 'string' || !raw.summary.trim() || raw.summary.length > 2000) invalid('Describe the proposed design change concisely.');
  const target = raw.target;
  const reads = evidence.filter(read => read.target && targetKey(read.target) === targetKey(target));
  if (!reads.length) invalid('Read the exact target document before proposing changes.');
  const data = await readDesignTarget(target);
  const version = designVersion(data);
  if (reads.some(read => read.version !== version)) invalid('The design changed during this response. Read its current content before proposing edits.');
  if (data.readOnly) invalid('This document is read-only or generation is running. Pause generation before editing.');
  const readIds = new Set(reads.flatMap(read => read.editableIds || []));
  if (!Array.isArray(raw.actions)) invalid('Return an array of design actions.');
  const id = crypto.randomUUID();
  const actions = raw.actions.map((action, index) => {
    assertPlainRecord(action);
    const result = { ...action, id: `${id}:${index}`, objectId: action.operation === 'create' ? `${data.target.id}:collaborator:${id}:${index}` : action.objectId };
    if (action.operation !== 'create' && !readIds.has(action.objectId)) invalid('The proposal targets an object that was not read in this turn.');
    if (action.field === 'tableCell' && !reads.some(read => read.items?.some(item => {
      if (item.id !== action.objectId) return false;
      const cells = Array.isArray(item.table) ? item.table : item.table?.value;
      return Array.isArray(cells?.[action.value?.row]) && action.value.column >= 0 && action.value.column < cells[action.value.row].length
        || item.tableRowIndex === action.value?.row && item.cells?.some(cell => cell.column === action.value.column);
    }))) invalid('Read the exact embedded-table cell before proposing its replacement.');
    for (const reference of [action.field === 'parentId' ? action.value : null, action.record?.parentId, action.record?.ownerId, action.record?.sourceId, action.record?.targetId,
      ['ownerId', 'sourceId', 'targetId'].includes(action.field) ? action.value : null].filter(Boolean)) if (!readIds.has(reference)) invalid('Read the exact parent or endpoint before proposing this change.');
    if (action.field === 'links' && Array.isArray(action.value) && action.value.some(link => !readIds.has(link.toId))) invalid('Read the exact related objects before proposing module links.');
    return result;
  });
  const result = applyDesignActions(data, actions);
  if (same(result.objects, data.objects)) invalid('The proposal makes no change to the saved content.');
  return { domain: 'design-management', id, threadId, intent: 'mutate', target: data.target, title: data.title, version, summary: raw.summary,
    actions: result.previews.map(action => ({ ...action, target: { type: 'design-object', title: data.title, designTarget: data.target, objectId: action.objectId,
      objectTitle: data.objects.find(row => row.id === action.objectId)?.title || data.objects.find(row => row.id === action.objectId)?.name || action.record?.title || action.record?.name || action.record?.label || 'Design object' } })), completed: false };
}

export const DESIGN_WRITING_GUIDANCE = REQUIREMENT_WRITING_GUIDANCE;

export function verifyDesignSave(data, actions) {
  for (const action of actions) {
    const row = data.objects.find(row => row.id === action.objectId);
    if (action.operation === 'delete') { if (row) invalid('The deletion was not reflected in saved content.'); continue; }
    if (!row) invalid('The new or changed object was not found in saved content.');
    if (action.operation === 'create') {
      for (const [key, value] of Object.entries(action.record)) if (!same(row[key] ?? (key === 'text' ? row.attributes?.Description : undefined), value)) invalid('The new object did not match the reviewed proposal.');
    } else {
      let value;
      if (action.field === 'tableCell') value = row.content?.table?.cells?.[action.value.row]?.[action.value.column];
      else if (['issueTitle', 'issueDescription'].includes(action.field) && row.hazardTrackingRow) {
        const group = consolidateHazardRows(data.objects).find(group => group.rows.some(item => item.id === row.id));
        value = action.field === 'issueTitle' ? group?.issueTitle : group?.issueBody;
      } else value = data.target.kind === 'module' && action.field === 'text' ? row.attributes?.Description : fieldValue(row, action.field);
      if (!same(value, action.field === 'tableCell' ? action.value.text : action.value)) invalid('The saved field did not match the reviewed proposal. Reload before continuing.');
    }
  }
}
