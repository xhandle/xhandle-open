import {
  commentsForDiagramTarget,
  createDiagramComment,
  loadDiagramComments,
  saveDiagramComments,
} from './diagramComments';

describe('diagram comments', () => {
  test('persists comments against a stable node or edge target', () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    };
    const nodeComment = createDiagramComment({
      targetType: 'node',
      targetId: 'n:Plan Motion',
      targetLabel: 'Plan Motion',
      text: 'Confirm the degraded-mode behavior.',
    });
    const edgeComment = createDiagramComment({
      targetType: 'edge',
      targetId: 'e:trajectory',
      targetLabel: 'Trajectory Command',
      text: 'Review command latency assumptions.',
    });

    saveDiagramComments('diagram:positions:p1', [nodeComment, edgeComment], storage);
    const loaded = loadDiagramComments('diagram:positions:p1', storage);

    expect(commentsForDiagramTarget(loaded, 'node', 'n:Plan Motion')).toEqual([
      expect.objectContaining({ text: 'Confirm the degraded-mode behavior.' }),
    ]);
    expect(commentsForDiagramTarget(loaded, 'edge', 'e:trajectory')).toEqual([
      expect.objectContaining({ text: 'Review command latency assumptions.' }),
    ]);
  });

  test('rejects blank comments', () => {
    expect(createDiagramComment({ targetType: 'node', targetId: 'n:1', text: '   ' })).toBeNull();
  });
});
