# Review local project folder support for code architecture analysis

Review the current xHandle implementation and produce an evidence-backed implementation plan. Do not implement the feature in this review.

## Requested behavior

The existing GitHub repo configuration modal should offer a Local project folder source alongside GitHub. Users should be able to choose a project directory on their computer, like selecting an IDE workspace, and run the existing code architecture analysis against it. Preserve GitHub configuration and analysis behavior. Support macOS and Windows, including the user's Safari workflow; distinguish selecting a snapshot from maintaining access to a live folder.

## Review tasks

1. Trace the current modal, verification, file selection, Analyze action, source loading, indexing, context extraction, grounding, AI requests, progress/cancellation, results persistence, and source evidence links.
2. Identify GitHub-specific assumptions and the minimum source-provider boundary needed for shared analysis. Inspect source identity, cache isolation/invalidation, reruns, project import/export, downstream hazard/requirements/design/traceability, and review mode.
3. Inspect existing native folder selection, backup, browser filesystem, and desktop/IDE integrations for reuse. Verify browser constraints against primary documentation; do not assume a backend folder chooser selects files on a remote browser user's computer.
4. Specify a local source flow, lifecycle, and source metadata. Address cancellation, unavailable folders, reload/reselection, changes during analysis, path separators, same-named folders, binary/large files, ignored/generated directories, and memory/storage limits. Explain what code is sent to the configured AI service.
5. Use bounded read-only probes or existing tests where helpful. Do not inspect arbitrary personal source folders, invoke paid AI analysis, mutate project data, or commit/push during the review.
6. Write findings with file/line references, distinguish verified facts from recommendations, propose an implementation sequence and regression tests, and state unresolved product choices and verification limits.

Deliver the review to `docs/investigations/local-codebase-analysis-review.md`, with a concise user-facing summary.
