import { sha256 } from 'hash.js';

// Keep only keys, not hydrated analysis payloads. Check every stored chunk's
// digest and outgoing references so transport checksums cannot hide lost parts.
export function createChunkIntegrityCheck(onReference = () => {}) {
  const available = new Set(), required = new Set();
  const identity = (entry, key) => JSON.stringify([entry.db, entry.store, key]);
  const invalid = () => { throw new Error('Invalid analysis data chunk. No complete project transfer was created.'); };
  return {
    add(entry) {
      if (entry.kind !== 'record') return;
      const key = String(entry.key), value = entry.value?.value;
      const marker = key.indexOf(':$part:');
      const reference = ref => {
        // Ownership is checked for every archive record. Requiring a matching
        // validated chunk in this database/store permits legitimate run/history aliases.
        if (typeof ref !== 'string' || !/^.+:\$part:.+$/.test(ref)) invalid();
        const id=identity(entry,ref);
        if(!required.has(id)){required.add(id);onReference(entry,ref);}
      };
      const pointer = value => {
        if (value?.format === 'xhandle-json-tree-v1') reference(value.root);
      };
      pointer(value);
      if (value?.phase === 'ready-to-publish') {
        // These descriptors are nested in the recovery envelope, not JSON-tree nodes.
        pointer(value.rowRecord);
        pointer(value.runRecord);
      }
      if (marker < 0) return;
      if (typeof value !== 'string' || key.slice(marker + 7) !== sha256().update(value).digest('hex')) invalid();
      const node = JSON.parse(value);
      if (!Array.isArray(node) || node.length !== 2) invalid();
      const [type, data] = node;
      const child = item => {
        if (!item || typeof item !== 'object') invalid();
        if (Object.hasOwn(item, 'ref')) reference(item.ref);
        else if (!Object.hasOwn(item, 'value')) invalid();
      };
      if (type === 'string') reference(data);
      else if (['array', 'object', 'pages'].includes(type)) {
        if (!Array.isArray(data)) invalid();
        for (const item of data) {
          if (type === 'pages') reference(item);
          else if (type === 'array') child(item);
          else {
            if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string') invalid();
            child(item[1]);
          }
        }
      } else if (type !== 'value') invalid();
      available.add(identity(entry, entry.key));
    },
    finish() {
      for (const key of required) if (!available.has(key)) {
        throw new Error('Saved analysis is missing a data chunk. No complete project transfer was created. Restore a complete backup.');
      }
    },
  };
}
