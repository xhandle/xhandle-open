import { codeSourceProvenance, isLocalCodeSource } from './codeSourceIdentity';

export function selectLocalConnectionDraft(draft, source, connections = []) {
  const existing = connections.find(entry => isLocalCodeSource(entry) && entry.sourceId === source.sourceId);
  // Reconnecting the current draft is not a request to undo the user's edits.
  if (!existing || draft.sourceId === source.sourceId) return { ...draft, ...codeSourceProvenance(source) };
  return {
    ...draft,
    ...existing,
    analysisContextText: existing.analysisContext?.text || '',
    analysisContextFiles: existing.analysisContext?.files || [],
    selectedExtensions: existing.selectedExtensions || [],
    ...codeSourceProvenance(source),
  };
}
