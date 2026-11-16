import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import DesignFolderContents from './DesignFolderContents';

jest.mock('lucide-react', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => null }));
let host, root;
const button = label => [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label);
const click = async label => act(async () => button(label).click());
const items = ['folder', 'artifact', 'project', 'module'].map(kind => ({ id: kind, kind, name: `${kind} record` }));
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

test('each folder-list item has one compact menu and actions retain the exact item identity', async () => {
  const open = jest.fn(), save = jest.fn(), remove = jest.fn();
  await act(async () => root.render(<DesignFolderContents folder={{ id: 'parent', name: 'Parent' }} items={items} onOpen={open} onSaveDetails={save} onRemove={remove} canEditItem={() => true} />));
  expect(host.querySelectorAll('tbody button')).toHaveLength(8); // Name links and one overflow button per row.
  expect(button('Edit folder details')).toBeUndefined();
  for (const item of items) {
    expect(button(`Edit details for ${item.name}`)).toBeUndefined();
    await click(`Actions for ${item.name}`); await click(`Open ${item.name}`);
    expect(open).toHaveBeenLastCalledWith(item); expect(document.querySelector('.artifact-actions-popover')).toBeNull();
    await click(`Actions for ${item.name}`); await click(`Edit details for ${item.name}`);
    expect(document.querySelector('[aria-label="Edit item details"] input').value).toBe(item.name);
    await act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(save).toHaveBeenLastCalledWith(item, { title: item.name, description: '' });
    await click(`Actions for ${item.name}`); await click(`Remove ${item.name}`); await click('Cancel');
    expect(remove).not.toHaveBeenCalled();
  }
  await click('Actions for artifact record'); await click('Remove artifact record'); await click('Permanently remove');
  expect(remove).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledWith(items[1]);
});

test('read-only rows offer navigation without exposing edit or delete controls', async () => {
  await act(async () => root.render(<DesignFolderContents folder={{ id: 'parent', name: 'Parent' }} items={items} onOpen={() => {}} canEditItem={() => false} />));
  expect(button('Folder actions for Parent')).toBeUndefined();
  await click('Actions for project record');
  const panel = document.querySelector('.artifact-actions-popover');
  expect([...panel.querySelectorAll('.design-actions-list button')].map(node => node.textContent)).toEqual(['Open']);
  await act(async () => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.activeElement).toBe(button('Actions for project record'));
});
