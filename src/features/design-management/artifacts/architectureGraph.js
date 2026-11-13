export { layoutArchitecture, architectureSVG } from './architectureLayout';
export async function architectureImage(diagram) {
  const { nativeArchitectureImage } = await import('./nativeArchitectureExport');
  return nativeArchitectureImage(diagram);
}
export async function downloadArchitecture(diagram) {
  const image = await architectureImage(diagram);
  const anchor = document.createElement('a'); anchor.href = image.data; anchor.download = `${diagram.title.replace(/[^a-z0-9_-]+/gi, '-')}.png`; anchor.click();
}
