import { startArtifactMaintenance, refreshArtifactSources } from './artifactMaintenance';
import { listArtifacts } from './artifactRepository';
import { captureLiveSourceHash } from './artifactSources';
jest.mock('./artifactRepository', () => ({ listArtifacts: jest.fn(), updateFreshness: jest.fn(), loadArtifact: jest.fn() }));
jest.mock('./artifactSources', () => ({ captureLiveSourceHash: jest.fn() }));
jest.mock('./engineeringProjectRepository', () => ({ engineeringDependencyStatus: jest.fn() }));

beforeEach(() => { jest.useFakeTimers(); listArtifacts.mockResolvedValue([{ id: 'a', config: {}, sourceHash: 'same', freshness: 'current' }]); captureLiveSourceHash.mockResolvedValue('same'); });
afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
test('artifact checkpoints do not recapture code repositories; source edits and fallback still do', async () => {
  const stop = startArtifactMaintenance();
  try {
    await settle(); expect(captureLiveSourceHash).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('xhandle:design-artifacts-changed'));
    jest.advanceTimersByTime(30000); await settle(); expect(captureLiveSourceHash).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('xhandle:data-changed'));
    jest.advanceTimersByTime(2000); await settle(); expect(captureLiveSourceHash).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(300000); await settle(); expect(captureLiveSourceHash).toHaveBeenCalledTimes(3);
  } finally { stop(); }
  jest.advanceTimersByTime(300000); await settle(); expect(captureLiveSourceHash).toHaveBeenCalledTimes(3);
});
test('identical source configurations are captured once per sweep, not once per artifact', async () => {
  listArtifacts.mockResolvedValue(['a', 'b'].map(id => ({ id, config: {}, sourceHash: 'same', freshness: 'current' })));
  await refreshArtifactSources(); expect(captureLiveSourceHash).toHaveBeenCalledTimes(1);
  await refreshArtifactSources(); expect(captureLiveSourceHash).toHaveBeenCalledTimes(2);
});
