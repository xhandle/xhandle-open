import { buildFunctionalNodeDetails, getFunctionalNodeDetails } from './functionalNodeDetails';

const key = value => String(value || '').trim().toLowerCase();
const containerKey = (type, label, system = '') => `${type}:${key(system)}:${key(label)}`;

function rowContainerDetails(rows) {
  const values = new Map();
  for (const row of rows || []) {
    for (const [type, field] of [['system', 'systemDetails'], ['subsystem', 'subsystemDetails']]) {
      if (!key(row[type]) || !Object.prototype.hasOwnProperty.call(row, field)) continue;
      const id = containerKey(type, row[type], type === 'subsystem' ? row.system : '');
      const value = String(row[field] ?? '');
      // Conflicting imported descriptions must not select an arbitrary winner.
      values.set(id, values.has(id) && values.get(id) !== value ? null : value);
    }
  }
  return values;
}

export function applyTableContainerDetails(boxes, rows, previousRows) {
  const current = rowContainerDetails(rows);
  const previous = rowContainerDetails(previousRows);
  const byId = new Map(boxes.map(box => [box.id, box]));
  let changed = false;
  const next = boxes.map(box => {
    const type = box.elementType === 'system' ? 'system' : 'subsystem';
    const id = containerKey(type, box.label, type === 'subsystem' ? byId.get(box.parentNode)?.label : '');
    const value = current.get(id);
    if (value == null || value === box.description || (previousRows ? previous.get(id) === value : box.descriptionUserEdited)) return box;
    changed = true;
    return {...box, description:value, descriptionUserEdited:true, descriptionSource:'functional-table'};
  });
  return changed ? next : boxes;
}

export function rowsWithDiagramDetails(rows, nodes, boxes) {
  const details = buildFunctionalNodeDetails(rows);
  const byId = new Map(boxes.map(box => [box.id, box]));
  const functions = new Map(nodes.filter(node => node.type !== 'groupBox' && node.type !== 'note')
    .map(node => [key(node.data?.label), node]));
  let changed = false;
  const next = rows.map(row => {
    const from = functions.get(key(row.fromFunction));
    const to = functions.get(key(row.toFunction));
    const parent = byId.get(from?.parentNode);
    const subsystem = parent?.elementType === 'system' ? null : parent;
    const system = parent?.elementType === 'system' ? parent : byId.get(parent?.parentNode);
    const updates = {};
    if (from) updates.fromDetails = getFunctionalNodeDetails(details, row.fromFunction)?.description ?? from.data?.description ?? '';
    if (to) updates.toDetails = getFunctionalNodeDetails(details, row.toFunction)?.description ?? to.data?.description ?? '';
    if (system) updates.systemDetails = system.description || '';
    else if (from && !key(row.system) && Object.prototype.hasOwnProperty.call(row, 'systemDetails')) updates.systemDetails = '';
    if (subsystem) updates.subsystemDetails = subsystem.description || '';
    else if (from && !key(row.subsystem) && Object.prototype.hasOwnProperty.call(row, 'subsystemDetails')) updates.subsystemDetails = '';
    if (Object.entries(updates).every(([field,value]) => (row[field] ?? '') === value)) return row;
    changed = true;
    return {...row,...updates};
  });
  return changed ? next : rows;
}

// Descriptions describe an entity, so an edit updates every occurrence of it.
export function editFunctionalEntityDetails(rows, index, field, value) {
  const source = rows[index];
  if (!source) return rows;
  const functionField = field === 'fromDetails' ? 'fromFunction' : field === 'toDetails' ? 'toFunction' : null;
  return rows.map((row, rowIndex) => {
    if (functionField) {
      const match = key(source[functionField]);
      if (!match) return rowIndex === index ? {...row,[field]:value} : row;
      return {...row,
        ...(key(row.fromFunction) === match ? {fromDetails:value} : {}),
        ...(key(row.toFunction) === match ? {toDetails:value} : {})};
    }
    const entity = field === 'systemDetails' ? 'system' : 'subsystem';
    const matches = key(source[entity]) && key(row[entity]) === key(source[entity])
      && (entity === 'system' || key(row.system) === key(source.system));
    return matches || rowIndex === index ? {...row,[field]:value} : row;
  });
}
