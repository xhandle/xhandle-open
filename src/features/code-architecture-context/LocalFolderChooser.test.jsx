import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import LocalFolderChooser from './LocalFolderChooser';
import { chooseLocalFolder, getLocalFolderSession, reuseLocalFolderConnection } from './localCodeSource';

jest.mock('./localCodeSource', () => ({ chooseLocalFolder: jest.fn(), connectLocalFolder: jest.fn(), getLocalFolderSession: jest.fn(), reuseLocalFolderConnection: jest.fn() }));
const existing = { sourceType: 'local', sourceId: 'old', folderName: 'LIO-SAM-master', lastAnalyzedAt: '2026-10-16T12:00:00Z' };
const candidate = { ...existing, sourceId: 'new' };
const scan = { entries: [{}], skipped: [] };
let container, root;
const render = async props => { await act(async () => { root.render(<LocalFolderChooser {...props} />); }); };
const click = async label => {
  const button = [...container.querySelectorAll('button')].find(element => element.textContent.startsWith(label));
  expect(button).toBeDefined();
  await act(async () => { button.click(); });
};
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  window.showDirectoryPicker = jest.fn();
  chooseLocalFolder.mockResolvedValue({ source: candidate, scan });
  getLocalFolderSession.mockResolvedValue({});
  reuseLocalFolderConnection.mockResolvedValue({ source: existing, scan });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete window.showDirectoryPicker; });

test('same-name selection requires an explicit choice and reuse retains source identity', async () => {
  const onChange = jest.fn(), onPendingChange = jest.fn();
  await render({ source: { sourceType: 'local' }, connections: [existing], onChange, onPendingChange });
  await click('Choose folder');
  expect(onChange).not.toHaveBeenCalled();
  expect(onPendingChange).toHaveBeenLastCalledWith(true);
  await click('Use existing connection');
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'old' }));
  expect(reuseLocalFolderConnection).toHaveBeenCalledWith(candidate, existing);
  expect(onPendingChange).toHaveBeenLastCalledWith(false);
});

test('different same-name folders can remain separate by explicit choice', async () => {
  const onChange = jest.fn();
  await render({ source: { sourceType: 'local' }, connections: [existing], onChange });
  await click('Choose folder'); await click('Add as a separate source');
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'new' }));
  expect(reuseLocalFolderConnection).not.toHaveBeenCalled();
});

test('cancelling ambiguous selection does not replace the saved connection', async () => {
  const onChange = jest.fn();
  await render({ source: existing, connections: [existing], onChange });
  await click('Choose different folder'); await click('Cancel selection');
  expect(onChange).not.toHaveBeenCalled();
});

test('explicit reconnect keeps its identity even if an old duplicate exists', async () => {
  chooseLocalFolder.mockResolvedValue({ source: existing, scan });
  const onChange = jest.fn();
  await render({ source: existing, connections: [existing, candidate], onChange });
  await click('Reconnect folder');
  expect(chooseLocalFolder).toHaveBeenCalledWith('old');
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'old' }));
  expect(container.textContent).not.toContain('Add as a separate source');
});
