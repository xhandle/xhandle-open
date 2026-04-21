/**
 * xHandle: agent runtime agent infrastructure.
 * This file defines the runtime-side structures that support xHandle's agent model, including task descriptions, monitoring hooks, and capability metadata.
 * These modules provide the shared contract between agent UIs and the orchestration logic that decides what an AI assistant should do, how it reports progress, and how task state is represented.
 * Related files: src/features/agents/xAgent/XAgentCenter.jsx, src/components/agentController.js, src/components/agentActions.js.
 */

// A thin runtime that adapts your existing performTask/actions to the schema.
// You can enrich this later with auth, queues, and audit logging.

import { capabilitySchema, AgentKinds } from "./capabilitySchema";

/**
 * getAgentCapabilities reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param kind Input consumed by this step of the xHandle workflow.
 * @returns the normalized data requested by this module.
 */
export function getAgentCapabilities(kind) {
  return capabilitySchema[kind];
}

// Adapter that maps capability actions -> your App's performTask signatures.
export function dispatchAgentAction(kind, actionType, payload, performTask) {
  const action = { type: mapToAppAction(kind, actionType), ...payload };
  performTask({ action });
}

// Map our schema action types to App's existing actions.
function mapToAppAction(kind, actionType) {
  switch (actionType) {
    case "product.create-intent-brief":      return "product.create-intent-brief";
    case "product.publish-context":          return "product.publish-context";

    case "dev.refresh-diagram":              return "refresh-diagram";
    case "dev.sync-from-repo":               return "dev.sync-from-repo";

    case "safety.run-analysis":              return "run-analysis";
    case "safety.generate-mitigations":      return "generate-mitigations";

    case "qa.generate-tests":                return "qa.generate-tests";
    case "qa.compute-coverage":              return "qa.compute-coverage";

    default:                                 return actionType; // pass-through if already supported
  }
}

export { AgentKinds };
