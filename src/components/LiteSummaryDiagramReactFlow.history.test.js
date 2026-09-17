import {
  buildManualOrthogonalRoute,
  cloneDiagramEdgeForHistory,
  cloneDiagramNodeForHistory,
  diagramHistoryComparable,
} from './LiteSummaryDiagramReactFlow';
import { Position } from 'reactflow';

describe('functional diagram history serialization', () => {
  test('removes runtime comment UI data before serializing a drag checkpoint', () => {
    const cyclicRenderedLabel = {};
    cyclicRenderedLabel.owner = cyclicRenderedLabel;

    const node = cloneDiagramNodeForHistory({
      id: 'n:Plan Motion',
      position: { x: 10, y: 20 },
      data: {
        label: 'Plan Motion',
        commentCount: 1,
        onOpenComments: () => {},
      },
    });
    const edge = cloneDiagramEdgeForHistory({
      id: 'e:trajectory',
      source: 'n:Plan Motion',
      target: 'n:Control Motion',
      label: cyclicRenderedLabel,
      data: {
        baseLabel: 'Trajectory Command',
        commentCount: 1,
        description: 'Provides the planned trajectory.',
      },
    });

    expect(node.data).toEqual({ label: 'Plan Motion' });
    expect(edge.label).toBe('Trajectory Command');
    expect(edge.data).toEqual({ description: 'Provides the planned trajectory.' });
    expect(() => diagramHistoryComparable({ nodes: [node], edges: [edge] })).not.toThrow();
  });
});

describe('manual orthogonal edge routing', () => {
  test('keeps a draw.io-style lead-in before the first and last bend', () => {
    const route = buildManualOrthogonalRoute({
      sourceX: 100,
      sourceY: 80,
      targetX: 400,
      targetY: 240,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      corridor: 260,
    });
    expect(route.axis).toBe('x');
    expect(route.points[1]).toEqual({ x: 140, y: 80 });
    expect(route.points.at(-2)).toEqual({ x: 360, y: 240 });
    expect(route.points).toContainEqual({ x: 260, y: 80 });
    expect(route.points).toContainEqual({ x: 260, y: 240 });
  });

  test('supports vertical departures and a manually adjusted corridor', () => {
    const route = buildManualOrthogonalRoute({
      sourceX: 100,
      sourceY: 100,
      targetX: 300,
      targetY: 400,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      corridor: 275,
    });
    expect(route.axis).toBe('y');
    expect(route.points[1]).toEqual({ x: 100, y: 140 });
    expect(route.points.at(-2)).toEqual({ x: 300, y: 360 });
    expect(route.points).toContainEqual({ x: 100, y: 275 });
    expect(route.points).toContainEqual({ x: 300, y: 275 });
  });

  test('clamps manually adjusted endpoint spacing to the minimum lead-in', () => {
    const route = buildManualOrthogonalRoute({
      sourceX: 50,
      sourceY: 50,
      targetX: 350,
      targetY: 200,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      sourceSpacing: 4,
      targetSpacing: 12,
    });
    expect(route.sourceSpacing).toBe(40);
    expect(route.targetSpacing).toBe(40);
    expect(route.points[1]).toEqual({ x: 90, y: 50 });
    expect(route.points.at(-2)).toEqual({ x: 310, y: 200 });
  });

  test('routes around close facing nodes instead of folding overlapping lead-ins', () => {
    const route = buildManualOrthogonalRoute({
      sourceX: 100,
      sourceY: 100,
      targetX: 160,
      targetY: 100,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });
    expect(route.detour).toBe(true);
    expect(route.axis).toBe('y');
    expect(route.points[1]).toEqual({ x: 140, y: 100 });
    expect(route.points.at(-2)).toEqual({ x: 120, y: 100 });
    expect(route.points).toContainEqual({ x: 140, y: 4 });
    expect(route.points).toContainEqual({ x: 120, y: 4 });
  });

  test('detours before a valid route becomes visually over-compact', () => {
    const route = buildManualOrthogonalRoute({
      sourceX: 100,
      sourceY: 100,
      targetX: 270,
      targetY: 140,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });
    // The 90 px gap between lead-ins is non-overlapping, but would leave
    // less than the minimum run on each side of a centered bend.
    expect(route.points[1]).toEqual({ x: 140, y: 100 });
    expect(route.points.at(-2)).toEqual({ x: 230, y: 140 });
    expect(route.detour).toBe(true);
    expect(route.axis).toBe('y');
  });

  test('includes manual routes in undo and redo comparisons', () => {
    const base = diagramHistoryComparable({ edgeRouting: { defaultStyle: 'rectangular', manualRoutes: {} } });
    const adjusted = diagramHistoryComparable({ edgeRouting: { defaultStyle: 'rectangular', manualRoutes: { edge: { axis: 'x', corridor: 220 } } } });
    expect(adjusted).not.toBe(base);
  });
});
