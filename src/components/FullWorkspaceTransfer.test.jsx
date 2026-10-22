import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FullWorkspaceTransfer from './FullWorkspaceTransfer';
import { downloadWorkspaceTransfer, inspectWorkspaceTransfer, importWorkspaceTransfer, getWorkspaceRecovery, recoverPreviousWorkspace } from '../lib/fullWorkspaceTransfer';
jest.mock('../lib/fullWorkspaceTransfer', () => ({ downloadWorkspaceTransfer:jest.fn(), inspectWorkspaceTransfer:jest.fn(), importWorkspaceTransfer:jest.fn(), getWorkspaceRecovery:jest.fn(), recoverPreviousWorkspace:jest.fn() }));
let root, host;
const summary={projects:2,databases:3,records:7,settings:5,baselines:1};
const file={manifest:{createdAt:'2026-01-02T00:00:00Z',includeCredentials:true,summary},payload:{}};
const button=text=>[...host.querySelectorAll('button')].find(node=>node.textContent===text);
const click=async node=>act(async()=>{node.click();});
async function chooseFile(){const input=host.querySelector('input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:[new File(['file'],'workspace.json')]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));}
beforeEach(async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;jest.clearAllMocks();getWorkspaceRecovery.mockResolvedValue(null);
  inspectWorkspaceTransfer.mockResolvedValue({envelope:file,summary});downloadWorkspaceTransfer.mockResolvedValue({summary});importWorkspaceTransfer.mockResolvedValue(summary);recoverPreviousWorkspace.mockResolvedValue();
  jest.spyOn(window,'confirm').mockReturnValue(true);
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
  await act(async()=>root.render(<FullWorkspaceTransfer/>));
});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.restoreAllMocks();delete global.IS_REACT_ACT_ENVIRONMENT;});
test('export requires saved-work acknowledgement and credentials are optional',async()=>{
  expect(button('Export Full Workspace').disabled).toBe(true);
  await click(host.querySelectorAll('input[type=checkbox]')[0]);
  await click(button('Export Full Workspace'));
  expect(downloadWorkspaceTransfer).toHaveBeenLastCalledWith(expect.objectContaining({includeCredentials:false}));
  await click(host.querySelectorAll('input[type=checkbox]')[1]);await click(button('Export Full Workspace'));
  expect(downloadWorkspaceTransfer).toHaveBeenLastCalledWith(expect.objectContaining({includeCredentials:true}));
});
test('preview and confirmation precede replacement; importing keeps credentials by default',async()=>{
  await chooseFile();expect(host.textContent).toContain('2 project(s)');expect(importWorkspaceTransfer).not.toHaveBeenCalled();
  expect(button('Import and Replace Workspace').disabled).toBe(true);
  await click(host.querySelectorAll('input[type=checkbox]')[0]);
  window.confirm.mockReturnValueOnce(false);await click(button('Import and Replace Workspace'));expect(importWorkspaceTransfer).not.toHaveBeenCalled();
  await click(button('Import and Replace Workspace'));
  expect(importWorkspaceTransfer).toHaveBeenCalledWith(file,expect.objectContaining({restoreCredentials:false}));
  expect(button('Reload xHandle')).toBeTruthy();
});
test('credential restoration requires its own opt-in and damaged files never import',async()=>{
  await chooseFile();await click(host.querySelectorAll('input[type=checkbox]')[0]);await click(host.querySelectorAll('input[type=checkbox]')[2]);
  await click(button('Import and Replace Workspace'));
  expect(importWorkspaceTransfer).toHaveBeenCalledWith(file,expect.objectContaining({restoreCredentials:true}));
});
test('invalid file displays a failure without offering replacement',async()=>{
  inspectWorkspaceTransfer.mockRejectedValueOnce(new Error('Integrity check failed'));
  await chooseFile();expect(host.textContent).toContain('Integrity check failed');expect(button('Import and Replace Workspace')).toBeUndefined();expect(importWorkspaceTransfer).not.toHaveBeenCalled();
});
test('pending recovery blocks new transfers and exposes the recovery path',async()=>{
  getWorkspaceRecovery.mockResolvedValue({createdAt:'now',summary});
  await act(async()=>root.render(<FullWorkspaceTransfer key="recovery"/>));
  expect(button('Choose Full Workspace File').disabled).toBe(true);
  getWorkspaceRecovery.mockResolvedValue(null);await click(button('Recover Previous Workspace'));
  expect(recoverPreviousWorkspace).toHaveBeenCalled();expect(button('Reload xHandle')).toBeTruthy();
});

test('export displays stage progress, blocks duplicate actions, and reports download handoff', async()=>{
  let finish;
  downloadWorkspaceTransfer.mockImplementationOnce(({onProgress}) => new Promise(resolve=>{
    finish=()=>{onProgress('Export complete. Download started.',100);resolve({summary});};
    onProgress('Reading workspace databases…',35);
  }));
  await click(host.querySelectorAll('input[type=checkbox]')[0]);
  await click(button('Export Full Workspace'));
  expect(host.querySelector('progress').value).toBe(35);
  expect(host.textContent).toContain('35% complete');
  expect(host.textContent).toContain('Reading workspace databases');
  expect(button('Export Full Workspace').disabled).toBe(true);
  await act(async()=>finish());
  expect(host.querySelector('progress').value).toBe(100);
  expect(host.textContent).toContain('100% complete');
  expect(host.textContent).toContain('Download started');
});
