const readable = value => typeof value === 'string' && value.trim() && !/^[a-f0-9-]{24,}$/i.test(value.trim()) && !/^(cba|cbaMeta):/.test(value) ? value.trim() : '';

export function describeStorageItem(key, record, { projects = [], category = 'Saved data', ordinal = 1 } = {}, metadata = {}) {
  const value = record?.value ?? record;
  const text = String(key);
  const parts = text.split(':');
  const project = projects.find(p => p.id === value?.projectId || p.id === text || parts.includes(String(p.id)));
  const repo = project?.repos?.find(r => r.id === value?.repoId || parts.includes(String(r.id)));
  const projectName = readable(project?.name) || readable(value?.projectName);
  const repository = readable(metadata?.repoName) || readable(value?.repoName) || readable(value?.repository)
    || readable(repo?.repoName) || (repo?.owner && repo?.repo ? `${repo.owner}/${repo.repo}` : readable(repo?.name));
  let type = category;
  if (/^cba:/.test(text)) {
    type = parts[3] === 'metadata' ? 'Analysis details'
      : parts[3] === 'functional-work' ? 'Functional processing checkpoint'
      : parts[3] === 'run' ? (parts.length > 4 ? 'Saved analysis checkpoint' : 'Analysis run')
      : parts.length === 3 ? 'Functional decomposition' : 'Saved architecture data';
  } else if (/^cbaMeta:/.test(text)) type = 'Analysis details';
  else if (/diagram|layout/i.test(text)) type = 'Diagram layout';
  else if (/checkpoint/i.test(text)) type = 'Analysis checkpoint';
  else if (/hazard/i.test(text)) type = 'Hazard analysis';
  else if (/review/i.test(text)) type = 'Review decisions';
  const title = readable(value?.name) || readable(value?.title) || readable(value?.label);
  const owner = projectName || repository || title;
  const rawDate = value?.updatedAt || value?.publishedAt || value?.createdAt || metadata?.updatedAt || metadata?.publishedAt || metadata?.generatedAt;
  const date = rawDate && !Number.isNaN(new Date(rawDate).getTime()) ? new Date(rawDate).toLocaleString() : '';
  return {
    key,
    label: owner ? `${owner} — ${type}` : `${type} — saved item ${ordinal}`,
    detail: [repository && repository !== owner ? repository : '', title && title !== owner ? title : '', date ? `Saved ${date}` : ''].filter(Boolean).join(' · '),
  };
}

// Key cursors never clone stored payloads, including legacy whole-record analyses.
// Project/repository labels come from the already loaded workspace metadata.
export function readStoragePage(db, storeName, after, limit = 50, context = {}) {
  return new Promise((resolve, reject) => {
    const items = [];
    let nextKey, tx, finished = false, scanned = 0;
    const { signal } = context;
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve({ items, nextKey });
    };
    const stop = message => {
      finish(new Error(message));
      try { tx?.abort(); } catch {}
    };
    const cancel = () => stop('Storage listing cancelled.');
    const timer = setTimeout(() => stop('Storage listing timed out. Please retry.'), 5000);
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const hazardListing = storeName === 'hazardAnalysisRuns' || storeName === 'runMetadata';
      const hasMetadata = hazardListing && db.objectStoreNames?.contains('runMetadata');
      tx = db.transaction(hasMetadata ? Array.from(new Set([storeName, 'runMetadata'])) : storeName, 'readonly');
      const request = tx.objectStore(storeName).openKeyCursor(after === undefined ? null : IDBKeyRange.lowerBound(after, true));
      request.onsuccess = () => {
        if (finished) return;
        try {
          const cursor = request.result;
          if (!cursor) return;
          // A page bounds cursor work as well as visible entries. Preserve the
          // last consumed key so a sparse page can continue without skipping data.
          if (items.length === limit) { nextKey = items[items.length - 1].key; return; }
          scanned++;
          if (typeof cursor.primaryKey === 'string' && cursor.primaryKey.includes(':$part:')) {
            if (scanned >= 500) { nextKey = cursor.primaryKey; return; }
            const prefix = cursor.primaryKey.slice(0, cursor.primaryKey.indexOf(':$part:') + ':$part:'.length);
            // ':' -> ';' is the exclusive upper bound of every suffix under
            // this prefix, including suffixes containing U+FFFF.
            cursor.continue(prefix.slice(0, -1) + ';'); return;
          }
          const append = metadata => {
            if (finished) return;
            const item = describeStorageItem(cursor.primaryKey, metadata, {...context, ordinal:(context.offset || 0) + items.length + 1});
            if (hazardListing && !context.projects?.some(project => project.id === metadata?.projectId)) {
              item.detail = [item.detail, 'Project unavailable; verify this record before deleting.'].filter(Boolean).join(' · ');
            }
            items.push(item);
            if (scanned >= 500) { nextKey = cursor.primaryKey; return; }
            cursor.continue();
          };
          if (hasMetadata) {
            const lookup = tx.objectStore('runMetadata').get(cursor.primaryKey);
            lookup.onsuccess = () => { try { append(lookup.result); } catch (error) { stop(error.message); } };
            lookup.onerror = () => stop(lookup.error?.message || 'Unable to read saved analysis labels.');
          } else append(null);
        } catch (error) { stop(error?.message || 'Unable to list storage.'); }
      };
      request.onerror = () => stop(request.error?.message || 'Unable to list storage.');
      tx.oncomplete = () => finish();
      tx.onabort = () => finish(tx.error || new Error('Storage read was aborted.'));
      tx.onerror = () => stop(tx.error?.message || 'Unable to list storage.');
    } catch (error) { stop(error?.message || 'Unable to list storage.'); }
  });
}

export function deleteStorageRecords(db, storeName, keys) {
  return new Promise((resolve, reject) => {
    // Keep the hazard-run metadata index consistent with its payload store.
    const paired = storeName === 'hazardAnalysisRuns' ? 'runMetadata' : storeName === 'runMetadata' ? 'hazardAnalysisRuns' : null;
    const chunkStore=paired && db.objectStoreNames.contains('hazardRunChunks') ? 'hazardRunChunks' : null;
    const stagingStore=paired && db.objectStoreNames.contains('hazardRunStaging') ? 'hazardRunStaging' : null;
    const stores = [storeName, ...(paired && db.objectStoreNames.contains(paired) ? [paired] : []), ...(chunkStore?[chunkStore]:[]), ...(stagingStore?[stagingStore]:[])];
    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error('Storage deletion was aborted.'));
    tx.onerror = () => {};
    // Chunks may be shared by recovery checkpoints. Individual deletion only
    // removes the logical record; category cleanup can reclaim all its chunks.
    for (const name of stores) {
      const store = tx.objectStore(name);
      if (keys === null) store.clear();
      else if(name===chunkStore || name===stagingStore){
        for(const key of keys){const request=store.index('runId').openCursor(key);request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.delete();cursor.continue();}};}
      }else keys.forEach(key => store.delete(key));
    }
  });
}
