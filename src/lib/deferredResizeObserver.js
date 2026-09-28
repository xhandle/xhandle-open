/** Defer resize delivery to avoid layout feedback, while honoring native teardown. */
export function installDeferredResizeObserver(target) {
  if (!target || typeof target.ResizeObserver !== 'function') return;
  const NativeResizeObserver = target.ResizeObserver;
  target.ResizeObserver = class ResizeObserver extends NativeResizeObserver {
    constructor(callback) {
      const observed = new Set();
      const pending = new Map();
      let frameId = null;
      const cancelPending = () => {
        if (frameId !== null) target.cancelAnimationFrame(frameId);
        frameId = null;
        pending.clear();
      };
      super((entries, observer) => {
        entries.forEach(entry => {
          if (observed.has(entry.target)) pending.set(entry.target, entry);
        });
        if (!pending.size || frameId !== null) return;
        frameId = target.requestAnimationFrame(() => {
          frameId = null;
          const delivery = [...pending.values()];
          pending.clear();
          if (delivery.length) callback.call(observer, delivery, observer);
        });
      });
      this.observe = (element, options) => {
        super.observe(element, options);
        observed.add(element);
      };
      this.unobserve = element => {
        super.unobserve(element);
        observed.delete(element);
        pending.delete(element);
        if (!pending.size) cancelPending();
      };
      this.disconnect = () => {
        super.disconnect();
        observed.clear();
        cancelPending();
      };
    }
  };
}
