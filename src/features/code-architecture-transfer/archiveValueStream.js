/* global BigInt */
// Tokenize structured values without cloning a whole record or stringifying it.
// Each token is small even when JSON escaping or binary expansion is substantial.
const PAGE = 8192;
export async function* streamValue(value, ancestors = new WeakSet()) {
  if (typeof value === 'string') {
    yield ['string'];
    for (let i = 0; i < value.length; i += PAGE) yield ['text', value.slice(i, i + PAGE)];
    yield ['end']; return;
  }
  if (value === undefined) { yield ['undefined']; return; }
  if (typeof value === 'bigint') { yield ['bigint', String(value)]; return; }
  if (typeof value === 'number' && !Number.isFinite(value)) { yield ['number', String(value)]; return; }
  if (value === null || ['boolean','number'].includes(typeof value)) { yield ['value', value]; return; }
  if (typeof value !== 'object') throw new Error('Unsupported project storage value. Export was not created.');
  if (value instanceof Date) { yield ['date', value.toISOString()]; return; }
  if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const blob = value instanceof Blob;
    const bytes = blob ? null : new Uint8Array(value.buffer || value, value.byteOffset || 0, value.byteLength);
    yield ['binary', blob ? 'Blob' : value instanceof ArrayBuffer ? 'ArrayBuffer' : value.constructor.name, blob ? value.type : ''];
    const size = blob ? value.size : bytes.byteLength;
    for (let i = 0; i < size; i += PAGE) {
      const part = blob ? new Uint8Array(await value.slice(i, i + PAGE).arrayBuffer()) : bytes.subarray(i, i + PAGE);
      yield ['bytes', Array.from(part)];
    }
    yield ['end']; return;
  }
  if (ancestors.has(value)) throw new Error('Circular project storage value cannot be exported.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      yield ['array']; for (const item of value) yield* streamValue(item, ancestors);
    } else if (value instanceof Map) {
      yield ['map']; for (const [key, item] of value) { yield* streamValue(key, ancestors); yield* streamValue(item, ancestors); }
    } else if (value instanceof Set) {
      yield ['set']; for (const item of value) yield* streamValue(item, ancestors);
    } else {
      if (Object.getPrototypeOf(value)?.constructor?.name !== 'Object' && Object.getPrototypeOf(value) !== null) throw new Error('Unsupported project storage value. Export was not created.');
      yield ['object'];
      for (const key of Object.keys(value)) { yield* streamValue(key, ancestors); yield* streamValue(value[key], ancestors); }
    }
    yield ['end'];
  } finally { ancestors.delete(value); }
}

export function createValueAssembler() {
  const stack = []; let result, completed = false;
  const bad = () => { throw new Error('Invalid streamed project record.'); };
  const push = value => {
    if (!stack.length) { if (completed) bad(); result = value; completed = true; return; }
    const frame = stack[stack.length - 1];
    if (frame.type === 'array') frame.value.push(value);
    else if (frame.type === 'set') frame.value.add(value);
    else if (frame.type === 'object' || frame.type === 'map') {
      if (!frame.hasKey) { if (frame.type === 'object' && typeof value !== 'string') bad(); frame.key = value; frame.hasKey = true; }
      else {
        if (frame.type === 'map') frame.value.set(frame.key, value);
        else Object.defineProperty(frame.value, frame.key, {value, enumerable:true, configurable:true, writable:true});
        frame.key = undefined; frame.hasKey = false;
      }
    } else bad();
  };
  return {
    add(token) {
      if (!Array.isArray(token) || typeof token[0] !== 'string' || completed) bad();
      const [type, value, mime] = token, top = stack[stack.length - 1];
      if (type === 'text') { if (top?.type !== 'string' || typeof value !== 'string') bad(); top.value.push(value); return; }
      if (type === 'bytes') {
        if (top?.type !== 'binary' || !Array.isArray(value) || value.some(n => !Number.isInteger(n) || n < 0 || n > 255)) bad();
        top.value.push(new Uint8Array(value)); return;
      }
      if (type === 'end') {
        if (!top || top.hasKey) bad(); stack.pop();
        if (top.type === 'string') push(top.value.join(''));
        else if (top.type === 'binary') {
          if (top.name === 'Blob') push(new Blob(top.value, {type:top.mime}));
          else {
            const bytes = new Uint8Array(top.value.reduce((n, part) => n + part.byteLength, 0)); let offset = 0;
            for (const part of top.value) { bytes.set(part, offset); offset += part.byteLength; }
            const types = {Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, DataView};
            if (top.name === 'ArrayBuffer') push(bytes.buffer);
            else { if (!types[top.name]) bad(); push(new types[top.name](bytes.buffer)); }
          }
        } else push(top.value);
        return;
      }
      if (['array','object','map','set','string','binary'].includes(type)) {
        if (top && ['string','binary'].includes(top.type)) bad();
        stack.push({type, name:value, mime, value:type === 'object' ? {} : type === 'map' ? new Map() : type === 'set' ? new Set() : []}); return;
      }
      if (type === 'value') { if (value !== null && !['boolean','number'].includes(typeof value)) bad(); push(value); }
      else if (type === 'undefined') push(undefined);
      else if (type === 'bigint') push(BigInt(value));
      else if (type === 'date') push(new Date(value));
      else if (type === 'number' && ['NaN','Infinity','-Infinity'].includes(value)) push(Number(value));
      else bad();
    },
    finish() { if (!completed || stack.length) bad(); return result; },
  };
}

// Conservative work/size estimate. Stop at the budget; never serialize to measure.
export function fitsArchiveLine(value, budget = 32768, seen = new WeakSet()) {
  const size = item => {
    budget -= 64;
    if (typeof item === 'string') budget -= item.length * 6;
    else if (typeof item === 'bigint') budget -= String(item).length;
    else if (item && typeof item === 'object') {
      if (seen.has(item)) return false;
      seen.add(item);
      if (item instanceof Blob) budget -= item.size * 8;
      else if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) budget -= item.byteLength * 8;
      else if (item instanceof Date) budget -= 64;
      else if (item instanceof Map) { for (const [key, value] of item) if (!size(key) || !size(value)) return false; }
      else if (item instanceof Set || Array.isArray(item)) { for (const value of item) if (!size(value)) return false; }
      else { for (const key of Object.keys(item)) if (!size(key) || !size(item[key])) return false; }
      seen.delete(item);
    }
    return budget >= 0;
  };
  return size(value);
}
