import { enqueueProjectDeletions, runPendingProjectDeletions, startProjectDeletionQueue, retryProjectDeletionCleanup } from './projectDeletionQueue';
import { permanentlyDeleteStoredProject } from './permanentlyDeleteStoredProject';
import { classifyStoredWorkspaceProjects } from './storageWorkspaceVisibility';
import { listProjectDeletions, readProjectDeletion, writeProjectDeletion } from '../lib/projectDeletionRegistry';

jest.mock('./permanentlyDeleteStoredProject', () => ({
  ...jest.requireActual('./permanentlyDeleteStoredProject'),
  permanentlyDeleteStoredProject: jest.fn(),
}));
jest.mock('../features/code-architecture-assurance/artifactUtils', () => ({ blockDeletedProjectArtifactWrites: jest.fn() }));
jest.mock('../features/code-architecture-assurance/codeArchitectureStorage', () => ({ blockDeletedProjectArchitectureWrites: jest.fn() }));

const project = { id: 'instant-delete', name: 'Old project', workspaceType: 'code-architecture', active: false };
const graphRecord = { ...project, sourceStore: 'localStorage:xhandle.codeArchitectureProjects', sourceData: { id: project.id } };
beforeEach(() => { localStorage.clear(); jest.clearAllMocks(); permanentlyDeleteStoredProject.mockResolvedValue({ deleted: 1 }); });

test('durably removes a project immediately while disk cleanup is still pending', async () => {
  let finish;
  permanentlyDeleteStoredProject.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const result = enqueueProjectDeletions([project]);
  expect(result).toEqual({ accepted: [project], error: undefined });
  expect(permanentlyDeleteStoredProject).not.toHaveBeenCalled();
  expect(readProjectDeletion(project).status).toBe('queued');
  expect(classifyStoredWorkspaceProjects([graphRecord], [], [])).toEqual([]);
  const cleanup = runPendingProjectDeletions();
  expect(classifyStoredWorkspaceProjects([graphRecord], [], [])).toEqual([]);
  finish({ deleted: 1 });
  await cleanup;
  expect(readProjectDeletion(project).status).toBe('complete');
  // A stale graph snapshot must stay hidden even after disk cleanup finishes.
  expect(classifyStoredWorkspaceProjects([graphRecord], [], [])).toEqual([]);
});

test('startup resumes an interrupted durable job without reopening the settings dialog', async () => {
  writeProjectDeletion({ ...project, status: 'queued', attempts: 0 });
  const stop = startProjectDeletionQueue();
  try {
    await runPendingProjectDeletions();
    expect(permanentlyDeleteStoredProject).toHaveBeenCalledWith(expect.objectContaining({ id: project.id }));
    expect(readProjectDeletion(project).status).toBe('complete');
  } finally { stop(); }
});

test('a cleanup failure does not restore deleted projects or block another deletion; retry is durable', async () => {
  permanentlyDeleteStoredProject.mockRejectedValueOnce(new Error('Storage unavailable'));
  const second = { ...project, id: 'another-deletion' };
  enqueueProjectDeletions([project, second]);
  await runPendingProjectDeletions();
  expect(readProjectDeletion(project)).toMatchObject({ status: 'failed', error: 'Storage unavailable' });
  expect(readProjectDeletion(second).status).toBe('complete');
  expect(classifyStoredWorkspaceProjects([graphRecord], [], [])).toEqual([]);
  retryProjectDeletionCleanup();
  await runPendingProjectDeletions();
  expect(readProjectDeletion(project)).toMatchObject({ status: 'complete', attempts: 2 });
});

test('refuses active projects and does not hide anything when recording deletion fails', () => {
  localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([project]));
  expect(() => enqueueProjectDeletions([project])).toThrow(/active/);
  expect(listProjectDeletions()).toEqual([]);
  localStorage.clear();
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('Disk full'); });
  try {
    expect(enqueueProjectDeletions([project])).toMatchObject({ accepted: [], error: expect.any(Error) });
    expect(classifyStoredWorkspaceProjects([graphRecord], [], [])).toHaveLength(1);
    expect(permanentlyDeleteStoredProject).not.toHaveBeenCalled();
  } finally { write.mockRestore(); }
});

test('a project becoming active again is protected from queued cleanup', async () => {
  writeProjectDeletion({ ...project, status: 'queued', attempts: 0 });
  localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([project]));
  await runPendingProjectDeletions();
  expect(permanentlyDeleteStoredProject).not.toHaveBeenCalled();
  expect(readProjectDeletion(project).status).toBe('failed');
  expect(classifyStoredWorkspaceProjects([graphRecord], [], [project])).toEqual([expect.objectContaining({ active: true })]);
});
