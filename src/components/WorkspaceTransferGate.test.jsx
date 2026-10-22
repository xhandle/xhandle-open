import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspaceTransferGate from './WorkspaceTransferGate';
import { getWorkspaceRecovery, hasPendingWorkspaceTransfer, recoverPreviousWorkspace } from '../lib/fullWorkspaceTransfer';
jest.mock('../lib/fullWorkspaceTransfer',()=>({ getWorkspaceRecovery:jest.fn(),hasPendingWorkspaceTransfer:jest.fn(),recoverPreviousWorkspace:jest.fn() }));
let root,host,mounted;
function Workspace(){mounted();return <div>Normal workspace</div>;}
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;jest.clearAllMocks();mounted=jest.fn();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);hasPendingWorkspaceTransfer.mockReturnValue(false);getWorkspaceRecovery.mockResolvedValue(null);});
afterEach(()=>{act(()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT;});
const mount=async()=>act(async()=>root.render(<WorkspaceTransferGate><Workspace/></WorkspaceTransferGate>));
test('ordinary startup mounts normally without opening recovery storage',async()=>{await mount();expect(mounted).toHaveBeenCalledTimes(1);expect(getWorkspaceRecovery).not.toHaveBeenCalled();});
test('pending or unreadable import prevents workspace mount and autosave',async()=>{
  hasPendingWorkspaceTransfer.mockReturnValue(true);getWorkspaceRecovery.mockResolvedValue({summary:{projects:1}});await mount();
  expect(mounted).not.toHaveBeenCalled();expect(host.textContent).toContain('Recover Previous Workspace');
  recoverPreviousWorkspace.mockResolvedValue();await act(async()=>host.querySelector('button').click());
  expect(mounted).not.toHaveBeenCalled();expect(host.textContent).toContain('Reload xHandle');
});
test('a completed import with a stale marker can mount; failed recovery checks cannot',async()=>{
  hasPendingWorkspaceTransfer.mockReturnValue(true);getWorkspaceRecovery.mockRejectedValueOnce(new Error('blocked'));await mount();
  expect(mounted).not.toHaveBeenCalled();expect(host.textContent).toContain('Retry Recovery Check');
  getWorkspaceRecovery.mockResolvedValue(null);await act(async()=>host.querySelector('button').click());expect(mounted).toHaveBeenCalledTimes(1);
});
