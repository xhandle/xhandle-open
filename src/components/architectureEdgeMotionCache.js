// A bounded image replaces only connection paint during camera motion.
// The native SVG remains authoritative for editing, accessibility and exports.
const NS = 'http://www.w3.org/2000/svg';
export const EDGE_IMAGE_CLASS = 'x-edge-motion-image';
export const EDGE_IMAGE_ACTIVE = 'data-edge-image-active';
export const EDGE_IMAGE_LIMITS = { bytes: 8 * 1024 * 1024, pixels: 16 * 1024 * 1024, side: 8192, layers: 8 };
const PAINT = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'visibility', 'filter', 'marker-start', 'marker-end', 'marker-mid', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'paint-order'];
const SUPPORTED = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc']);
const contains = (outer, inner) => inner.width <= 0 || inner.height <= 0 || (outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height);
const intersect = (a, b) => ({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) });
const expand = (b, x, y = x) => ({ x: b.x - x, y: b.y - y, width: b.width + 2 * x, height: b.height + 2 * y });
export const cameraBounds = ([x, y, zoom], width, height) => ({ x: -x / zoom, y: -y / zoom, width: width / zoom, height: height / zoom });
export function alignImageBounds(bounds, camera, zoom, dpr) {
  // Match the native scene's device-pixel grid. Rounding only the SVG's
  // intrinsic size rescales thin strokes twice, changing overview opacity.
  const scale = zoom * dpr;
  const left = Math.floor((bounds.x - camera.x) * scale), top = Math.floor((bounds.y - camera.y) * scale);
  const right = Math.ceil((bounds.x + bounds.width - camera.x) * scale), bottom = Math.ceil((bounds.y + bounds.height - camera.y) * scale);
  return { bounds: { x: camera.x + left / scale, y: camera.y + top / scale, width: (right - left) / scale, height: (bottom - top) / scale }, width: right - left, height: bottom - top };
}
export function imageFitsCamera(image, camera, zoom, dpr = 1) {
  const width = image.bounds.width * zoom * dpr, height = image.bounds.height * zoom * dpr;
  return contains(image.bounds, intersect(camera, image.scene)) && width <= EDGE_IMAGE_LIMITS.side && height <= EDGE_IMAGE_LIMITS.side && width * height <= EDGE_IMAGE_LIMITS.pixels;
}
export function vectorMarkupForBounds(scene, bounds) {
  // Bounds come from the complete rendered SVG path, including manual detours;
  // endpoint-only culling would lose connections crossing the viewport.
  return scene.definitions + scene.prefix + scene.entries.filter(entry => {
    const overlap = intersect(bounds, entry.bounds);
    return overlap.width > 0 && overlap.height > 0;
  }).map(entry => entry.markup).join('') + '</g>';
}

