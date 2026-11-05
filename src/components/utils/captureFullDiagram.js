import { toPng } from 'html-to-image';

// Bound the backing canvas even on Retina displays and enormous diagrams.
export const REPORT_CAPTURE_MAX_SIDE = 4096;
export const REPORT_CAPTURE_MAX_PIXELS = 8 * 1024 * 1024;

export function diagramCaptureGeometry(bounds, padding = 40) {
  const paddedWidth = bounds.width + padding * 2;
  const paddedHeight = bounds.height + padding * 2;
  const targetScale = Math.min(1, REPORT_CAPTURE_MAX_SIDE / paddedWidth,
    REPORT_CAPTURE_MAX_SIDE / paddedHeight,
    Math.sqrt(REPORT_CAPTURE_MAX_PIXELS / (paddedWidth * paddedHeight)));
  const width = Math.max(1, Math.floor(paddedWidth * targetScale));
  const height = Math.max(1, Math.floor(paddedHeight * targetScale));
  const scale = Math.min(targetScale, width / paddedWidth, height / paddedHeight);
  return {
    width, height,
    transform: `translate(${(padding - bounds.x) * scale}px, ${(padding - bounds.y) * scale}px) scale(${scale})`,
  };
}

export function fullDiagramBounds(viewport, zoom) {
  if (!viewport || !Number.isFinite(zoom) || zoom <= 0) return null;
  const origin = viewport.getBoundingClientRect();
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  // Rendered rectangles include nested system/subsystem positions. Include
  // routed paths and labels, which can extend beyond the outermost nodes.
  const elements = viewport.querySelectorAll('.react-flow__node, .react-flow__edge-path, .react-flow__edge-textwrapper, .react-flow__edgelabel-renderer > *');
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || (!rect.width && !rect.height)) continue;
    left = Math.min(left, (rect.left - origin.left) / zoom);
    top = Math.min(top, (rect.top - origin.top) / zoom);
    right = Math.max(right, (rect.right - origin.left) / zoom);
    bottom = Math.max(bottom, (rect.bottom - origin.top) / zoom);
  }
  return Number.isFinite(left) ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

export async function captureFullDiagram(flowCanvas, zoom) {
  const viewport = flowCanvas?.querySelector('.react-flow__viewport');
  const bounds = fullDiagramBounds(viewport, zoom);
  if (!bounds) return null;
  const geometry = diagramCaptureGeometry(bounds);
  // html-to-image applies these overrides to its clone. Never fit, pan, zoom,
  // resize, or temporarily restyle the user's live diagram for a report.
  return toPng(viewport, {
    backgroundColor: '#ffffff',
    width: geometry.width, height: geometry.height,
    pixelRatio: 1,
    filter: (node) => !node.classList?.contains('react-flow__nodesselection') &&
      !node.classList?.contains('react-flow__selection'),
    style: {
      transform: geometry.transform, transformOrigin: '0 0',
      position: 'relative', top: '0', left: '0', margin: '0',
      overflow: 'visible', visibility: 'visible', willChange: 'auto',
    },
  });
}
