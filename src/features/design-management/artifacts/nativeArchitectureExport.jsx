import React, { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import NativeArchitectureDiagram from './NativeArchitectureDiagram';
import NativeCodeArchitectureDiagram from './NativeCodeArchitectureDiagram';

// Render the saved revision with the same canvas used on screen. Its storage is
// isolated, so exporting never reads or writes the current owning project.
export async function nativeArchitectureImage(diagram) {
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-12000px', top: '0', width: '1600px', height: '1000px', pointerEvents: 'none' });
  document.body.appendChild(host);
  const root = createRoot(host), ref = createRef();
  try {
    const Canvas = diagram.workspaceType === 'code-architecture' ? NativeCodeArchitectureDiagram : NativeArchitectureDiagram;
    root.render(<Canvas ref={ref} diagram={diagram} />);
    const deadline = Date.now() + 15000;
    while (!ref.current?.isReady()) {
      if (Date.now() > deadline) throw new Error('The architecture diagram could not finish rendering. Retry the export.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const data = await ref.current.getPNG();
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Could not export the architecture diagram.')); image.src = data; });
    return { data, width: image.naturalWidth, height: image.naturalHeight };
  } finally { root.unmount(); host.remove(); }
}
