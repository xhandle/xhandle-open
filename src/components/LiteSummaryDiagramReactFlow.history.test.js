import {
  cloneDiagramEdgeForHistory,
  cloneDiagramNodeForHistory,
  diagramHistoryComparable,
} from './LiteSummaryDiagramReactFlow';

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
