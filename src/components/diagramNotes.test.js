import {
  diagramNotesStorageKey,
  loadDiagramNotes,
  normalizeDiagramNote,
  saveDiagramNotes,
} from './diagramNotes';

describe('diagram notes persistence', () => {
  test('normalizes and round-trips code architecture canvas notes', () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    };
    const note = normalizeDiagramNote({
      id: 'note:1',
      label: ' Review ',
      description: 'Check this interface.',
      position: { x: 120, y: 240 },
      createdAt: '2026-09-14T10:00:00.000Z',
    });

    saveDiagramNotes('repo:main', [note], storage);

    expect(diagramNotesStorageKey('repo:main')).toBe('repo:main:notes:v1');
    expect(loadDiagramNotes('repo:main', storage)).toEqual([expect.objectContaining({
      id: 'note:1',
      label: 'Review',
      description: 'Check this interface.',
      position: { x: 120, y: 240 },
    })]);
  });

  test('rejects malformed notes and repairs invalid coordinates', () => {
    expect(normalizeDiagramNote({ description: 'missing id' })).toBeNull();
    expect(normalizeDiagramNote({ id: 'note:2', position: { x: 'bad', y: 4 } })).toMatchObject({
      position: { x: 0, y: 4 },
    });
  });
});
