# Hazard-analysis loss-prevention implementation audit

## Executive verdict

**Incomplete, but materially safer than the previous implementation.**

The patch fixes the known cross-project review write, blocks empty-state overwrites after failed hydration, detects the known prerequisite/follow-up re-entry pattern, serializes same-runtime writes, stops Review Center from clearing its store before rewriting it, and creates revision history. Those are substantial improvements.

It is not yet safe to describe the loss issue as completely resolved. The recovery and concurrency mechanisms are not wired through end to end, and several tests validate replicas of the intended orchestration rather than the production orchestration itself.

## Findings

### 1. High — compare-and-set is not used and is not atomic across tabs

`saveProjectHazardAnalysisRecord` accepts `expectedRevision` and checks it before writing, but no production caller supplies it. The only caller found is its unit test. Therefore every production write still behaves as an unconditional last-writer-wins write.

Even if callers supplied the value, the implementation performs `get`, revision `put`, and head `put` as separate IndexedDB operations. Two tabs can both read revision N, both pass the check, and both write revision N+1. The later write can replace the earlier revision and head.

Evidence:

- `src/features/project-hazard-analysis/projectHazardAnalysisStorage.js:177-244`
- Production search finds `expectedRevision` only in the storage implementation and its test.
- Hazard review commits call `saveProjectHazardAnalysisRecord` without a revision at `src/App.js:11232` and `src/App.js:11283`.

User impact: a second tab, delayed regeneration, or stale autosave can still silently replace newer hazard analysis state.

Required correction: perform the head read, revision comparison, revision insert, and head update inside one IndexedDB read-write transaction. Carry the loaded/head revision through application state and require it for mutation paths. On conflict, reload and reconcile rather than retrying an old full snapshot.

### 2. High — the “before Vibe Review” checkpoint is neither ordered nor durable for the review

The review-start path calls `checkpointHazardAnalysis(...).catch(...)` without awaiting it, then immediately creates the review session. `checkpointHazardAnalysis` reads the head before it joins the write queue. A fast first review mutation can therefore land before the checkpoint; the checkpoint may snapshot the already-mutated state rather than the pre-review state.

The checkpoint is also an ordinary rolling revision. Every later autosave or review decision creates another full revision, and only five are retained. A review longer than a few writes can prune the pre-review checkpoint.

Evidence:

- Fire-and-forget start: `src/components/XHandleCopilotView.jsx:7017-7022`
- Checkpoint reads first and only later calls the queued save: `src/features/project-hazard-analysis/projectHazardAnalysisStorage.js:118-134`
- Five-revision rolling retention: `src/features/project-hazard-analysis/projectHazardAnalysisStorage.js:14-15` and `254-268`

User impact: after a long or fast-moving review, the advertised recovery point may not represent the pre-review analysis or may no longer exist.

Required correction: create a distinct, pinned checkpoint record within the same project write queue; await durable checkpoint completion before exposing the first actionable review card. Retain that checkpoint until the review is explicitly completed/stopped and a post-review revision is durable.

### 3. High — revision recovery exists only as unused library functions

`listHazardAnalysisRevisions` and `restoreHazardAnalysisRevision` are exported and tested, but they have no production callers. There is no recovery interface, no automatic fallback when the head is absent/corrupt, and no way for a user to restore the Atoms Transport analysis.

Evidence:

- APIs: `src/features/project-hazard-analysis/projectHazardAnalysisStorage.js:63-116`
- Repository search finds only definitions and unit tests.

User impact: data may technically remain in IndexedDB but is still operationally “not recoverable” from the product.

Required correction: add a Storage/Hazard Analysis recovery panel showing timestamp, revision, row count, write reason, and checkpoint label, with preview and restore. When the head is missing/empty but a valid revision exists, show a non-destructive recovery prompt rather than an empty analysis.

### 4. High — full revisions can increase quota pressure substantially

Every successful save with rows writes a complete hazard artifact into the revision store and then writes another complete copy as the head. Five retained revisions plus the head can hold roughly six full analyses. Debounced autosave, individual review commits, regeneration, and checkpoints all create revisions even when the content is identical.

User impact: the protection mechanism can accelerate the same origin-quota exhaustion associated with the incidents, especially for large 210-row analyses containing long text cells.

