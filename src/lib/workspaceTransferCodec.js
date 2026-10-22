/* global BigInt, BigInt64Array, BigUint64Array, globalThis */
// JSON-safe graph encoding preserves structured-clone values and reference identity.
const views = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, DataView,
  ...(typeof BigInt64Array === 'undefined' ? {} : { BigInt64Array, BigUint64Array }) };
const bytes64 = buffer => {
  const bytes = new Uint8Array(buffer); let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
const from64 = text => {
  if (typeof text !== 'string') throw new Error('Invalid binary data in workspace file.');
  return Uint8Array.from(atob(text), char => char.charCodeAt(0)).buffer;
};
async function blobBuffer(blob) {
  if (blob.arrayBuffer) return blob.arrayBuffer();
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob); });
}
export async function encodeWorkspace(value) {
  const nodes = [], seen = new Map();
  async function encode(item) {
    if (item === undefined) return ['u'];
    if (typeof item === 'bigint') return ['i', String(item)];
    if (typeof item === 'number' && !Number.isFinite(item)) return ['n', String(item)];
    if (item === null || ['string','number','boolean'].includes(typeof item)) return ['p', item];
    if (typeof item !== 'object') throw new Error('A stored value cannot be transferred.');
    if (seen.has(item)) return ['r', seen.get(item)];
    const id = nodes.length; seen.set(item, id); nodes.push(null);
    if (id % 500 === 499) await new Promise(resolve => setTimeout(resolve, 0));
    if (item instanceof Date) nodes[id] = ['date', String(item.getTime())];
    else if (item instanceof ArrayBuffer) nodes[id] = ['buffer', bytes64(item)];
    else if (ArrayBuffer.isView(item)) nodes[id] = ['view', item.constructor.name, await encode(item.buffer), item.byteOffset, item instanceof DataView ? item.byteLength : item.length];
    else if (typeof Blob !== 'undefined' && item instanceof Blob) nodes[id] = ['blob', bytes64(await blobBuffer(item)), item.type, typeof File !== 'undefined' && item instanceof File ? { name: item.name, lastModified: item.lastModified } : null];
    else if (item instanceof Map) { const entries = []; for (const [key, val] of item) entries.push([await encode(key), await encode(val)]); nodes[id] = ['map', entries]; }
    else if (item instanceof Set) { const values = []; for (const val of item) values.push(await encode(val)); nodes[id] = ['set', values]; }
    else if (item instanceof RegExp) nodes[id] = ['regexp', item.source, item.flags];
    else if (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null) {
      const entries = []; for (const key of Object.keys(item)) entries.push([key, await encode(item[key])]);
      nodes[id] = [Array.isArray(item) ? 'array' : 'object', entries, Array.isArray(item) ? item.length : null];
    } else throw new Error(`Cannot transfer stored ${item.constructor?.name || 'object'}. Reconnect local folders instead of copying permissions.`);
    return ['r', id];
  }
  return { root: await encode(value), nodes };
}
export function decodeWorkspace(graph) {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length > 1000000) throw new Error('Invalid workspace data.');
  const values = new Map(), filling = new Set();
  function decode(ref) {
    if (!Array.isArray(ref)) throw new Error('Invalid workspace value.');
    if (ref[0] === 'p' && (ref[1] === null || ['string','number','boolean'].includes(typeof ref[1]))) return ref[1];
    if (ref[0] === 'u') return undefined;
    if (ref[0] === 'i' && typeof ref[1] === 'string') return BigInt(ref[1]);
    if (ref[0] === 'n' && ['NaN','Infinity','-Infinity'].includes(ref[1])) return Number(ref[1]);
    if (ref[0] !== 'r' || !Number.isInteger(ref[1]) || ref[1] < 0 || ref[1] >= graph.nodes.length) throw new Error('Invalid workspace reference.');
    const id = ref[1]; if (values.has(id)) return values.get(id);
    if (filling.has(id)) throw new Error('Invalid binary reference.');
    filling.add(id);
    const node = graph.nodes[id]; if (!Array.isArray(node)) throw new Error('Invalid workspace record.');
    let value;
    switch (node[0]) {
      case 'object': value = {}; break;
      case 'array': if (!Number.isInteger(node[2]) || node[2] < 0 || node[2] > 10000000) throw new Error('Invalid array length.'); value = new Array(node[2]); break;
      case 'map': value = new Map(); break;
      case 'set': value = new Set(); break;
      case 'date': value = new Date(Number(node[1])); break;
      case 'buffer': value = from64(node[1]); break;
      case 'view': if (!Object.hasOwn(views, node[1])) throw new Error('Unknown binary type.'); value = new views[node[1]](decode(node[2]), node[3], node[4]); break;
      case 'regexp': value = new RegExp(node[1], node[2]); break;
      case 'blob': { const bytes = from64(node[1]); value = node[3] ? new File([bytes], node[3].name, { type: node[2], lastModified: node[3].lastModified }) : new Blob([bytes], { type: node[2] }); break; }
      default: throw new Error('Unsupported workspace value type.');
    }
    values.set(id, value); filling.delete(id);
    if (['object','array'].includes(node[0])) for (const [key, val] of node[1]) {
      if (typeof key !== 'string' || (key === 'length' && Array.isArray(value))) throw new Error('Invalid object property.');
      Object.defineProperty(value, key, { value: decode(val), writable: true, enumerable: true, configurable: true });
    }
    if (node[0] === 'map') for (const [key, val] of node[1]) value.set(decode(key), decode(val));
    if (node[0] === 'set') for (const val of node[1]) value.add(decode(val));
    return value;
  }
  return decode(graph.root);
}
export async function workspaceDigest(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Full workspace transfer requires localhost, HTTPS, or xHandle Desktop.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
