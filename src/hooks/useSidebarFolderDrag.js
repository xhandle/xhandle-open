import { useState } from 'react';
import { moveFolder } from '../lib/folderOrder';

export default function useSidebarFolderDrag(setFolders, scope, setOpenFolders) {
  const [dragged, setDragged] = useState(null);
  const [target, setTarget] = useState(null);
  const clear = () => { setDragged(null); setTarget(null); };
  const position = event => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = (event.clientY - bounds.top) / bounds.height;
    return offset < 0.25 ? 'before' : offset > 0.75 ? 'after' : 'inside';
  };
  const rootOver = event => {
    if (!dragged) return false;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = 'move'; setTarget(null);
    return true;
  };
  const rootDrop = event => {
    if (!dragged) return false;
    event.preventDefault(); event.stopPropagation();
    setFolders(items => moveFolder(items, dragged)); clear();
    return true;
  };
  return {
    rootOver, rootDrop, isDragging: !!dragged,
    // Make the actual interactive element a drag source. In particular, WebKit
    // does not reliably start ancestor dragging from a native button.
    sourceProps: {
      draggable: true,
      style: { WebkitUserDrag: 'element', userSelect: 'none', cursor: 'grab' },
    },
    headerProps: (folder, editing, depth = 0) => ({
      draggable: !editing,
      style: {
        paddingLeft: depth * 12,
        opacity: dragged === folder.id ? 0.5 : undefined,
        boxShadow: target?.id === folder.id
          ? target.position === 'inside' ? 'inset 0 0 0 2px #2D7DFE'
            : `inset 0 ${target.position === 'before' ? 2 : -2}px #2D7DFE` : undefined,
        backgroundColor: target?.id === folder.id && target.position === 'inside' ? '#eff6ff' : undefined,
      },
      onDragStart: event => {
        event.stopPropagation(); setDragged(folder.id); setTarget(null);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(`application/x-xhandle-${scope}-folder-id`, folder.id);
        event.dataTransfer.setData('text/plain', folder.name);
      },
      onDragEnd: clear,
      onDragOver: event => {
        if (!dragged) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setTarget(dragged === folder.id ? null : { id: folder.id, position: position(event) });
      },
      onDragLeave: event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setTarget(null);
      },
      onDrop: event => {
        if (!dragged) return;
        event.preventDefault(); event.stopPropagation();
        const placement = position(event);
        setFolders(items => moveFolder(items, dragged, folder.id, placement));
        if (placement === 'inside' && dragged !== folder.id) setOpenFolders?.(items => ({ ...items, [folder.id]: true }));
        clear();
      },
    }),
  };
}
