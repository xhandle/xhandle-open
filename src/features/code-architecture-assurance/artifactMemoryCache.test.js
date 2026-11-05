import { createArtifactMemoryCache, serializeArtifactFallback } from './artifactMemoryCache';

test('cache evicts least recently used saved collections within a byte and entry budget', () => {
  const cache = createArtifactMemoryCache({ maxBytes: 1600, maxEntries: 2 });
  const rows = [{ id: '1', requirementText: 'x'.repeat(100) }];
  cache.set('system', rows); cache.set('subsystem', rows);
  expect(cache.get('system')).toBe(rows);
  cache.set('design', rows);
  expect(cache.has('subsystem')).toBe(false);
  expect(cache.get('system')).toBe(rows);
  expect(cache.stats().estimatedBytes).toBeLessThanOrEqual(1600);
  // Replacing a small entry by oversized data must not leave a stale snapshot.
  cache.set('system', [{ requirementText: 'x'.repeat(2000) }]);
  expect(cache.has('system')).toBe(false);
});

test('oversized cache admission stops walking the collection once its budget is exceeded', () => {
  const cache = createArtifactMemoryCache({ maxBytes: 512 });
  const rows = [{ text: 'x'.repeat(1000) }, { get text() { throw Error('Unnecessary read'); } }];
  expect(() => cache.set('large', rows)).not.toThrow();
  expect(cache.has('large')).toBe(false);
});

test('fallback serializes small results exactly and stops early for large results', () => {
  const rows = [{ id: 'a', text: 'Quoted " text\n' }, { id: 'b', text: 'é' }];
  expect(JSON.parse(serializeArtifactFallback(rows, 42, 750000)))
    .toEqual({ format: 'artifact-rows-v1', revision: 42, rowCount: 2, rows });
  const large = [{ text: 'x'.repeat(1000) }, { toJSON() { throw Error('Should never serialize remaining project'); } }];
  expect(serializeArtifactFallback(large, 42, 512)).toBeNull();
});
