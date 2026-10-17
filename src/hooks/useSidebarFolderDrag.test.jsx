import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import useSidebarFolderDrag from './useSidebarFolderDrag';

global.IS_REACT_ACT_ENVIRONMENT = true;

test.each(['project', 'cba'])('%s folder dragging reorders headers without swallowing project drops', scope => {
  let api, rows;
  const setOpenFolders = jest.fn();
  function Harness() {
    const [folders, setFolders] = useState([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    api = useSidebarFolderDrag(setFolders, scope, setOpenFolders); rows = folders;
    return null;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(<Harness />));
  const event = () => ({ preventDefault: jest.fn(), stopPropagation: jest.fn(),
    dataTransfer: { setData: jest.fn() }, clientY: 5,
    currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 30 }) } });
  try {
    const unrelated = event();
    api.headerProps(rows[0], false).onDragOver(unrelated);
    expect(unrelated.stopPropagation).not.toHaveBeenCalled();
    expect(api.rootDrop(unrelated)).toBe(false);
    expect(api.headerProps(rows[0], true).draggable).toBe(false);
    const start = event();
    act(() => api.headerProps(rows[1], false).onDragStart(start));
    expect(start.dataTransfer.setData).toHaveBeenCalledWith(`application/x-xhandle-${scope}-folder-id`, 'b');
    act(() => api.headerProps(rows[0], false).onDragOver(event()));
    expect(api.headerProps(rows[0], false).style.boxShadow).toContain('2px');
    act(() => api.headerProps(rows[0], false).onDrop(event()));
    expect(rows.map(row => row.id)).toEqual(['b', 'a']);
    expect(api.rootDrop(event())).toBe(false);
    act(() => api.headerProps(rows[0], false).onDragStart(event()));
    act(() => api.rootDrop(event()));
    expect(rows.map(row => row.id)).toEqual(['a', 'b']);
    act(() => api.headerProps(rows[1], false).onDragStart(event()));
    const center = { ...event(), clientY: 15 };
    act(() => api.headerProps(rows[0], false).onDragOver(center));
    expect(api.headerProps(rows[0], false).style.backgroundColor).toBe('#eff6ff');
    act(() => api.headerProps(rows[0], false).onDrop(center));
    expect(rows.find(row => row.id === 'b').parentId).toBe('a');
    expect(setOpenFolders.mock.calls[0][0]({ a: false })).toEqual({ a: true });
    act(() => api.headerProps(rows[1], false).onDragStart(event()));
    act(() => api.rootDrop(event()));
    expect(rows.find(row => row.id === 'b').parentId).toBe(null);

  } finally { act(() => root.unmount()); }
});

test.each(['project', 'cba'])('%s folder name button starts a drag and drops into another folder', scope => {
  let rows;
  function Sidebar() {
    const [folders, setFolders] = useState([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    const drag = useSidebarFolderDrag(setFolders, scope);
    rows = folders;
    return <div>
      {folders.map(folder => <div key={folder.id} data-folder={folder.id} {...drag.headerProps(folder, false)}>
        <button {...drag.sourceProps}><span>{folder.name}</span></button>
      </div>)}
      {drag.isDragging && <div data-root onDragOver={drag.rootOver} onDrop={drag.rootDrop}>Move folder to top level</div>}
    </div>;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(<Sidebar />));
  const transfer = { setData: jest.fn() };
  const dispatch = (element, type, y = 15) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { dataTransfer: { value: transfer }, clientY: { value: y } });
    act(() => element.dispatchEvent(event));
  };
  try {
    const source = host.querySelector('[data-folder="b"] button');
    expect(source.draggable).toBe(true);
    expect(source.style.userSelect).toBe('none');
    dispatch(source, 'dragstart');
    expect(host.querySelector('[data-folder="b"] button')).toBe(source);
    expect(host.querySelector('[data-root]')).not.toBeNull();
    expect(transfer.setData).toHaveBeenCalledWith(`application/x-xhandle-${scope}-folder-id`, 'b');
    const target = host.querySelector('[data-folder="a"]');
    target.getBoundingClientRect = () => ({ top: 0, height: 30 });
    dispatch(target.querySelector('span'), 'dragover');
    dispatch(target.querySelector('span'), 'drop');
    expect(rows.find(row => row.id === 'b').parentId).toBe('a');
    dispatch(source, 'dragstart');
    dispatch(host.querySelector('[data-root]'), 'drop');
    expect(rows.find(row => row.id === 'b').parentId).toBe(null);
  } finally { act(() => root.unmount()); }
});
