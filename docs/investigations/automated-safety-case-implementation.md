# Automatic safety-case evidence: implementation and regression checks

Date: 2026-11-06.

Executed prompt: `docs/codex-prompts/implement-automated-safety-case.md`.
Design input: `docs/investigations/automated-safety-case-review.md`.

## Delivered scope

Implemented the prerequisite fixes and a first automatic workflow for project requirements and explicitly traced verification documents. This is the first vertical slice, not the entire multi-phase roadmap.

- Collection reads authoritative `TraceabilityDB.Requirements` records for the selected project and saved `xhandle:vnv-test-case-documents` records. It does not use the latest global verification mirror or generic storage scanning as an automation source. Project/source-project conflicts and foreign nested test ownership are rejected.
- Generated lifecycle arguments carry stable evidence roles. Existing lifecycle design/verification goals are recognized conservatively by template, layout role and exact legacy title. Users can assign a role to another node or choose manual allocation only. Requirement-link nodes can receive tests explicitly targeting their linked requirement.
- Requirements allocate to the design argument as reviewable artifacts. Tests allocate to verification only when their explicit target resolves to a collected project requirement. Unknown targets remain visible in completeness findings. There is no keyword-based automatic substantiation.
- Test plans remain plans. A saved Pass/Passed status with nonempty recorded evidence is represented as a recorded passing result; Fail/Failed/Blocked is negative evidence. These are user-maintained test records, not independently attested execution runs. No automatic allocation changes a human-authored claim status or acceptance.
- A service mounted once in `App` maintains cases when the Safety Case view is closed. It runs on startup, source notifications and focus, with a 30-second catch-up interval for legacy writers lacking events. Debouncing and per-project snapshots coalesce work. Closing the application stops collection; reopening catches up.
- Stable document/test and requirement identities, SHA-256 content revisions, allocation origin, rule version and rationale are persisted. Changed revisions remain flagged until explicitly acknowledged; missing sources retain their last known descriptions. Failed and planned evidence cannot silently become current support. A lost requirement trace remains visible on an earlier allocation.
- Authoring and automatic state are separate. A transactional updater reads the latest committed case and changes automatic state only. Manual saves merge the latest automatic state inside the write transaction. Editor update events refresh the evidence snapshot while retaining unsaved names, wording, positions and manual links.
- The inspector shows evidence outcomes, provenance/location, rationale, recorded evidence and state, with exclusion/restoration and revision acknowledgment controls. Exclusions persist through refresh/restart. The header exposes collection progress/errors and pause/resume; diagram counts include automatic links. Lists display in pages of 50 without truncating collection.
- Automatic state survives normalization, JSON serialization and duplication, including remapped allocation node IDs. Malformed imported automatic collections are normalized defensively. Existing JSON export includes the collected snapshot and metadata, but is not a complete portable evidence bundle.

## Prerequisite fixes

- Removed silent cross-project/workspace fallback from evidence discovery and context construction. Rechecked ownership after flattening IndexedDB wrappers and retained inherited ownership for conflict detection. Unowned records remain browsable without a selected project but are withheld from project-scoped candidates.
- Completeness uses support relationships and node roles rather than any child. Linked artifacts require resolution; planned/failed verification is flagged. Context-only support, unresolved evidence and draft nodes cannot yield a Supported overall status.
- Graph cycle detection uses iterative traversal. The previous unbounded descendant walk was removed; deep imported graphs are covered by a 12,000-node check. Diagram collapse and node deletion also guard against repeated descendants.
- Evidence checks resolve manual links against the picker index and current automatic catalog on demand. Missing automatic artifacts are not injected as live manual evidence. Source-change notifications invalidate cached resolution.
- Failed primary and fallback saves now reject instead of announcing false success. Attachment saves wait for transaction completion and reject aborted commits. Background checkpoints advance only after a successful transaction. Deletion requires a successful primary transaction and removes all fallback mirrors so deleted cases do not reappear through fallback merging.
- Evidence recommendations accept only IDs actually submitted in the model's candidate set. Existing broader AI argument generation remains a reviewed suggestion workflow; this implementation does not claim a complete redesign of that workflow's validation.

