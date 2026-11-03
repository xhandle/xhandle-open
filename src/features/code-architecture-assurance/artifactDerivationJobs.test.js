import { artifactDerivationScope, getArtifactDerivationJob, runArtifactDerivation, subscribeArtifactDerivations } from './artifactDerivationJobs';

test('same repository shares one job across stages; other repositories can run', async () => {
  const scope = artifactDerivationScope('job-test', 'repo');
  let release;
  const work = jest.fn(() => new Promise(resolve => { release = resolve; }));
  const first = runArtifactDerivation(scope, work);
  const second = runArtifactDerivation(scope, work);
  expect(first).toBe(second);
  expect(getArtifactDerivationJob(scope).running).toBe(true);
  await Promise.resolve();
  expect(work).toHaveBeenCalledTimes(1);
  await runArtifactDerivation(artifactDerivationScope('other', 'repo'), async () => {});
  release(); await first;
  expect(getArtifactDerivationJob(scope).running).toBe(false);
  await runArtifactDerivation(scope, work.mockResolvedValue());
  expect(work).toHaveBeenCalledTimes(2);
});

test('progress is coalesced and final message survives unsubscription without retaining results', async () => {
  jest.useFakeTimers();
  const scope = artifactDerivationScope('progress-test', 'repo'), listener = jest.fn();
  const unsubscribe = subscribeArtifactDerivations(listener);
  let release;
  const job = runArtifactDerivation(scope, async publish => {
    for (let i = 0; i < 1000; i++) publish('Step ' + i);
    await new Promise(resolve => { release = resolve; });
    publish('Completed');
  });
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(100);
  expect(getArtifactDerivationJob(scope).message).toBe('Step 999');
  unsubscribe(); release(); await job;
  expect(getArtifactDerivationJob(scope)).toEqual({ running: false, message: 'Completed' });
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

test('failed jobs release ownership for retry', async () => {
  const scope = artifactDerivationScope('failed-test', 'repo');
  await expect(runArtifactDerivation(scope, async () => { throw Error('Storage unavailable'); })).rejects.toThrow('Storage unavailable');
  await expect(runArtifactDerivation(scope, async () => 'retry')).resolves.toBe('retry');
});
