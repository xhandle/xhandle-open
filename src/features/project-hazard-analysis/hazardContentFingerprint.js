import { sha256 } from 'hash.js';

// A bounded Merkle fingerprint, rather than retaining a full workbook JSON string
// in every head and revision. Shared Summary/HARA rows are hashed once; duplicated
// but equal rows produce the same result. Sizes retain the logical JSON char count.
export function hazardContentFingerprint(value) {
  const cache = new WeakMap();
  const visiting = new WeakSet();
  const walk = (value, inArray = false) => {
    if (value?.toJSON) value = value.toJSON();
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
      return inArray ? { text: 'null', characters: 4 } : null;
    }
    if (value === null || typeof value !== 'object') {
      const text = JSON.stringify(value);
      return { text, characters: text.length };
    }
    if (cache.has(value)) return cache.get(value);
    if (visiting.has(value)) throw new Error('Hazard analysis contains a circular value.');
    visiting.add(value);
    const array = Array.isArray(value);
    const hash = sha256();
    let buffer = array ? '[' : '{', characters = 2, count = 0;
    const emit = text => { buffer += text; if (buffer.length >= 16384) { hash.update(buffer); buffer = ''; } };
    for (const key of array ? value.keys() : Object.keys(value).sort()) {
      const child = walk(value[key], array);
      if (!child) continue;
      if (count++) { emit(','); characters++; }
      if (!array) { const name = JSON.stringify(key) + ':'; emit(name); characters += name.length; }
      // Typed tokens prevent a string resembling a digest from colliding with a subtree.
      emit(child.digest ? '@' + child.digest : ':' + child.text);
      characters += child.characters;
    }
    emit(array ? ']' : '}');
    hash.update(buffer);
    const result = { digest: hash.digest('hex'), characters };
    visiting.delete(value); cache.set(value, result);
    return result;
  };
  const result = walk(value);
  return { signature: 'sha256-tree-v1:' + (result.digest || sha256().update(result.text).digest('hex')), characters: result.characters };
}