## Workspace graph decision

Inspected the existing migration, freshness and query paths. The graph already indexes requirements and test cases and creates explicit verifies relationships, but its relevance/retrieval paths are capped and it includes multiple legacy requirement identities. Making a safety-case inventory depend on a broad migration or a relevance result would add unnecessary uncertainty to this slice.

The new source adapters read the two authoritative collections directly, with project-scoped requirement reads and shared per-project snapshots during each reconciliation pass. They deliberately leave workspace-graph migration/retrieval behavior unchanged. A later adapter can reuse validated canonical graph records once exact coverage, freshness and source identity are established. No second workspace-wide indexing database was introduced.

## Validation

Final targeted and adjacent regression run:

```sh
CI=true npm test -- --watch=false --runInBand \
  --testPathPattern='safety-case/.*test|VnVCenterPro.navigation|workspaceGraphSync.integration|reviewStorePersistence|permanentlyDeleteStoredProject|workspaceMutationExecutor' \
  --silent
```

Result: **100 tests passed across 16 suites**.

Coverage includes initial rendering; unsaved editor changes during background updates; visible save failures; generated evidence roles; explicit trace allocation; plans versus recorded results; failures, changes, missing artifacts and lost targets; foreign/unowned/conflicting ownership; nested localStorage and IndexedDB records; inventories exceeding 500 records; stable revision hashes; idempotence; exclusions and restart; malformed imports; duplication and JSON roundtrips; source failure; commit failure; attachment transaction abort; startup, pause, retry, event coalescing and cleanup; cyclic and deep graphs; and exact AI candidate grounding.

An integration test uses real fake-IndexedDB-backed stores, real source adapters and the actual reconciliation/runtime code without mounting the Safety Case view. It verifies initial allocation, a later failing result, and deletion becoming missing evidence. Adjacent existing suites cover V&V navigation, workspace-graph synchronization, review persistence, permanent project deletion and collaborator workspace mutations.

The editor tests caught an introduced initial-null-state dereference during development; it was fixed and the regression test now passes. New lint warnings from mixed Boolean expressions were also corrected. Initial test-harness failures involving mock reset, ESM icons and fake IndexedDB globals were corrected before the final passing run.

`npx eslint src/features/safety-case --max-warnings=0` passed. App lint was compared against `HEAD`: both have zero errors and the same 19 existing warning messages/rules. `git diff --check` passed.

`npm run build` passed on the final implementation (exit 0). It compiled with existing repository warnings, an outdated Browserslist dataset notice and the existing bundle-size notice; no Safety Case feature warnings remain in the final build log. Build output was checked at `/tmp/xhandle-safety-case-build.log`.

## Remaining scope and verification limits

- Automatic adapters for hazards/risk, architecture, remediation execution runs, reviews, governance, operational context and baselines are not implemented in this slice. Requirements maintained only in other feature-specific stores are not automatically collected yet.
- Frozen configuration/acceptance binding, full review history, complete evidence bundles with file bytes and manifest verification, and richer source navigation remain follow-up work. Current per-artifact snapshots preserve last observed data, not a complete immutable history of every source revision.
- Same-workspace automatic/manual writes are protected by transactional separation, but simultaneous whole-argument manual edits in different tabs still use the existing editor's save semantics. The service does not promise collaborative document merging.
- Generic manual evidence discovery retains its legacy scan caps/timeouts and category inference. Unresolved manual links are reported conservatively; they are not automatically deleted. Broader legacy folder/module ownership inference is intentionally withheld where project ownership cannot be proved.
- No live user datasets, external AI service, deployment or commit was used. Verification consisted of automated unit/component/integration tests, lint and build; there was no full desktop/browser visual acceptance session or full-repository test run.

These checks provide regression evidence for the delivered behavior, not a guarantee that all bugs are absent. The next product increment should extend the same explicit adapter/rule lifecycle to hazard → mitigation → implementation → executed verification traces, followed by configuration-bound review and portable evidence bundles.