Required correction: avoid revisions for byte-identical content; preserve named checkpoints separately; consider compressed snapshots or governed-row deltas between periodic full checkpoints; call `navigator.storage.estimate()` and prevent nonessential evidence writes when remaining capacity is unsafe.

### 5. Medium-high — deleting a project leaves all hazard revisions behind

`deleteProjectHazardAnalysisRecord` deletes only the head from `analyses`. It does not delete keys in `analysisRevisions`.

Evidence: `src/features/project-hazard-analysis/projectHazardAnalysisStorage.js:271-278`.

User impact: deleted project data remains recoverable internally, consumes quota indefinitely, and conflicts with the UI promise that project deletion removes locally stored data.

Required correction: delete the head and every project revision in one transaction, unless the product explicitly implements a trash/restore policy and tells the user.

### 6. Medium-high — Review Center still reports success after persistence failure

The revised Review Center store correctly avoids dumping the whole collection into localStorage, but it catches IndexedDB failure and returns the input list as though it were saved. `ResultsReviewProvider.persist` then resolves normally and retains the optimistic in-memory state.

Evidence:

- Failure swallowed and list returned: `src/features/results-review/reviewStore.js:65-97`
- Provider assumes the queued call succeeded: `src/features/results-review/ResultsReviewProvider.js:65-79`

User impact: the UI and Collaborator may say review evidence was saved when it exists only in memory and will disappear on reload.

Required correction: return/throw a structured durable result. Preserve the hazard decision if its artifact commit succeeded, but explicitly mark audit/evidence persistence incomplete and pause subsequent review activity if required recovery metadata cannot be stored.

### 7. Medium — the exact cascade test does not execute the production UI orchestration

`cascadeReentry.test.js` is valuable, but it reimplements the `alreadySuspended` decision and manually pops the stack. It does not invoke `handleVibeReviewAction`, where the real duplicate detection and continuation ordering live. The test can pass even if the UI implementation diverges.

Evidence: `src/features/vibe-review-engine/cascadeReentry.test.js`, especially `alreadySuspended` and `runCascade`.

Required correction: extract cascade transition selection into a pure production module used by `XHandleCopilotView`, and test that module; ideally add a component-level test that drives the real action handler through classification -> prerequisite significance -> classification -> original queue.

### 8. Medium — remaining stale-closure paths can lose adjacent state

The hazard commit correctly reads the main analysis from `analysisResultRef`, but it builds draft rows from the render-closure `draftHazardRowsByIndex` rather than `draftHazardRowsByIndexRef.current`. Undo reads `analysisResult?.Summary` from the closure before combining it with the live ref. Build warnings also flag missing callback dependencies.

Evidence:

- Draft rows: `src/App.js:11186`
- Undo summary: `src/App.js:11266-11283`
- Build warnings at callbacks ending around `src/App.js:11238` and `11288`.

User impact: rapid sequential decisions or undo during a cascade can restore or persist stale draft/evidence state even when the principal Summary row is correct.

Required correction: make one authoritative transactional hazard state object and eliminate mixed closure/ref reads. Extract commits from `App.js` into a testable repository/service.

### 9. Medium — a functional-review undo regression is present

The functional undo branch passes `result.state` to the next proposal before `result` is declared in that function path. ESLint reports this as `no-use-before-define`; at runtime the undo-success continuation can throw a temporal-dead-zone error after the undo has already committed.

Evidence: `src/components/XHandleCopilotView.jsx:6008`.

User impact: functional Vibe Review undo can appear to fail after changing data, producing another misleading post-commit workflow interruption.

Required correction: pass the already-loaded `state` (or the undo result’s explicitly named state) and add a real undo interaction test.

### 10. Medium — revision APIs hide read/restore failure categories

Revision listing returns `[]` for both “no revisions” and storage failure. Restore returns `null` for missing revision, unavailable DB, and write failure. The hazard write API emits detailed events but keeps a boolean return, and no production listener consumes those events.

User impact: recovery UI cannot reliably explain whether no backup exists or browser storage is temporarily unavailable.

Required correction: retain the boolean compatibility wrapper if needed, but add detailed APIs returning discriminated outcomes (`loaded`, `missing`, `stale`, `quota`, `unavailable`, `write-error`) and use those in new code.

