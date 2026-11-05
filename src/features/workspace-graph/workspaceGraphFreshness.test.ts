import 'fake-indexeddb/auto';
import {trackWorkspaceGraphSourceChanges, INDEX_DIRTY_PREFIX} from './workspaceGraphFreshness';

test('startup tracks source changes without reading workspace bodies or opening databases', () => {
  localStorage.clear();
  const read = jest.spyOn(Storage.prototype, 'getItem');
  const write = jest.spyOn(Storage.prototype, 'setItem');
  const open = jest.spyOn(indexedDB, 'open');
  try {
    trackWorkspaceGraphSourceChanges();
    trackWorkspaceGraphSourceChanges();
    expect(read).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    // An edit before the first question must still invalidate persisted index
    // checkpoints. Registering tracking twice must not duplicate the listener.
    window.dispatchEvent(new CustomEvent('xhandle:data-changed', {detail: {db: 'xhandle', stores: ['copilot_baseline']}}));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(INDEX_DIRTY_PREFIX + 'codeArchitecture', expect.any(String));
    expect(read).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    write.mockClear();
    window.dispatchEvent(new CustomEvent('xhandle:data-changed', {detail: {db: 'xhandle', stores: ['diagram_positions']}}));
    expect(write).not.toHaveBeenCalled();
  } finally {read.mockRestore(); write.mockRestore(); open.mockRestore();}
});
