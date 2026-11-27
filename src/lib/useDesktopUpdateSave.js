import { useEffect, useRef } from 'react';
import { registerDesktopUpdateSave } from './desktopUpdateSave';
import { flushAnalysisSourceWrites } from '../features/code-architecture-context/analysisSourceStorage';
import { saveArchitectureBeforeUpdate } from '../features/code-architecture-assurance/codeArchitectureStorage';
import { flushArtifactsBeforeUpdate } from '../features/code-architecture-assurance/artifactUtils';
import { saveHazardsBeforeUpdate } from '../features/code-architecture-hazard-analysis/codeArchitectureHazardStore';
import { flushRecoveryRecordsBeforeUpdate } from './durableRecovery';
import { flushHazardStorageRequests } from './hazardStorageClient';

export default function useDesktopUpdateSave(activities, options = {}) {
  const current = useRef({ activities, options });
  current.current = { activities, options };
  useEffect(() => registerDesktopUpdateSave({ workspace: true, save: async () => {
    // Repository analysis registers its own pause-and-checkpoint owner. Other
    // running workflows must finish/stop before their manual save can be verified.
    if (current.current.options.isBusy?.() || Array.from(current.current.activities?.values?.() || []).some(activity => activity.status === 'running'
      && activity.title !== 'Generating code-based architecture')) {
      throw new Error('Other work is still running. Stop it and save manually before retrying the update.');
    }
    await flushAnalysisSourceWrites();
    await saveArchitectureBeforeUpdate();
    await flushRecoveryRecordsBeforeUpdate();
    await flushArtifactsBeforeUpdate();
    await saveHazardsBeforeUpdate();
    await flushHazardStorageRequests();
    await current.current.options.flush?.();
  } }), []);
}
