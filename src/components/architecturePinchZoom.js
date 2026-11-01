// Preserve React Flow's pinch scale, anchor and limits, but present a large
// overview step over several frames instead of applying it in one jump.
export const PINCH_ANIMATING = 'data-pinch-animating';
export function createArchitecturePinchZoom(host, store) {
  const win = host.ownerDocument.defaultView;
  if (!win.requestAnimationFrame) return () => {};
  const reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let pending = null, frame = null, writing = false;
  let observedTransform = store.getState().transform;
  const cancel = () => {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null; pending = null;
    host.removeAttribute(PINCH_ANIMATING);
  };
  const transform = (base, x, y, k) => base.translate((x - base.x) / base.k, (y - base.y) / base.k).scale(k / base.k);
  const schedule = () => { if (frame === null) frame = win.requestAnimationFrame(draw); };
  function draw(time, finishImmediately = false) {
    frame = null;
    const next = pending, state = store.getState();
    if (!next) return;
    if (state.d3Selection !== next.selection || state.userSelectionActive) { cancel(); return; }
    // Count rendered-frame time. A busy first frame must not consume the
    // entire transition and make the next visible frame jump to its endpoint.
    next.elapsed += next.time === null ? 1000 / 60 : Math.min(32, Math.max(0, time - next.time));
    next.time = time;
    const progress = finishImmediately || !next.animate || reducedMotion?.matches ? 1 : Math.min(1, next.elapsed / 100);
    const { from, target } = next;
    const k = progress === 1 ? target.k : from.k * Math.pow(target.k / from.k, progress);
    // Interpolate translation in scale space to keep the world point under
    // the cursor fixed, rather than independently easing x/y and zoom.
    const ratio = Math.abs(target.k - from.k) < 1e-12 ? progress : (k - from.k) / (target.k - from.k);
    const camera = progress === 1 ? target : transform(from, from.x + (target.x - from.x) * ratio, from.y + (target.y - from.y) * ratio, k);
    // D3 starts a gesture for each transform and normally re-reads clientWidth/
    // clientHeight. Reuse the extent measured before motion styling, avoiding
    // a forced layout between animation frames. Restore the native accessor
    // immediately so other controls keep their existing behavior.
    const extent = state.d3Zoom.extent();
    writing = true;
    try {
      state.d3Zoom.extent(next.extent);
      state.d3Zoom.transform(next.selection, camera, next.anchor, next.event);
    } finally { state.d3Zoom.extent(extent); writing = false; }
    if (pending === next) {
      if (progress === 1) { pending = null; host.removeAttribute(PINCH_ANIMATING); }
      else schedule();
    }
  }
  const finish = () => {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
    // Losing focus or resizing ends animation, not the user's requested zoom.
    // Native wheel handling would already have applied these deltas. Complete
    // them once so a focus/size change cannot corrupt a rapid reversal.
    if (pending) draw(win.performance.now(), true);
    host.removeAttribute('data-viewport-moving');
  };
  const wheel = event => {
    if (!event.ctrlKey) { cancel(); return; }
    if (event.defaultPrevented || event.target.closest?.('.nowheel')) return;
    const state = store.getState(), selection = state.d3Selection, zoom = state.d3Zoom;
    const renderer = selection?.node();
    if (!renderer || !zoom || state.userSelectionActive || state.paneDragging || !renderer.contains(event.target)) return;
    const current = selection.property('__zoom');
    if (!current || (!pending && current.k > .2)) return;
    const delta = zoom.wheelDelta().call(renderer, event);
    if (!Number.isFinite(delta) || delta === 0) return;
    const [minimum, maximum] = zoom.scaleExtent();
    const base = pending?.target || current;
    const k = Math.max(minimum, Math.min(maximum, base.k * Math.pow(2, delta)));
    const box = renderer.getBoundingClientRect();
    const anchor = [event.clientX - box.left - renderer.clientLeft, event.clientY - box.top - renderer.clientTop];
    const ratio = k / base.k;
    const candidate = transform(base, anchor[0] - (anchor[0] - base.x) * ratio, anchor[1] - (anchor[1] - base.y) * ratio, k);
    const extent = zoom.extent().call(renderer);
    const target = zoom.constrain()(candidate, extent, zoom.translateExtent());
    event.preventDefault(); event.stopPropagation();
    const animate = pending?.animate || Math.abs(Math.log(target.k / current.k)) > .08;
    // Accumulate against the requested camera, not an intermediate painted
    // camera: coalescing, reversals and moving anchors must retain every delta.
    pending = { from: current, target, selection, anchor, extent, event, animate, elapsed: 0, time: null };
    if (!host.hasAttribute(PINCH_ANIMATING)) host.setAttribute(PINCH_ANIMATING, '');
    schedule();
  };
  const unsubscribe = store.subscribe(state => {
    if (state.transform !== observedTransform) {
      observedTransform = state.transform;
      if (!writing) cancel(); // Fit View, buttons, dragging and external navigation win.
    }
  });
  host.addEventListener('wheel', wheel, { capture: true, passive: false });
  host.addEventListener('pointerdown', cancel, true);
  win.addEventListener('keydown', cancel, true);
  win.addEventListener('blur', finish);
  win.addEventListener('resize', finish);
  host.ownerDocument.addEventListener('visibilitychange', finish);
  return () => {
    cancel(); unsubscribe();
    host.removeEventListener('wheel', wheel, true);
    host.removeEventListener('pointerdown', cancel, true);
    win.removeEventListener('keydown', cancel, true);
    win.removeEventListener('blur', finish);
    win.removeEventListener('resize', finish);
    host.ownerDocument.removeEventListener('visibilitychange', finish);
  };
}
