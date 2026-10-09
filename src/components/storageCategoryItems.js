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

// Read one page at a time; never hydrate analysis payloads or expose internal chunks.
export function readStoragePage(db, storeName, after, limit = 50, context = {}) {
  return new Promise((resolve, reject) => {
    const items = [];
    let nextKey;
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).openCursor(after === undefined ? null : IDBKeyRange.lowerBound(after, true));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (typeof cursor.primaryKey === 'string' && cursor.primaryKey.includes(':$part:')) {
        cursor.continue(cursor.primaryKey.split(':$part:')[0] + ':$part:\uffff'); return;
      }
      if (items.length === limit) { nextKey = items[items.length - 1].key; return; }
      const record = cursor.value;
      const append = metadata => {
        items.push(describeStorageItem(cursor.primaryKey, record, {...context, ordinal:(context.offset || 0) + items.length + 1}, metadata));
        cursor.continue();
      };
      const scope = typeof cursor.primaryKey === 'string' && cursor.primaryKey.match(/^(cba:[^:]+:[^:]+)/)?.[1];
      if (scope && cursor.primaryKey !== `${scope}:metadata`) {
        // Read only the small sibling metadata record, never hydrate the analysis.
        const lookup = tx.objectStore(storeName).get(`${scope}:metadata`);
        lookup.onsuccess = () => append(lookup.result?.value || lookup.result || {});
      } else append(record?.value || record || {});
    };
    tx.oncomplete = () => resolve({ items, nextKey });
    tx.onabort = () => reject(tx.error || new Error('Storage read was aborted.'));
    tx.onerror = () => {};
  });
}

export function deleteStorageRecords(db, storeName, keys) {
  return new Promise((resolve, reject) => {
    // Keep the hazard-run metadata index consistent with its payload store.
    const paired = storeName === 'hazardAnalysisRuns' ? 'runMetadata' : storeName === 'runMetadata' ? 'hazardAnalysisRuns' : null;
    const stores = [storeName, ...(paired && db.objectStoreNames.contains(paired) ? [paired] : [])];
    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error('Storage deletion was aborted.'));
    tx.onerror = () => {};
    // Chunks may be shared by recovery checkpoints. Individual deletion only
    // removes the logical record; category cleanup can reclaim all its chunks.
    for (const name of stores) {
      const store = tx.objectStore(name);
      if (keys === null) store.clear();
      else keys.forEach(key => store.delete(key));
    }
  });
}