## What is fixed successfully

- Failed hydration is distinguished from a genuinely missing record, and autosave remains blocked after load failure.
- Populated analysis data cannot be replaced by empty/unhydrated state without explicit clear authorization.
- Omitted fields are preserved during partial saves.
- Same-runtime writes for one project are serialized.
- Functional-project review commits verify the active project using a live ref and read the analysis through a live ref.
- Governed-row fingerprints reject changed-row commits.
- The known duplicate suspended classification session is detected.
- Review stacks have a defensive maximum depth.
- Audit records have been reduced to changed-field evidence rather than full rows.
- Review Center no longer clears its object store before rewriting it.
- Active thread detection now understands stacked review sessions.
- A revision is written before the head, so a failed head write can leave a recoverable orphan revision.

## Verification results

- Complete Jest suite: **90 suites passed, 1 skipped; 849 tests passed, 2 skipped**.
- Production build: **completed successfully with warnings**.
- Relevant new tests pass: storage revisions, write serialization, cascade harness, stack depth, active-thread retention, governed decision integrity.
- `git diff --check`: no whitespace errors.
- Build warnings relevant to this work:
  - `XHandleCopilotView.jsx:6008` uses `result` before declaration.
  - Hazard apply/undo callbacks have missing dependencies.
  - The production cascade handler is not directly integration-tested.

Passing tests do not invalidate Findings 1-3: production does not use `expectedRevision`, production does not use list/restore, and the checkpoint is not awaited. Those are direct call-site facts.

## Remaining work before calling the issue completely resolved

1. Implement atomic cross-tab revision transactions and require expected revisions on mutations.
2. Await and pin a true pre-review checkpoint for the lifetime of the review.
3. Add user-visible revision discovery, preview, and restore.
4. Bound revision storage without pruning active checkpoints; deduplicate identical writes.
5. Delete or intentionally retain revisions when deleting projects.
6. Propagate evidence/session persistence failures instead of reporting success.
7. Test the real production cascade orchestration.
8. Eliminate the remaining mixed closure/ref state reads and fix functional undo.
9. Add quota, interrupted-write, multi-tab, project-switch, and long-review browser integration tests.

## Acceptance checklist

- [ ] Starting a Vibe Review does not present an actionable decision until the pre-review checkpoint is durable.
- [ ] A 100-item review retains its pre-review checkpoint through completion.
- [ ] Classification -> significance -> classification returns to the same parent and stack depth never exceeds two.
- [ ] Two tabs editing the same project produce a conflict, never last-writer-wins data replacement.
- [ ] Reload/project switch during every cascade stage restores both the full analysis and exact review position.
- [ ] Simulated quota failure preserves the head and all pinned checkpoints.
- [ ] Simulated failure between revision and head writes exposes the orphan revision for restoration.
- [ ] Users can list, preview, and restore retained revisions without developer tools.
- [ ] Project deletion removes its revisions or clearly moves them to a visible recoverable trash state.
- [ ] Review Center persistence failure is visible and never described as saved.
- [ ] Storage usage remains bounded during 100 review decisions.
- [ ] Functional undo completes and loads the next proposal without error.

## Manual test procedure

1. Generate a recognizable hazard analysis and export its CSV as an external control.
2. Start Safety Classification review on a row whose Safety Significant value is unresolved.
3. Trigger the significance prerequisite, select Yes, classify it, and verify return to the next original parent item.
4. Repeat across at least ten rows; inspect that only one active session exists per `(row, target)` and stack depth is at most two.
5. Reload at each stage: before decision, after significance commit, during classification follow-up, and after downstream selection.
6. Confirm row count and a hash/export of the non-reviewed rows remain unchanged.
7. Open a second tab on the same project, mutate in tab A, then attempt a stale mutation in tab B. Tab B must receive an explicit conflict.
8. Force IndexedDB write rejection/quota exhaustion. Verify the current analysis remains visible after reload and the UI reports the failed persistence.
9. Run more than five review decisions and verify the pre-review checkpoint is still listed.
10. Restore the checkpoint through the UI and compare the resulting CSV to the control export.
11. Delete a test project and verify both its head and revisions follow the documented deletion/trash behavior.
