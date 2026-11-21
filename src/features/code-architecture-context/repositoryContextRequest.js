// Compare draft identity as well as repository identity: edits made during a
// request belong to the user and must not be overwritten by its completion.
export function repositoryContextRequestIsCurrent(started, current, requestId, activeRequestId) {
  return Boolean(current?.open && requestId === activeRequestId
    && current.draft === started?.draft
    && current.project === started?.project && current.repo === started?.repo);
}

export function analysisConfigurationIsCurrent(started, current) {
  return repositoryContextRequestIsCurrent(started, current, 0, 0)
    && started.section === current.section && started.activeProject === current.activeProject;
}
