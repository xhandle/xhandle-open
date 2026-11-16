import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import DesignLibraryTree, { libraryContents } from './DesignLibraryTree';

jest.mock('lucide-react', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => null }));
const project = { id: 'p', name: 'Pronto', externalArtifact: true, recordType: 'systems-engineering-project', members: [{ id: 'a' }, { id: 'b' }] };
const artifacts = [{ id: 'b', name: 'System Specification', programId: 'p', externalArtifact: true }, { id: 'a', name: 'Concept of Operations', programId: 'p', externalArtifact: true }];
const roots = [{ id: 'root', name: 'Root', modules: [], children: [{ id: 'f', name: 'Designs', modules: [artifacts[0], { id: 'standalone', name: 'System Specification', externalArtifact: true }, project, artifacts[1], { id: 'legacy', name: 'Source requirements' }], children: [] }] }];
let root, host, callbacks;
const node = id => host.querySelector(`[data-library-id="${id}"]`);
const button = label => [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label);
const click = async label => act(async () => button(label).click());
const render = async (props = {}) => act(async () => root.render(<DesignLibraryTree roots={roots} activeId="f" selectedModule="p" {...callbacks} {...props} />));
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  callbacks = Object.fromEntries(['onSelect', 'onSelectModule', 'onCreateChild', 'onRenameFolder', 'onManageModules', 'onGenerateProject', 'onGenerateArtifact', 'onDeleteFolder', 'onMoveFolder', 'onMoveModule'].map(key => [key, jest.fn()]));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

test('groups artifacts by owning project and member order, leaving standalone artifacts and legacy modules separate', () => {
  const contents = libraryContents(roots[0].children[0]);
  expect(contents.projects[0].artifacts.map(item => item.id)).toEqual(['a', 'b']);
  expect(contents.items.map(item => item.id)).toEqual(['standalone', 'legacy']);
});

