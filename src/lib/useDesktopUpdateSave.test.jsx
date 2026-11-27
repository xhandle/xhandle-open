import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import useDesktopUpdateSave from './useDesktopUpdateSave';
import { saveBeforeDesktopUpdate } from './desktopUpdateSave';
import { flushAnalysisSourceWrites } from '../features/code-architecture-context/analysisSourceStorage';
jest.mock('../features/code-architecture-context/analysisSourceStorage', () => ({ flushAnalysisSourceWrites: jest.fn(async () => {}) }));
jest.mock('../features/code-architecture-assurance/codeArchitectureStorage', () => ({ saveArchitectureBeforeUpdate: async () => {} }));
jest.mock('../features/code-architecture-assurance/artifactUtils', () => ({ flushArtifactsBeforeUpdate: async () => {} }));
jest.mock('../features/code-architecture-hazard-analysis/codeArchitectureHazardStore', () => ({ saveHazardsBeforeUpdate: async () => {} }));
jest.mock('./durableRecovery', () => ({ flushRecoveryRecordsBeforeUpdate: async () => {} }));
jest.mock('./hazardStorageClient', () => ({ flushHazardStorageRequests: async () => {} }));
global.IS_REACT_ACT_ENVIRONMENT = true;
function Fixture({ activities }) { useDesktopUpdateSave(activities); return null; }
test('reads current Map activities and refuses unsupported running work until manually saved/stopped', async () => {
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<Fixture activities={new Map([['synthetic', { status: 'running', title: 'Other analysis' }]])}/>));
    await expect(saveBeforeDesktopUpdate()).rejects.toThrow('save manually');
    expect(flushAnalysisSourceWrites).not.toHaveBeenCalled();
    await act(async () => root.render(<Fixture activities={new Map()}/>));
    await expect(saveBeforeDesktopUpdate()).resolves.toEqual({ saved: true });
    expect(flushAnalysisSourceWrites).toHaveBeenCalled();
  } finally { act(() => root.unmount()); }
});
