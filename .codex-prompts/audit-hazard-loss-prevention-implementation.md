# Audit the hazard-analysis loss-prevention implementation

Perform a production-readiness and data-integrity review of the current uncommitted implementation intended to prevent hazard-analysis results from disappearing during Vibe Review loops.

This is an audit, not an implementation task. Do not modify product code. Preserve all existing user changes. You may add only the requested audit report.

## Scope

Review the complete behavior and interactions of:

- `src/features/project-hazard-analysis/projectHazardAnalysisStorage.js`
- every production caller of its load, save, checkpoint, revision-list, revision-restore, and delete APIs
- Vibe Review parent/prerequisite/follow-up stack orchestration
- hazard decision commit, undo, regeneration, and autosave paths
- Review Center evidence persistence and quota fallbacks
- Collaborator thread persistence and active-review retention
- project switching, reload/hydration, multiple tabs, interrupted writes, quota failures, explicit reset, project deletion, and recovery UX

## Questions the audit must answer

1. Does the implementation eliminate the classification -> significance prerequisite -> classification re-entry loop in the real UI orchestration, rather than only in a test harness?
2. Can any stale React closure, delayed autosave, project switch, second tab, regeneration, undo, or partial write overwrite newer or different-project hazard data?
3. Is compare-and-set protection actually passed by production callers?
4. Is a pre-review checkpoint guaranteed to finish before the first review mutation, and is it retained for the entire review?
5. Are revisions transactionally safe, bounded, correctly pruned, deleted with their project, and recoverable through an accessible user interface?
6. Can callers distinguish missing data from read failure, blocked clear, stale revision, quota failure, and durable success?
7. Do Review Center, audit, session, and thread records remain bounded under long or looping reviews without silently claiming persistence?
8. Are there regressions in adjacent hazard and functional Vibe Review behavior?

## Required verification

- Inspect the complete diff and all relevant call sites. Do not assume an exported API is used.
- Run the complete test suite and production build.
- Examine build warnings introduced or exposed by the change.
- Verify the exact real orchestration sequence:

      classification parent
        -> significance prerequisite
        -> significance = Yes
        -> resume the same classification parent
        -> classification accepted
        -> return to the original queue

- Test or identify missing tests for cross-tab stale writes, interrupted revision/head writes, quota exhaustion, checkpoint ordering/retention, project deletion, restore UX, and long-review storage growth.

## Report format

Write `.codex-reviews/hazard-loss-prevention-implementation-audit.md` containing:

1. Executive verdict: complete, conditionally safe, or incomplete.
2. Findings ordered by severity, each with exact file/line evidence, user impact, failure sequence, and recommended correction.
3. What the implementation fixes successfully.
4. Remaining work required before the issue can be considered completely resolved.
5. Test and build results.
6. A concrete acceptance checklist and manual test procedure.

Be skeptical of passing unit tests when they reproduce orchestration logic inside the test instead of invoking the production orchestration. Clearly distinguish proven defects from theoretical hardening opportunities.
