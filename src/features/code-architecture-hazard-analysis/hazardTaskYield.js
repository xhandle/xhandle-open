// Async checkpoint reads alone do not guarantee a browser task boundary: cached
// reads resolve as microtasks. Long preflight loops must explicitly service input.
export function createHazardTaskYield(signal, budgetMs = 8) {
  let last = performance.now();
  return async () => {
    if (signal?.aborted) throw new DOMException('Hazard analysis cancelled.', 'AbortError');
    if (performance.now() - last < budgetMs) return;
    await new Promise(resolve => setTimeout(resolve, 0));
    last = performance.now();
    if (signal?.aborted) throw new DOMException('Hazard analysis cancelled.', 'AbortError');
  };
}
