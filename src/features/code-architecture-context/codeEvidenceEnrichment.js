import { freezeEvidence } from '../code-architecture-storage/chunkedRecord';
import { createByteCache, mapFinalizationBatches } from './finalizationBatches';

// One invocation belongs to one immutable source snapshot. Catalogs and snippets
// are canonical immutable evidence; editable row/architecture fields stay owned
// by the row. The public evidence shape remains portable and fully resolved.
export async function enrichCodeEvidenceRows({ rows, readFile, splitFiles, selectFunctions, snippet, provenance = {}, owner, repo, signal, onBatch, cacheOptions }) {
  const raw = createByteCache(cacheOptions), catalogs = new Map(), snippets = new Map();
  const check = () => { if (signal?.aborted) throw signal.reason || new DOMException('Analysis cancelled.', 'AbortError'); };
  const get = async path => {
    check();
    let entry = raw.get(path);
    if (!entry) {
      const record = await readFile(path); check();
      entry = {record, lines:String(record?.content || '').split('\n')};
      raw.set(path, entry);
    }
    return entry;
  };
  try {
    return await mapFinalizationBatches(rows, async (row, index) => {
      const paths = Array.from(new Set([...splitFiles(row.fromFile), ...splitFiles(row.toFile)]));
      const records = new Map(), files = [], functions = [];
      for (const path of paths) {
        // A row's selection uses compact catalogs. Re-read raw text only if a
        // selected function needs a snippet that has not already been built.
        if (!catalogs.has(path)) {
          const {record} = await get(path);
          catalogs.set(path, freezeEvidence({
            ...provenance, filePath:path, fileName:path.split('/').pop() || path,
            repo:record?.repo || repo, owner:record?.owner || owner,
            branch:record?.branch || '', commitSha:record?.commitSha || '',
            imports:record?.imports || [], exports:record?.exports || [], functions:record?.functions || [],
            sourceFunctions:record?.sourceFunctions || [], sourceAudit:record?.sourceAudit || {},
          }));
        }
        const catalog = catalogs.get(path); files.push(catalog);
        for (const fn of catalog.sourceFunctions) functions.push(fn);
      }
      const selected = [];
      for (const fn of selectFunctions(functions, row)) {
        const identity = JSON.stringify(fn);
        if (!snippets.has(identity)) {
          let entry = records.get(fn.filePath);
          if (!entry) { entry = await get(fn.filePath); records.set(fn.filePath, entry); }
          snippets.set(identity, freezeEvidence({...fn, content:snippet(entry.lines, fn)}));
        }
        selected.push(snippets.get(identity));
      }
      return {...row, ...provenance, rowRef:index + 1,
        codeEvidence:{rowRefs:[index + 1], files, functions:Array.from(new Set([row.from,row.to].filter(Boolean))), sourceFunctions:selected, grounding:row.grounding || null},
        sourceEvidence:{rowRefs:[index + 1], functions:selected, confidence:row.grounding?.evidenceConfidence || (selected.length ? 'medium' : 'path-only')},
      };
    }, {signal, onBatch});
  } finally { raw.clear(); }
}
