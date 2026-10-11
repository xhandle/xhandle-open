import { saveCodeArchitectureHazardRun, getLatestCodeArchitectureHazardRun } from './codeArchitectureHazardStore';

beforeEach(() => localStorage.clear());
test('silent context-run writes remain durable without reloading the originating view', async () => {
 const changed=jest.fn();
 window.addEventListener('xhandle:code-architecture-hazard-analysis:changed',changed);
 try {
  const run={id:'test-run',projectId:'p',repoId:'r',generatedSheets:{Summary:[['Guide Phrase Applicable'],['No']]}};
  await saveCodeArchitectureHazardRun(run,{notify:false});
  expect(changed).not.toHaveBeenCalled();
  expect(await getLatestCodeArchitectureHazardRun({projectId:'p',repoId:'r'})).toEqual(run);
  await saveCodeArchitectureHazardRun(run);
  expect(changed).toHaveBeenCalledTimes(1);
 } finally {window.removeEventListener('xhandle:code-architecture-hazard-analysis:changed',changed);}
});
