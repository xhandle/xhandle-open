import { useEffect, useRef } from 'react';
import { QUICK_SEARCH_COLLECT, isSearchVisible } from './quickSearchUtils';

export function diagramNodeGroup(node) {
  if (node.type === 'note') return 'Notes';
  if (node.type !== 'groupBox') return 'Functions';
  if (node.data?.elementType === 'system' || node.elementType === 'system') return 'Systems';
  return { subsystem: 'Subsystems', csci: 'CSCI', csc: 'CSC', csu: 'CSU' }[node.data?.groupKind] || 'Subsystems';
}

function findRenderedLabel(host, nodeId, edgeId) {
  if (!host) return null;
  if (nodeId) {
    const node = Array.from(host.querySelectorAll('.react-flow__node[data-id]'))
      .find(element => element.getAttribute('data-id') === nodeId);
    return node?.querySelector('[data-diagram-label]') || null;
  }
  if (edgeId) {
    return Array.from(host.querySelectorAll('[data-diagram-edge-label]'))
      .find(element => element.getAttribute('data-diagram-edge-label') === edgeId) || null;
  }
  return null;
}

// Sample the model only when Find opens, not on viewport/selection updates.
export default function useCodeArchitectureQuickSearch(options) {
  const latest = useRef(options);
  latest.current = options;
  const { hostRef, storageKey } = options;
  useEffect(() => {
    let live = true;
    let timer;
    const cancel = () => { clearTimeout(timer); timer = undefined; };
    const available = () => live && latest.current.storageKey === storageKey && isSearchVisible(hostRef.current);
    const focus = (nodeId, edgeId) => {
      cancel();
      if (!available()) return;
      const initial = latest.current;
      const candidates = initial.getNavigatorNodes?.() || initial.getNodes();
      const modelNode = nodeId && candidates.find(node => node.id === nodeId && !node.hidden);
      if (nodeId && !modelNode) return;
      initial.onBeforeNavigate?.();
      if (modelNode && !initial.getNodes().some(node => node.id === nodeId && !node.hidden)) initial.revealNode?.(modelNode);
      let attempts = 0;
      const attempt = () => {
        if (!available()) return;
        const current = latest.current;
        const byId = new Map(current.getNodes().filter(node => !node.hidden).map(node => [node.id, node]));
        const edge = edgeId && current.getEdges().find(item => item.id === edgeId && !item.hidden);
        const targets = nodeId ? [byId.get(nodeId)] : edge ? [byId.get(edge.source), byId.get(edge.target)] : [];
        if (!targets.length || targets.some(node => !node)) {
          if (++attempts < 100) timer = setTimeout(attempt, 50);
          return;
        }
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const duration = reducedMotion ? 0 : 250;
        const label = findRenderedLabel(hostRef.current, nodeId, edgeId);
        const bounds = label?.getBoundingClientRect();
        const labelCenter = bounds && bounds.width > 0 && bounds.height > 0 && current.screenToFlowPosition?.({
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        });
        if (labelCenter && current.setCenter) {
          current.setCenter(labelCenter.x, labelCenter.y, { zoom: 1.15, duration });
        } else if (current.fitView({ nodes: targets, padding: 0.45, duration, minZoom: current.minZoom, maxZoom: 1.15 }) === false) {
          if (++attempts < 100) timer = setTimeout(attempt, 50);
          return;
        }
        current.setSelectedNodeIds(nodeId ? [nodeId] : []);
        current.setHighlightedEdgeId(edgeId || null);
        current.setNodes(all => all.map(node => !!node.selected === (node.id === nodeId) ? node : { ...node, selected: node.id === nodeId }));
        current.setEdges(all => all.map(item => !!item.selected === (item.id === edgeId) ? item : { ...item, selected: item.id === edgeId }));
      };
      attempt();
    };
    const collect = event => {
      if (!available() || !Array.isArray(event.detail?.entries)) return;
      const current = latest.current;
      const nodes = (current.getNavigatorNodes?.() || current.getNodes()).filter(node => !node.hidden);
      const byId = new Map(nodes.map(node => [node.id, node]));
      const context = node => {
        const parents = [], seen = new Set([node.id]);
        let parent = byId.get(node.parentNode || node.parentId);
        while (parent && !seen.has(parent.id) && parents.length < 32) {
          seen.add(parent.id);
          parents.unshift(String(parent.data?.label || parent.id));
          parent = byId.get(parent.parentNode || parent.parentId);
        }
        return parents.join(' › ');
      };
      nodes.forEach(node => {
        const group = diagramNodeGroup(node);
        const path = context(node);
        event.detail.entries.push({
          id: `${storageKey}:node:${node.id}`,
          kind: node.type === 'groupBox' ? group === 'Systems' ? 'System' : group === 'Subsystems' ? 'Subsystem' : group : node.type === 'note' ? 'Note' : 'Diagram node',
          label: String(node.data?.label || node.id), text: String(node.data?.description || ''),
          navigator: { group, context: path || String(node.data?.file || ''), identity: node.id },
          activate: () => focus(node.id, null),
        });
      });
      const rendered = new Map(current.getNodes().filter(node => !node.hidden).map(node => [node.id, node]));
      current.getEdges().filter(edge => !edge.hidden && rendered.has(edge.source) && rendered.has(edge.target)).forEach(edge => {
        const endpoints = [rendered.get(edge.source), rendered.get(edge.target)];
        const path = endpoints.map(node => node.data?.label || node.id).join(' → ');
        event.detail.entries.push({
          id: `${storageKey}:edge:${edge.id}`, kind: 'Diagram connection', label: String(edge.data?.label || edge.label || 'Connection'),
          text: `${path} ${String(edge.data?.description || '')}`,
          navigator: { group: 'Connections', context: path, identity: edge.id },
          activate: () => focus(null, edge.id),
        });
      });
    };
    window.addEventListener(QUICK_SEARCH_COLLECT, collect);
    return () => { live = false; cancel(); window.removeEventListener(QUICK_SEARCH_COLLECT, collect); };
  }, [hostRef, storageKey]);
}