// Restrict references to definitions in this diagram. No external image/font/
// stylesheet is fetched by an acceleration image. Unsupported SVG stays native.
export function localPaintReference(value) {
  if (!value.includes('url(')) return value;
  const match = /^url\((.*)\)$/.exec(value);
  if (!match) throw new Error('Unsupported edge paint reference');
  const address = match[1].trim().replace(/^(["'])(.*)\1$/, '$2');
  const hash = address.indexOf('#');
  if (hash < 0) throw new Error('Unsupported edge paint reference');
  const id = address.slice(hash + 1);
  // React Flow emits url('#') for an absent start/end marker.
  return id ? `url("#${id}")` : 'none';
}

export function createArchitectureEdgeMotionCache(host, store, options = {}) {
  const doc = host.ownerDocument, win = doc.defaultView;
  if (!win.MutationObserver || !win.URL.createObjectURL || !win.XMLSerializer) return () => {};
  let disposed = false, generation = 0, timer = null, building = false, images = [], sceneMarkup = null, blocked = false;
  let pending = null;
  const state = () => store.getState();
  const moving = () => host.hasAttribute('data-viewport-moving');
  const viewport = () => cameraBounds(state().transform, state().width, state().height);
  const restore = () => images.forEach(image => { image.svg.removeAttribute(EDGE_IMAGE_ACTIVE); image.element.removeAttribute(EDGE_IMAGE_ACTIVE); });
  const release = () => {
    restore();
    images.forEach(image => { image.element.remove(); win.URL.revokeObjectURL(image.url); });
    images = [];
    host.removeAttribute('data-edge-images-ready');
  };
  const pause = () => new Promise(resolve => win.setTimeout(resolve, 0));
  const valid = epoch => !disposed && epoch === generation;
  const abortPending = () => { pending?.(); pending = null; };
  const imageLoaded = element => new Promise((resolve, reject) => {
    const timeout = win.setTimeout(() => finish(new Error('Edge image load timed out')), 3000);
    const finish = error => {
      win.clearTimeout(timeout); element.onload = null; element.onerror = null; pending = null;
      error ? reject(error) : resolve();
    };
    pending = () => finish(new Error('Edge image invalidated'));
    element.onload = () => finish(); element.onerror = () => finish(new Error('Edge image failed'));
  });
  const needsImage = () => {
    if (!sceneMarkup) return true;
    const camera = viewport(), preview = expand(camera, camera.width * .08, camera.height * .08);
    return sceneMarkup.some(scene => {
      const visible = intersect(preview, scene.scene);
      return visible.width > 0 && visible.height > 0 && !images.some(image => image.svg === scene.svg && imageFitsCamera(image, preview, state().transform[2] * 1.08, win.devicePixelRatio || 1));
    });
  };
  const update = () => {
    const current = state(), camera = viewport(), dpr = win.devicePixelRatio || 1;
    const chosen = new Map();
    for (const image of images) {
      if (!imageFitsCamera(image, camera, current.transform[2], dpr)) continue;
      const previous = chosen.get(image.svg);
      if (!previous || image.bounds.width * image.bounds.height < previous.bounds.width * previous.bounds.height) chosen.set(image.svg, image);
    }
    // Account for every layer together, not just each layer's individual cap.
    const pixels = [...chosen.values()].reduce((sum, image) => sum + image.bounds.width * image.bounds.height * (current.transform[2] * dpr) ** 2, 0);
    const active = moving() && pixels <= EDGE_IMAGE_LIMITS.pixels;
    for (const image of images) {
      const cachedLayer = active && chosen.has(image.svg), selected = cachedLayer && chosen.get(image.svg) === image;
      if (cachedLayer && !image.svg.hasAttribute(EDGE_IMAGE_ACTIVE)) image.svg.setAttribute(EDGE_IMAGE_ACTIVE, '');
      else if (!cachedLayer && image.svg.hasAttribute(EDGE_IMAGE_ACTIVE)) image.svg.removeAttribute(EDGE_IMAGE_ACTIVE);
      if (selected && !image.element.hasAttribute(EDGE_IMAGE_ACTIVE)) image.element.setAttribute(EDGE_IMAGE_ACTIVE, '');
      else if (!selected && image.element.hasAttribute(EDGE_IMAGE_ACTIVE)) image.element.removeAttribute(EDGE_IMAGE_ACTIVE);
    }
  };
  const schedule = (restart = true) => {
    if (timer && !restart) return;
    win.clearTimeout(timer);
    if (!disposed && !blocked) timer = win.setTimeout(() => { timer = null; build(); }, moving() ? 40 : options.delay ?? 180);
  };
  const invalidate = () => {
    generation++; abortPending(); release(); sceneMarkup = null; blocked = false; host.removeAttribute('data-edge-image-fallback'); schedule();
  };
  async function capture(epoch) {
    const svgs = [...host.querySelectorAll('svg.react-flow__edges:not(.react-flow__connectionline)')];
    if (!svgs.length || svgs.length > EDGE_IMAGE_LIMITS.layers) throw new Error('Unsupported edge layer count');
    const defs = [...host.querySelectorAll('svg defs')].map(def => def.cloneNode(true));
    // No foreignObject, scripts, images or external resources in snapshots.
    if (defs.some(def => [...def.querySelectorAll('*')].some(node => !['marker', 'g', 'path', 'polyline', 'polygon', 'circle', 'rect', 'ellipse', 'line', 'title', 'desc'].includes(node.localName)))) throw new Error('Unsupported edge definition');
    const serialize = node => new win.XMLSerializer().serializeToString(node);
    const definitions = defs.map(serialize).join('');
    const result = []; let bytes = 0;
    for (const svg of svgs) {
      const group = svg.querySelector(':scope > g');
      if (!group) continue;
      if (group.hasAttribute('transform')) throw new Error('Unsupported edge layer transform');
      const box = group.getBBox();
      if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) throw new Error('Invalid edge bounds');
      // Generous marker/stroke margin. Unusually large paint remains native.
      const scene = expand(box, 256);
      const clone = group.cloneNode(true), originals = [group, ...group.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
      // Thousands of connections usually share the same computed paint. Store
      // those declarations once inside this image instead of repeating them on
      // every SVG element and exhausting the bounded markup budget.
      const paintClasses = new Map();
      for (let i = 0; i < originals.length; i++) {
        if (!valid(epoch) || moving()) return null;
        const original = originals[i], copy = copies[i];
        if (!SUPPORTED.has(original.localName)) throw new Error('Unsupported edge element');
        if (original.matches('.react-flow__edge-interaction')) continue;
        const css = win.getComputedStyle(original);
        // Detailed views already pause edge animation during camera motion.
        // Aggregate highlights keep animating, so a static snapshot must not
        // replace them. Clearing the highlight invalidates/re-enables caching.
        if (!host.classList.contains('x-csu-large') && css.animationName && css.animationName !== 'none') throw new Error('Animated edge paint stays native');
        if (parseFloat(css.strokeWidth) > 32 || (css.mixBlendMode && css.mixBlendMode !== 'normal') || (css.clipPath && css.clipPath !== 'none') || (css.maskImage && css.maskImage !== 'none') || (css.vectorEffect && css.vectorEffect !== 'none')) throw new Error('Unsupported edge effect');
        for (const name of PAINT) {
          if (original.localName === 'g' && !['opacity', 'visibility', 'filter'].includes(name)) continue;
          if (['font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline'].includes(name) && !['text', 'tspan'].includes(original.localName)) continue;
          let value = css.getPropertyValue(name);
          // Match the existing large-detailed motion presentation.
          if (name === 'filter' && host.classList.contains('x-csu-large') && original.matches('.react-flow__edge,.react-flow__edge-path')) value = 'none';
          if (value) {
            const local = localPaintReference(value);
            if (local.startsWith('url(')) {
              const id = local.slice(6, -2);
              let decoded = id;
              try { decoded = decodeURIComponent(id); } catch (_) { /* literal custom ID */ }
              if (!host.contains(doc.getElementById(decoded) || doc.getElementById(id))) throw new Error('Missing local paint definition');
            }
            copy.style.setProperty(name, local);
          }
        }
        copy.removeAttribute('class'); // All paint is captured; no external CSS.
        // Accessibility and interaction stay on the native SVG. Repeating its
        // descriptive metadata inside a non-interactive paint image wastes the
        // same bounded budget; retain only the test identity among data fields.
        for (const attribute of [...copy.attributes]) {
          if (attribute.name.startsWith('aria-') || ['tabindex', 'role', 'focusable'].includes(attribute.name)
            || (attribute.name.startsWith('data-') && attribute.name !== 'data-testid')) copy.removeAttribute(attribute.name);
        }
        const paint = copy.getAttribute('style');
        if (paint) {
          let name = paintClasses.get(paint);
          if (!name) { name = `x-edge-paint-${paintClasses.size}`; paintClasses.set(paint, name); }
          copy.setAttribute('class', name);
          copy.removeAttribute('style');
        }
        if (i % 80 === 79) await pause();
      }
      // These transparent paths have no visual content. Native hit targets stay
      // in the document and are restored before a new editing interaction.
      originals.forEach((original, i) => {
        if (original.matches('.react-flow__edge-interaction') || (host.classList.contains('x-csu-large') && original.matches('.react-flow__edge-textwrapper'))) copies[i].remove();
      });
      const entries = [];
      for (let i = 0; i < group.children.length; i++) {
        if (!valid(epoch) || moving()) return null;
        entries.push({ bounds: expand(group.children[i].getBBox(), 256), markup: serialize(clone.children[i]) });
        if (i % 80 === 79) await pause();
      }
      const empty = clone.cloneNode(false);
      const prefix = serialize(empty).replace(/\/>$/, '>').replace(/<\/g>$/, '');
      const paintSheet = doc.createElementNS(NS, 'style');
      // XML serialization escapes the CSS text, including any quoted font
      // names. The declarations were normalized by CSSStyleDeclaration above;
      // URL-bearing paint has already been restricted to local definitions.
      paintSheet.textContent = [...paintClasses].map(([paint, name]) => `.${name}{${paint}}`).join('');
      const imageDefinitions = definitions + (paintClasses.size ? serialize(paintSheet) : '');
      bytes += new Blob([imageDefinitions, prefix, ...entries.map(entry => entry.markup), '</g>']).size;
      if (bytes > EDGE_IMAGE_LIMITS.bytes) throw new Error('Edge image budget exceeded');
      result.push({ svg, scene, definitions: imageDefinitions, prefix, entries });
    }
    return result;
  }
  async function build() {
    // Initial DOM/style capture waits for idle. Reframing existing vector markup
    // uses no graph reads and can prepare the next region during a long gesture.
    if (disposed || blocked || (moving() && !sceneMarkup) || building || !state().width || !state().height) return;
    const camera = viewport(), zoom = state().transform[2], dpr = win.devicePixelRatio || 1;
    if (!needsImage()) return;
    if (sceneMarkup && sceneMarkup.every(scene => { const part = intersect(camera, scene.scene); return part.width <= 0 || part.height <= 0; })) return;
    building = true;
    const epoch = generation;
    const prepared = [];
    try {
      if (!sceneMarkup) {
        const captured = await capture(epoch);
        if (!valid(epoch)) return;
        sceneMarkup = captured;
      }
      if (!valid(epoch) || !sceneMarkup) return;
      let pixels = 0;
      for (const scene of sceneMarkup) {
        const region = intersect(expand(camera, camera.width * .4, camera.height * .4), scene.scene);
        if (region.width <= 0 || region.height <= 0) continue;
        const { bounds, width, height } = alignImageBounds(region, camera, zoom, dpr);
        pixels += width * height;
        if (width > EDGE_IMAGE_LIMITS.side || height > EDGE_IMAGE_LIMITS.side || pixels > EDGE_IMAGE_LIMITS.pixels) throw new Error('Edge pixel budget exceeded');
        const svgText = `<svg xmlns="${NS}" width="${width}" height="${height}" preserveAspectRatio="none" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">${vectorMarkupForBounds(scene, bounds)}</svg>`;
        const url = win.URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
        // Use the normal HTML image compositing path. An SVG <image> at these
        // world dimensions caused expensive GPU raster work at overview zoom.
        const element = doc.createElement('img');
        element.classList.add(EDGE_IMAGE_CLASS); element.setAttribute('aria-hidden', 'true'); element.alt = ''; element.draggable = false;
        Object.assign(element.style, { position: 'absolute', left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, maxWidth: 'none', zIndex: scene.svg.style.zIndex });
        const image = { ...scene, bounds, element, url, overview: contains(bounds, scene.scene), pixels: width * height };
        prepared.push(image);
        const loaded = imageLoaded(element);
        element.src = url; scene.svg.parentNode.insertBefore(element, scene.svg.nextSibling);
        await loaded;
        if (!valid(epoch)) return;
      }
      if (!valid(epoch)) return;
      // Keep one full-scene overview alongside the current crop. Zooming back
      // out can reuse it without decoding every connection again. Retained
      // intrinsic pixels are capped at two budgets (plus one in-flight build).
      restore();
      let retainedPixels = prepared.reduce((sum, image) => sum + image.pixels, 0);
      const retained = images.filter(image => {
        const keep = image.overview && !prepared.some(next => next.svg === image.svg && next.overview) && retainedPixels + image.pixels <= EDGE_IMAGE_LIMITS.pixels * 2;
        if (keep) retainedPixels += image.pixels;
        else { image.element.remove(); win.URL.revokeObjectURL(image.url); }
        return keep;
      });
      images = [...retained, ...prepared.splice(0)];
      host.setAttribute('data-edge-images-ready', String(images.length));
      update();
    } catch (error) {
      // An optional display cache must never block or replace the native graph
      // on failure. Retry after geometry/theme/scope changes, not every frame.
      if (valid(epoch)) { blocked = true; release(); host.setAttribute('data-edge-image-fallback', error.message); }
    } finally {
      prepared.forEach(image => { image.element.remove(); win.URL.revokeObjectURL(image.url); });
      building = false;
      if (!disposed && (!valid(epoch) || (sceneMarkup && needsImage()))) schedule(false);
    }
  }
  const isCache = node => node.nodeType === 1 && (node.classList?.contains(EDGE_IMAGE_CLASS) || node.closest?.(`.${EDGE_IMAGE_CLASS}`));
  const mutations = new win.MutationObserver(records => {
    const changed = records.some(record => {
      if (record.type === 'attributes' && [EDGE_IMAGE_ACTIVE, 'data-edge-images-ready', 'data-viewport-moving'].includes(record.attributeName)) return false;
      if (isCache(record.target)) return false;
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(isCache)) return false;
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      return target?.closest?.('svg.react-flow__edges,svg[data-architecture-markers]') || (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.matches?.('svg.react-flow__edges') || node.querySelector?.('svg.react-flow__edges'))));
    });
    if (changed) invalidate();
    else { update(); if (!moving()) schedule(); }
  });
  mutations.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
  const theme = new win.MutationObserver(invalidate);
  theme.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  theme.observe(doc.body, { attributes: true, attributeFilter: ['class', 'style'] });
  let lastTransform = state().transform, width = state().width, height = state().height;
  const unsubscribe = store.subscribe(current => {
    if (current.width !== width || current.height !== height) { width = current.width; height = current.height; invalidate(); }
    if (current.transform !== lastTransform) {
      lastTransform = current.transform;
      if (blocked && host.getAttribute('data-edge-image-fallback') === 'Edge pixel budget exceeded') { blocked = false; host.removeAttribute('data-edge-image-fallback'); }
      update(); if (!moving()) schedule(); else if (sceneMarkup && needsImage()) schedule(false);
    }
  });
  const nativeInteraction = event => {
    if (event.type === 'keydown' || event.button === 0 || event.button === 2) { host.removeAttribute('data-viewport-moving'); restore(); }
  };
  const suspend = () => { host.removeAttribute('data-viewport-moving'); restore(); };
  host.addEventListener('pointerdown', nativeInteraction, true);
  win.addEventListener('keydown', nativeInteraction, true);
  win.addEventListener('beforeprint', suspend);
  schedule();
  return () => {
    disposed = true; generation++; win.clearTimeout(timer); abortPending();
    mutations.disconnect(); theme.disconnect(); unsubscribe(); release(); sceneMarkup = null; host.removeAttribute('data-edge-image-fallback');
    host.removeEventListener('pointerdown', nativeInteraction, true); win.removeEventListener('keydown', nativeInteraction, true);
    win.removeEventListener('beforeprint', suspend);
  };
}
