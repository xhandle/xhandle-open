import { notifyBackupDataChanged } from '../lib/localBackupEvents';

const storageKeyFor = key => `${key}:csu-edge-routing`;
const styleFor = value => value === 'bezier' ? 'bezier' : 'rectangular';

export function csuAbsolutePositions(nodes = []) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const result = new Map();
  const resolve = (node, visiting = new Set()) => {
    if (result.has(node.id)) return result.get(node.id);
    const local = node.position || { x: 0, y: 0 };
    if (visiting.has(node.id)) return local;
    visiting.add(node.id);
    const parent = byId.get(node.parentNode);
    const origin = parent ? resolve(parent, visiting) : { x: 0, y: 0 };
    const absolute = { x: origin.x + local.x, y: origin.y + local.y };
    result.set(node.id, absolute);
    return absolute;
  };
  nodes.forEach(node => resolve(node));
  return result;
}

export function normalizeCsuEdgeRouting(value = {}) {
  const overrides = Object.fromEntries(Object.entries(value?.overrides || {})
    .filter(([, style]) => ['bezier', 'rectangular'].includes(style)));
  const manualRoutes = Object.fromEntries(Object.entries(value?.manualRoutes || {})
    .filter(([, route]) => route && typeof route === 'object')
    .map(([key, route]) => [key, {
      model: 'segment-v2',
      ...(['x', 'y'].includes(route.axis) ? { axis: route.axis } : {}),
      ...Object.fromEntries(['corridor', 'sourceOffset', 'targetOffset']
        .filter(field => typeof route[field] === 'number' && Number.isFinite(route[field]))
        .map(field => [field, route[field]])),
    }]));
  return { defaultStyle: styleFor(value?.defaultStyle), overrides, manualRoutes };
}

export function loadCsuEdgeRouting(key) {
  try { return normalizeCsuEdgeRouting(JSON.parse(localStorage.getItem(storageKeyFor(key)) || '{}')); }
  catch { return normalizeCsuEdgeRouting(); }
}

export function saveCsuEdgeRouting(key, state) {
  try {
    localStorage.setItem(storageKeyFor(key), JSON.stringify(normalizeCsuEdgeRouting(state)));
    notifyBackupDataChanged('csu-edge-routing');
  } catch (error) {
    console.warn('Unable to save CSU edge routing.', error);
  }
}