test('project artifacts filed in a subfolder appear there once and retain the owning project count and label', async () => {
  const nested = [{ id: 'f', name: 'Designs', modules: [project, artifacts[0]], children: [{ id: 'sub', name: 'Architectures', parentId: 'f', modules: [artifacts[1]], children: [] }] }];
  await render({ roots: nested, activeId: 'sub', selectedModule: 'a' });
  expect(node('a').closest('[data-library-kind="folder"]').dataset.libraryId).toBe('sub');
  expect(node('a').closest('[data-library-kind="project"]')).toBeNull();
  expect(node('a').textContent).toContain('Artifact · Pronto');
  expect(node('p').textContent).toContain('Project · 2 artifacts');
  expect(host.querySelectorAll('[data-library-id="a"]')).toHaveLength(1);
  const data = {}, dataTransfer = { setData: (type, value) => { data[type] = value; }, getData: type => data[type] || '' };
  const event = name => { const e = new Event(name, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'dataTransfer', { value: dataTransfer }); return e; };
  const onMoveItem = jest.fn(); await render({ roots: nested, activeId: 'sub', selectedModule: 'a', onMoveItem });
  await act(async () => node('a').querySelector('[draggable=true]').dispatchEvent(event('dragstart')));
  expect(JSON.parse(data['application/x-xhandle-design-library'])).toMatchObject({ programId: 'p', libraryParent: 'folder:sub' });
  await act(async () => node('p').querySelector('[draggable=true]').dispatchEvent(event('drop')));
  expect(onMoveItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', programId: 'p' }), expect.objectContaining({ programId: 'p' }));
});
test('renders distinct folder, project, artifact and module labels, nesting member artifacts exactly once', async () => {
  await render();
  expect(node('root').dataset.libraryKind).toBe('folder'); expect(node('p').dataset.libraryKind).toBe('project');
  expect(node('p').textContent).toContain('Project · 2 artifacts'); expect(node('a').textContent).toContain('Artifact'); expect(node('legacy').textContent).toContain('Module');
  expect(node('a').closest('[data-library-kind="project"]')).toBe(node('p'));
  expect(node('standalone').closest('[data-library-kind="project"]')).toBeNull();
  expect(host.querySelectorAll('[data-library-id="b"]')).toHaveLength(1);
  expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  await click('Concept of Operations'); expect(callbacks.onSelect).toHaveBeenCalledWith('f'); expect(callbacks.onSelectModule).toHaveBeenCalledWith('Concept of Operations', expect.objectContaining(artifacts[1]));
});
test('collapsing projects and folders never navigates or reopens when generation refreshes metadata', async () => {
  await render(); await click('Collapse project Pronto'); expect(node('a')).toBeNull(); expect(node('standalone')).not.toBeNull();
  await render({ roots: JSON.parse(JSON.stringify(roots)) }); expect(node('a')).toBeNull();
  await click('Collapse folder Designs'); expect(node('p')).toBeNull();
  expect(callbacks.onSelect).not.toHaveBeenCalled(); expect(callbacks.onSelectModule).not.toHaveBeenCalled();
  await render({ selectedModule: 'b' }); expect(node('b')).not.toBeNull(); expect(button('Collapse project Pronto').getAttribute('aria-expanded')).toBe('true');
});
test('expand/collapse all handles nested folders and projects and preserves collapse state on remount', async () => {
  await render(); await click('Collapse all'); expect(node('f')).toBeNull(); expect(JSON.parse(localStorage.getItem('xhandle:folder-open'))).toEqual([]);
  await render({ roots: JSON.parse(JSON.stringify(roots)) }); expect(node('f')).toBeNull();
  await click('Expand all'); expect(node('a')).not.toBeNull(); expect(JSON.parse(localStorage.getItem('xhandle:folder-open'))).toEqual(expect.arrayContaining(['root', 'f', 'project:p']));
  await click('Collapse all'); await act(async () => root.unmount()); root = createRoot(host); await render({ activeId: null, selectedModule: null }); expect(node('f')).toBeNull();
});
test('selecting a folder reveals its ancestors and marks the folder as the current page', async () => {
  await render({ selectedModule: null });
  expect(button('Designs').getAttribute('aria-current')).toBe('page');
  expect(button('Collapse folder Root')).toBeDefined();
  expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  await click('Collapse folder Root'); await render({ roots: JSON.parse(JSON.stringify(roots)), selectedModule: null });
  expect(node('f')).toBeNull();
});
test('legacy modules still move by drag and drop and artifact rows are draggable', async () => {
  await render();
  const data = {}, dataTransfer = { setData: (type, value) => { data[type] = value; }, getData: type => data[type] || '' };
  const event = name => { const event = new Event(name, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: dataTransfer }); return event; };
  await act(async () => node('legacy').querySelector('[draggable=true]').dispatchEvent(event('dragstart')));
  expect(JSON.parse(data['application/x-xhandle-module'])).toEqual({ moduleId: 'legacy', fromFolderId: 'f' });
  await act(async () => node('root').querySelector('[draggable=true]').dispatchEvent(event('drop')));
  expect(callbacks.onMoveModule).toHaveBeenCalledWith('legacy', 'f', 'root');
  expect(node('a').querySelector('[draggable=true]')).not.toBeNull();
  await act(async () => node('legacy').querySelector('[draggable=true]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(callbacks.onManageModules).toHaveBeenCalledWith('f');
  await click('Actions for Designs'); await click('Add subfolder'); expect(callbacks.onCreateChild).toHaveBeenCalledWith('f');
});

test('folder actions use labeled buttons, close after an action, and Escape returns focus to the trigger', async () => {
  await render(); await click('Actions for Designs');
  expect(button('Actions for Designs').getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector('[aria-label="Folder actions for Designs"]')).not.toBeNull();
  expect(button('Manage modules')).toBeUndefined();
  await click('Generate systems engineering project'); expect(callbacks.onGenerateProject).toHaveBeenCalledWith('f');
  expect(button('Actions for Designs').getAttribute('aria-expanded')).toBe('false');
  await click('Actions for Root'); await click('Generate engineering artifact'); expect(callbacks.onGenerateArtifact).toHaveBeenCalledWith('root');
  expect(button('Actions for Root').getAttribute('aria-expanded')).toBe('false');
  await click('Actions for Designs');
  await click('Rename folder'); expect(callbacks.onRenameFolder).toHaveBeenCalledWith('f'); expect(button('Rename folder')).toBeUndefined();
  await click('Actions for Designs');
  await act(async () => button('Delete folder').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(button('Delete folder')).toBeUndefined(); expect(document.activeElement).toBe(button('Actions for Designs'));
  expect(callbacks.onDeleteFolder).not.toHaveBeenCalled(); expect(callbacks.onSelect).not.toHaveBeenCalled();
  await click('Actions for Designs'); await click('Delete folder'); expect(callbacks.onDeleteFolder).toHaveBeenCalledWith('f');
});
test('subfolders can be moved to the same level as other top-level folders', async () => {
  const nested = JSON.parse(JSON.stringify(roots)); nested[0].children[0].parentId = 'root';
  await render({ roots: nested }); await click('Actions for Designs'); await click('Move to top level');
  expect(callbacks.onMoveFolder).toHaveBeenCalledWith('f', null);
});

test('dragging an artifact above another saves its project order without changing membership', async () => {
  const onMoveItem = jest.fn(); await render({ onMoveItem });
  const data = {}, dataTransfer = { setData: (type, value) => { data[type] = value; }, getData: type => data[type] || '' };
  const event = (name, clientY) => { const e = new MouseEvent(name, { bubbles: true, cancelable: true, clientY }); Object.defineProperty(e, 'dataTransfer', { value: dataTransfer }); return e; };
  const destination = node('a').querySelector('[draggable=true]'); destination.getBoundingClientRect = () => ({ top: 0, height: 100 });
  await act(async () => node('b').querySelector('[draggable=true]').dispatchEvent(event('dragstart', 0)));
  await act(async () => destination.dispatchEvent(event('dragover', 5)));
  expect(dataTransfer.dropEffect).toBe('move');
  await act(async () => destination.dispatchEvent(event('drop', 5)));
  expect(onMoveItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', programId: 'p' }), expect.objectContaining({ container: 'project:p', anchor: 'artifact:a', position: 'before' }));
  expect([...node('p').querySelectorAll('[data-library-kind=artifact]')].map(node => node.dataset.libraryId)).toEqual(['b', 'a']);
  expect(JSON.parse(localStorage.getItem('xhandle:design-library-order'))['project:p']).toEqual(['artifact:b', 'artifact:a']);
  await act(async () => root.unmount()); root = createRoot(host); await render({ onMoveItem });
  expect([...node('p').querySelectorAll('[data-library-kind=artifact]')].map(node => node.dataset.libraryId)).toEqual(['b', 'a']);
});

test('dropping a standalone artifact onto a collapsed project requests membership and reveals it', async () => {
  const onMoveItem = jest.fn(); await render({ onMoveItem }); await click('Collapse project Pronto');
  const data = {}, dataTransfer = { setData: (type, value) => { data[type] = value; }, getData: type => data[type] || '' };
  const event = name => { const e = new MouseEvent(name, { bubbles: true, cancelable: true, clientY: 50 }); Object.defineProperty(e, 'dataTransfer', { value: dataTransfer }); return e; };
  const destination = node('p').querySelector('[draggable=true]'); destination.getBoundingClientRect = () => ({ top: 0, height: 100 });
  await act(async () => node('standalone').querySelector('[draggable=true]').dispatchEvent(event('dragstart')));
  await act(async () => destination.dispatchEvent(event('dragover'))); expect(dataTransfer.dropEffect).toBe('move');
  await act(async () => destination.dispatchEvent(event('drop')));
  expect(onMoveItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'standalone' }), expect.objectContaining({ programId: 'p', position: 'inside' }));
  expect(button('Collapse project Pronto')).toBeDefined();
});

test('project folders nest once, reveal selected descendants and support collapse and dragging out', async () => {
  const nested = [{ id: 'f', name: 'Designs', modules: [{ ...project, libraryFolderIds: ['sub'] }, artifacts[0]], children: [{ id: 'sub', name: 'Specifications', parentId: 'f', modules: [], children: [{ id: 'deep', name: 'Interfaces', parentId: 'sub', modules: [artifacts[1]], children: [] }] }] }];
  const onMoveItem = jest.fn();
  await render({ roots: nested, activeId: 'deep', selectedModule: 'a', onMoveItem });
  expect(node('sub').closest('[data-library-kind="project"]')).toBe(node('p'));
  expect(node('a').closest('[data-library-kind="folder"]')).toBe(node('deep'));
  expect(node('a').closest('[data-library-kind="project"]')).toBe(node('p'));
  expect(host.querySelectorAll('[data-library-id="sub"]')).toHaveLength(1);
  await click('Collapse project Pronto'); expect(node('sub')).toBeNull();
  await click('Expand project Pronto'); expect(node('a')).not.toBeNull();
  const data = {}, dataTransfer = { setData: (type, value) => { data[type] = value; }, getData: type => data[type] || '' };
  const event = name => { const e = new Event(name, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'dataTransfer', { value: dataTransfer }); return e; };
  await act(async () => node('sub').querySelector('[draggable=true]').dispatchEvent(event('dragstart')));
  expect(JSON.parse(data['application/x-xhandle-design-library']).libraryParent).toBe('project:p');
  await act(async () => node('f').querySelector('[draggable=true]').dispatchEvent(event('drop')));
  expect(onMoveItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'sub' }), expect.objectContaining({ folderId: 'f' }));
});
