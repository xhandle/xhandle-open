import { captureFullDiagram } from './captureFullDiagram';

// Re-evaluate the snapshot's original CSS in an isolated document. Do not flip
// the app theme, invert bitmap colors or replace authored node/edge paint.
export async function captureReportDiagramImages(flowCanvas, zoom) {
  if (!flowCanvas?.querySelector('.react-flow__viewport')) return null;
  const source = flowCanvas.ownerDocument;
  const frame = source.createElement('iframe');
  frame.title = 'Report diagram capture';
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: 'fixed', left: '-100000px', top: '0',
    width: `${source.defaultView.innerWidth}px`, height: `${source.defaultView.innerHeight}px`,
    border: '0', pointerEvents: 'none' });
  source.body.append(frame);
  const cleanup = [];
  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error('The report capture document is unavailable.');
    const base = doc.createElement('base'); base.href = source.baseURI; doc.head.append(base);
    const pending = [];
    for (const sheet of source.querySelectorAll('style,link[rel="stylesheet"]')) {
      const copy = sheet.cloneNode(true);
      if (copy.tagName === 'LINK') pending.push(new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Report diagram styles timed out.')), 15000);
        cleanup.push(() => { clearTimeout(timer); copy.onload = null; copy.onerror = null; });
        copy.onload = () => { clearTimeout(timer); resolve(); };
        copy.onerror = () => { clearTimeout(timer); reject(new Error('Report diagram styles could not be loaded.')); };
      }));
      doc.head.append(copy);
    }
    // Preserve selectors and inherited layout along the captured scene's path.
    const scene = flowCanvas.cloneNode(true);
    if (flowCanvas.clientWidth) scene.style.width = `${flowCanvas.clientWidth}px`;
    if (flowCanvas.clientHeight) scene.style.height = `${flowCanvas.clientHeight}px`;
    let branch = scene;
    for (let ancestor = flowCanvas.parentElement; ancestor && ancestor !== source.body; ancestor = ancestor.parentElement) {
      const wrapper = ancestor.cloneNode(false);
      wrapper.removeAttribute('data-viewport-moving'); wrapper.append(branch); branch = wrapper;
    }
    doc.body.className = source.body.className;
    doc.body.append(branch);
    // A snapshot is inert even when labels contain HTML supplied by the user.
    doc.querySelectorAll('script,iframe,object,embed').forEach(el => el.remove());
    const motion = doc.createElement('style');
    motion.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    doc.head.append(motion);
    // Attach rejection handlers immediately, including stylesheet failures.
    await Promise.all(pending);
    await doc.fonts?.ready;
    const images = {};
    for (const mode of ['light', 'dark']) {
      doc.documentElement.classList.toggle('dark', mode === 'dark');
      doc.documentElement.dataset.theme = mode;
      doc.documentElement.style.colorScheme = mode;
      images[mode] = await captureFullDiagram(scene, zoom);
    }
    return images.light && images.dark ? images : null;
  } finally { cleanup.forEach(dispose => dispose()); frame.remove(); }
}
