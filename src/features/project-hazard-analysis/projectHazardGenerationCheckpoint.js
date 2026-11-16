import { createCodeHazardCheckpoint } from '../code-architecture-hazard-analysis/codeHazardGenerationCheckpoint';
import { getStoredActiveAIProvider, getStoredAIProviderModelPreference, getStoredAIProviderEffortPreference } from '../../lib/aiProviderConfig';

// Every entry hashes its exact evidence, context, prompt and policy. Share the
// durable database, with a separate scope from Code-Based Architecture runs.
export function createProjectHazardCheckpoint(projectId, method, options = {}) {
  const provider = getStoredActiveAIProvider();
  return createCodeHazardCheckpoint({ pipeline: 'projects-hazard-v1', projectId, method, provider,
    model: getStoredAIProviderModelPreference(provider, { includeDefault: true }),
    effort: getStoredAIProviderEffortPreference(provider),
  }, options);
}
