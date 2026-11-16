const plain = value => Array.isArray(value) || (value && Object.getPrototypeOf(value) === Object.prototype) || (value && Object.getPrototypeOf(value) === null);
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

export function largeHazardMessage(value, budget = 262144, seen = new WeakSet()) {
  const walk = value => {
    if (typeof value === 'string') budget -= value.length * 2;
    else if (value && typeof value === 'object' && !seen.has(value)) {
      seen.add(value);
      for (const key of Object.keys(value)) { budget -= key.length + 8; walk(value[key]); if (budget < 0) break; }
    } else budget -= 8;
  };
  walk(value); return budget < 0;
}

// Snapshot strings by reference (they are immutable), instead of allocating a
// second copy of every workbook cell. Preserve aliases and synchronous isolation.
export function captureHazardSnapshot(value, seen = new WeakMap()) {
  if (typeof value === 'function' || typeof value === 'symbol') throw new DOMException('Unsupported checkpoint value.', 'DataCloneError');
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (!plain(value)) {
    const copy = structuredClone(value); seen.set(value, copy); return copy;
  }
  const copy = Array.isArray(value) ? new Array(value.length) : {};
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    const entry = captureHazardSnapshot(value[key], seen);
    if (key === '__proto__') Object.defineProperty(copy, key, { value: entry, enumerable: true, configurable: true, writable: true });
    else copy[key] = entry;
  }
  return copy;
}

// One acknowledged chunk at a time keeps native cloning and IPC bounded. The
// result becomes visible only after the complete graph arrives, with shared
// arrays/objects restored. This is an in-memory transport, not a storage format.
export function createHazardGraphTransport(post, completed, started = () => {}) {
  const incoming = new Map(), acknowledgements = new Map();
  let closed;
  const decode = (state, value) => {
    if (!value || typeof value !== 'object') return value;
    if ('atom' in value) return value.atom;
    if (!state.nodes.has(value.ref)) state.nodes.set(value.ref, value.array ? [] : {});
    return state.nodes.get(value.ref);
  };
  return {
    async send(id, value, meta) {
      if (closed) throw closed;
      const seen = new WeakMap(), queue = [];
      let bytes = 0;
      const encode = value => {
        if (typeof value === 'string') bytes += value.length * 2;
        else bytes += 16;
        if (!value || typeof value !== 'object') return value;
        if (!plain(value)) return { atom: value };
        if (!seen.has(value)) { seen.set(value, queue.length); queue.push(value); }
        return { ref: seen.get(value), array: Array.isArray(value) };
      };
      post({ id, graph: 'begin', root: encode(value), meta });
      let frames = [], since = performance.now();
      const flush = async () => {
        if (closed) throw closed;
        const acknowledged = new Promise((resolve, reject) => acknowledgements.set(id, { resolve, reject }));
        post({ id, graph: 'part', frames }); frames = []; bytes = 0;
        await acknowledged; await pause(); since = performance.now();
      };
      for (let index = 0; index < queue.length; index++) {
        const node = queue[index], array = Array.isArray(node);
        const entries = array ? node.map(encode) : Object.keys(node).map(key => [key, encode(node[key])]);
        frames.push([index, array, entries]);
        if (bytes >= 262144 || frames.length >= 128 || performance.now() - since >= 8) await flush();
      }
      if (frames.length) await flush();
      if (closed) throw closed;
      post({ id, graph: 'end' });
    },
    receive(data) {
      if (!data.graph) return false;
      if (data.graph === 'ack') { acknowledgements.get(data.id)?.resolve(); acknowledgements.delete(data.id); return true; }
      if (data.graph === 'begin') {
        incoming.set(data.id, { nodes: new Map(), root: data.root, meta: data.meta }); started(data.id); return true;
      }
      const state = incoming.get(data.id);
      if (!state) throw new Error('Hazard message graph is incomplete.');
      if (data.graph === 'part') {
        for (const [ref, array, entries] of data.frames) {
          const node = decode(state, { ref, array });
          if (array) { node.length = entries.length; for (let i = 0; i < entries.length; i++) node[i] = decode(state, entries[i]); }
          else for (const [key, value] of entries) Object.defineProperty(node, key, { value: decode(state, value), enumerable: true, configurable: true, writable: true });
        }
        post({ id: data.id, graph: 'ack' }); return true;
      }
      if (data.graph !== 'end') throw new Error('Unknown hazard message frame.');
      incoming.delete(data.id); completed(data.id, decode(state, state.root), state.meta); return true;
    },
    close(error) {
      closed = error; incoming.clear();
      for (const request of acknowledgements.values()) request.reject(error);
      acknowledgements.clear();
    },
  };
}
