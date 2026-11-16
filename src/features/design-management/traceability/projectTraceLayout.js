import ELK from 'elkjs/lib/elk.bundled.js';

// This entire rectangle is reserved, including the text below the icon.
// Only an endpoint's horizontal terminal may enter its icon's connection lane.
export const TRACE_ITEM_WIDTH = 196;
export const TRACE_ITEM_HEIGHT = 140;
export const TRACE_ICON_Y = 32;
export const TRACE_ICON_LEFT = 68;
export const TRACE_ICON_RIGHT = 128;
const elk = new ELK();

export const traceEdgeLabel = edge => edge.label || edge.type || 'Relationship';

export async function layoutTraceDiagram(model) {
  const nodeIds = new Map(model.nodes.map((node, i) => [node.id, `n${i}`]));
  const result = await elk.layout({
    id: 'trace',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'SPLINES',
      'elk.layered.edgeRouting.splines.mode': 'CONSERVATIVE',
      'elk.padding': '[top=36,left=36,bottom=36,right=36]',
      'elk.spacing.nodeNode': '64', 'elk.spacing.edgeNode': '28', 'elk.spacing.edgeEdge': '22',
      'elk.spacing.componentComponent': '80',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
      'elk.layered.spacing.edgeNodeBetweenLayers': '32',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '24',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.mergeEdges': 'false',
    },
    children: model.nodes.map(node => {
      const id = nodeIds.get(node.id);
      return { id, width: TRACE_ITEM_WIDTH, height: TRACE_ITEM_HEIGHT,
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
        ports: [
          { id: `${id}:out`, x: TRACE_ITEM_WIDTH, y: TRACE_ICON_Y, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'EAST' } },
          { id: `${id}:in`, x: 0, y: TRACE_ICON_Y, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'WEST' } },
        ] };
    }),
    edges: model.edges.map((edge, i) => ({ id: `e${i}`, sources: [`${nodeIds.get(edge.from)}:out`], targets: [`${nodeIds.get(edge.to)}:in`],
      labels: [{ text: traceEdgeLabel(edge), width: Math.max(60, traceEdgeLabel(edge).length * 6.5 + 16), height: 22 }] })),
  });
  const placed = new Map(result.children.map(node => [node.id, node])), routedEdges = new Map(result.edges.map(edge => [edge.id, edge]));
  const positions = new Map(model.nodes.map(node => { const position = placed.get(nodeIds.get(node.id)); return [node.id, { x: position.x, y: position.y }]; }));
  const routes = new Map(model.edges.map((edge, i) => {
    const routed = routedEdges.get(`e${i}`), from = positions.get(edge.from), to = positions.get(edge.to);
    const section = routed.sections?.[0];
    if (!section) throw new Error('A traceability connection could not be routed.');
    const start = { x: from.x + TRACE_ICON_RIGHT, y: from.y + TRACE_ICON_Y }, end = { x: to.x + TRACE_ICON_LEFT, y: to.y + TRACE_ICON_Y };
    // ELK supplies cubic control points. Extend its endpoints to the icon's
    // clear terminal lane with collinear cubics, retaining smooth tangents.
    const points = [start, { x: (start.x * 2 + section.startPoint.x) / 3, y: start.y },
      { x: (start.x + section.startPoint.x * 2) / 3, y: start.y }, section.startPoint,
      ...(section.bendPoints || []), section.endPoint,
      { x: (section.endPoint.x * 2 + end.x) / 3, y: end.y }, { x: (section.endPoint.x + end.x * 2) / 3, y: end.y }, end];
    const label = routed.labels[0];
    return [edge.id, { points, label: { x: label.x + label.width / 2, y: label.y + label.height / 2, width: label.width, height: label.height } }];
  }));
  const flowing = flowingTraceRoutes(model, positions, routes);
  const geometry = [...positions.values()].flatMap(point => [point, { x: point.x + TRACE_ITEM_WIDTH, y: point.y + TRACE_ITEM_HEIGHT }]);
  for (const route of flowing.values()) geometry.push(...route.points, { x: route.label.x - route.label.width / 2 - 4, y: route.label.y - route.label.height / 2 - 4 },
    { x: route.label.x + route.label.width / 2 + 4, y: route.label.y + route.label.height / 2 + 4 });
  let left = 0, top = 0, right = 1, bottom = 1;
  for (const point of geometry) { left = Math.min(left, point.x); top = Math.min(top, point.y); right = Math.max(right, point.x); bottom = Math.max(bottom, point.y); }
  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  return { positions, routes: flowing, bounds };
}

const rectangleOverlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const labelRectangle = label => ({ x: label.x - label.width / 2 - 3, y: label.y - label.height / 2 - 3, width: label.width + 6, height: label.height + 6 });
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// A cubic lies inside the convex hull of its controls. Subdivide intersecting
// hulls to reject a shortcut if any part of its curve approaches item content.
function curveBlocked(curve, obstacle, depth = 0) {
  const xs = curve.map(p => p.x), ys = curve.map(p => p.y);
  const bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) + .01, height: Math.max(...ys) - Math.min(...ys) + .01 };
  if (!rectangleOverlap(bounds, obstacle)) return false;
  if (depth === 14 || Math.max(bounds.width, bounds.height) < .2) return true;
  const [a, b, c, d] = curve, ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d), abc = midpoint(ab, bc), bcd = midpoint(bc, cd), center = midpoint(abc, bcd);
  return curveBlocked([a, ab, abc, center], obstacle, depth + 1) || curveBlocked([center, bcd, cd, d], obstacle, depth + 1);
}

function flowingTraceRoutes(model, positions, original) {
  const routes = new Map(original), labels = new Map([...original].map(([id, route]) => [id, labelRectangle(route.label)]));
  const reserved = [...positions.values()].map(position => ({ ...position, width: TRACE_ITEM_WIDTH, height: TRACE_ITEM_HEIGHT }));
  const obstacles = [...positions.values()].flatMap(({ x, y }) => [
    { x: x + 70, y: y + 4, width: 56, height: 56 },
    { x: x + 2, y: y + 62, width: 192, height: 38 },
    { x: x + 2, y: y + 100, width: 192, height: 36 },
  ]);
  const pairs = new Map();
  for (const edge of model.edges) { const pair = JSON.stringify([edge.from, edge.to]); if (!pairs.has(pair)) pairs.set(pair, []); pairs.get(pair).push(edge.id); }
  for (const edge of model.edges) {
    const route = routes.get(edge.id), start = route.points[0], end = route.points.at(-1), dx = end.x - start.x;
    const parallel = pairs.get(JSON.stringify([edge.from, edge.to])), lane = (parallel.indexOf(edge.id) - (parallel.length - 1) / 2) * 92;
    const accept = (points, labelPoints, routing) => {
      for (let i = 1; i < points.length; i += 3) if (obstacles.some(obstacle => curveBlocked(points.slice(i - 1, i + 3), obstacle))) return false;
      for (const point of labelPoints) {
        const label = { ...route.label, x: point.x, y: point.y - 16 }, rectangle = labelRectangle(label);
        if (reserved.some(node => rectangleOverlap(rectangle, node)) || [...labels].some(([id, other]) => id !== edge.id && rectangleOverlap(rectangle, other))) continue;
        routes.set(edge.id, { ...route, points, label, routing }); labels.set(edge.id, rectangle); return true;
      }
      return false;
    };
    // Simple links get a single broad curve. Blocked links sweep outside the
    // intervening items in two broad curves, not a flat rail with corner bends.
    if (dx >= 100 && edge.from !== edge.to) {
      const points = [start, { x: start.x + dx * .45, y: start.y + lane }, { x: end.x - dx * .45, y: end.y + lane }, end];
      const labelPoints = [.5, .35, .65].map(t => {
        const u = 1 - t, at = axis => u ** 3 * points[0][axis] + 3 * u * u * t * points[1][axis] + 3 * u * t * t * points[2][axis] + t ** 3 * points[3][axis];
        return { x: at('x'), y: at('y') };
      });
      if (accept(points, labelPoints, 'direct')) continue;
    }
    const span = Math.abs(dx), middleX = (start.x + end.x) / 2;
    // Start near this connection's existing safe corridor. Unrelated items in
    // other rows must not force a short connection into a diagram-wide loop.
    const top = Math.min(...route.points.map(point => point.y)), bottom = Math.max(...route.points.map(point => point.y));
    const above = Math.min(start.y, end.y) - top, below = bottom - Math.max(start.y, end.y);
    const sides = above >= below ? [-1, 1] : [1, -1];
    let swept = false;
    for (const margin of [24, 64, 120, 216, 360]) {
      for (const side of sides) {
        const y = side < 0 ? top - margin : bottom + margin, apex = { x: middleX, y };
        for (const leadRatio of [.3, .45, .6]) {
          const lead = Math.max(80, span * leadRatio), shoulder = Math.max(18, span * .12);
          const points = [start, { x: start.x + lead, y: start.y }, { x: middleX - shoulder, y }, apex,
            { x: middleX + shoulder, y }, { x: end.x - lead, y: end.y }, end];
          if (accept(points, [apex], 'sweep')) { swept = true; break; }
        }
        if (swept) break;
      }
      if (swept) break;
    }
  }
  return routes;
}

export function traceRoutePath(points) {
  if (!points.length) return '';
  if ((points.length - 1) % 3) throw new Error('Invalid traceability spline control points.');
  const path = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length; i += 3) path.push(`C ${points[i].x} ${points[i].y} ${points[i + 1].x} ${points[i + 1].y} ${points[i + 2].x} ${points[i + 2].y}`);
  return path.join(' ');
}
