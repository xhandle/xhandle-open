/* global BigInt */
// Tokenize structured values without cloning a whole record or stringifying it.
// Each token is small even when JSON escaping or binary expansion is substantial.
const PAGE = 8192;
// A pull iterator avoids recursive async-generator delegation. Safari crash
// reports during export included asyncGeneratorUnwrapYieldResumption and JIT
// optimization frames. Only Blob page reads need promises; normal tokens use
// ordinary iterator results, with retained traversal state bounded by depth.
export function streamValue(value) {
  const stack = [{type: 'visit', value}];
  const ancestors = new WeakSet();
  let closed = false;
  const emit = value => ({done: false, value});
  const emitBytes = buffer => closed ? {done: true, value: undefined} : emit(['bytes', Array.from(new Uint8Array(buffer))]);
  const visit = value => stack.push({type: 'visit', value});
  const close = () => { closed = true; stack.length = 0; return {done: true, value: undefined}; };
  const next = () => {
    if (closed) return {done: true, value: undefined};
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.type === 'string' || frame.type === 'binary') {
        if (frame.offset >= frame.size) { stack.pop(); return emit(['end']); }
        const offset = frame.offset; frame.offset += PAGE;
        if (frame.type === 'string') return emit(['text', frame.value.slice(offset, offset + PAGE)]);
        if (frame.blob) return frame.value.slice(offset, offset + PAGE).arrayBuffer().then(emitBytes);
        return emit(['bytes', Array.from(frame.value.subarray(offset, offset + PAGE))]);
      }
      if (frame.type === 'container') {
        const item = frame.iterator.next();
        if (item.done) { stack.pop(); ancestors.delete(frame.value); return emit(['end']); }
        if (frame.kind === 'object') { visit(frame.value[item.value]); visit(item.value); }
        else if (frame.kind === 'map') { visit(item.value[1]); visit(item.value[0]); }
        else visit(item.value);
        continue;
      }
      stack.pop();
      const item = frame.value;
      if (typeof item === 'string') { stack.push({type:'string', value:item, offset:0, size:item.length}); return emit(['string']); }
      if (item === undefined) return emit(['undefined']);
      if (typeof item === 'bigint') return emit(['bigint', String(item)]);
      if (typeof item === 'number' && !Number.isFinite(item)) return emit(['number', String(item)]);
      if (item === null || ['boolean','number'].includes(typeof item)) return emit(['value', item]);
      if (typeof item !== 'object') throw new Error('Unsupported project storage value. Export was not created.');
      if (item instanceof Date) return emit(['date', item.toISOString()]);
      if (item instanceof Blob || item instanceof ArrayBuffer || ArrayBuffer.isView(item)) {
        const blob = item instanceof Blob;
        const bytes = blob ? item : new Uint8Array(item.buffer || item, item.byteOffset || 0, item.byteLength);
        stack.push({type:'binary', value:bytes, blob, offset:0, size:blob ? item.size : bytes.byteLength});
        return emit(['binary', blob ? 'Blob' : item instanceof ArrayBuffer ? 'ArrayBuffer' : item.constructor.name, blob ? item.type : '']);
      }
      if (ancestors.has(item)) throw new Error('Circular project storage value cannot be exported.');
      let kind, iterator;
      if (Array.isArray(item)) { kind = 'array'; iterator = item.values(); }
      else if (item instanceof Map) { kind = 'map'; iterator = item.entries(); }
      else if (item instanceof Set) { kind = 'set'; iterator = item.values(); }
      else {
        if (Object.getPrototypeOf(item)?.constructor?.name !== 'Object' && Object.getPrototypeOf(item) !== null) throw new Error('Unsupported project storage value. Export was not created.');
        kind = 'object'; iterator = Object.keys(item).values();
      }
      ancestors.add(item);
      stack.push({type:'container', value:item, kind, iterator});
      return emit([kind]);
    }
    return close();
  };
  return {
    [Symbol.asyncIterator]() { return this; },
    next() {
      try {
        const result = next();
        return result instanceof Promise ? result.catch(error => { close(); throw error; }) : result;
      } catch (error) { close(); throw error; }
    },
    return: close,
  };
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
    if (budget < 0) return false;
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
