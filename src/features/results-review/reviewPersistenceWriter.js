// At most one in-flight snapshot and one pending snapshot. Every pending
// caller waits for the newer snapshot that includes its already-applied edit.
export function createReviewPersistenceWriter(save) {
  let durable = null;
  let pending = null;
  let running = false;
  async function drain() {
    while (pending) {
      const batch = pending;
      pending = null;
      try {
        const result = await save(batch.items, durable);
        durable = result?.ok && result.durability === 'indexeddb' ? batch.items : null;
        batch.waiters.forEach(({ resolve }) => resolve(result));
      } catch (error) {
        durable = null;
        batch.waiters.forEach(({ reject }) => reject(error));
      }
    }
    running = false;
  }
  return items => new Promise((resolve, reject) => {
    if (pending) {
      pending.items = items;
      pending.waiters.push({ resolve, reject });
    } else pending = { items, waiters: [{ resolve, reject }] };
    if (!running) {
      running = true;
      Promise.resolve().then(drain);
    }
  });
}
