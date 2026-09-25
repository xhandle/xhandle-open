# Complete the hazard-analysis data-integrity fix

## Objective

Hazard analyses in xHandle have been permanently destroyed during Vibe Review
activity. Earlier work fixed two confirmed destruction mechanisms and added a
revision journal, but that work is **not wired through end to end**: recovery
exists only as unused library functions, compare-and-set has no production
caller and is not atomic, the pre-review checkpoint is neither awaited nor
protected from pruning, and several persistence failures are still reported as
success.

Finish the job so that:

**No defect — including one not yet discovered — can permanently destroy a
hazard analysis, and a user can recover one without developer tools.**

Work in `/Users/Nick/xhandle-open`. The working tree is dirty and contains
unrelated user changes; preserve them.

## How to read this document

Everything in "Confirmed findings" was re-verified against the working tree on
2026-09-21 by locating the actual call sites, not by trusting a prior report.
Line numbers are current but will shift; locate by content.

Sections marked **[operational]** come from having done the preceding round of
work in this repository. They are not theory — each one records a defect that
actually occurred, or an invariant that was actually violated. Read them before
you touch anything; they will save you from repeating the same mistakes.

---

## Environment reality — read before planning your tests **[operational]**

The test harness cannot do several things you will be tempted to assume.
Verified:

- **No browser/e2e tooling.** No Playwright, Cypress, Puppeteer, or WebDriver.
  The only runner is `react-scripts test` (Jest + jsdom).
- **No `fake-indexeddb`.** `projectHazardAnalysisStorage.test.js` does
  `jest.mock("idb")` — it replaces IndexedDB wholesale. **A transaction-atomicity
  test written against that mock asserts on your own mock and will pass whether
  or not the real transaction is correct.**
- **`XHandleCopilotView.jsx` cannot be imported in a test at all** — it pulls in
  `react-markdown`, which is ESM and untransformed. Any logic that needs a test
  must live outside that file.
- **`App.js` (~21k lines) and `XHandleCopilotView.jsx` (~8.6k lines) have no
  unit coverage.** The production build is currently the only automated check on
  them.

Consequences you must act on:

1. Add `fake-indexeddb` as a dev dependency and write the transaction,
   interrupted-write, and deletion tests against **real IDB semantics** with the
   `idb` mock removed for those suites. Without this, F1 cannot be honestly
   verified.
2. True cross-tab and true reload cannot be unit-tested here. Either add browser
   tooling deliberately, or implement them as **module-level simulations plus
   documented manual steps** — and say which you did. Do not claim coverage you
   do not have.
3. Anything you need to test must be extracted into an importable module first.

---

## Landmines in this codebase **[operational]**

Each of these caused a real defect during the previous round.

**1. The backend spreads the entire chat request body into the provider call.**
`server.js:2345` (and 2357, 2371, 2394) do `body: { temperature: 0.2, ...body }`.
Adding any field to a `/api/chat` request body — telemetry, a version stamp,
anything — forwards it to Claude/OpenAI as an unrecognised parameter and breaks
every AI proposal, surfacing only as "the model did not return a usable
structured proposal." Guarded by
`src/features/project-hazard-analysis/hazardProviderRequest.test.js`; keep that
test passing.

**2. Live data must be paired with live identity.** The cross-project write that
destroyed analyses came from checking `activeProjectId` from a React render
closure while reading artifact state from `analysisResultRef.current`. The guard
passed against a stale identity and then wrote the *currently loaded* project's
analysis under the *old* project's id. **Any read of a live ref must be
validated against a live identity ref.** Mixing the two is the generator of this
entire bug class.

**3. Row IDs are a content hash and must stay materialized.**
`ensureHazardAnalysisRowIds` (`classificationResolutionStatus.js:53`) synthesizes
`RAW-…` ids from an FNV-1a hash of the row's cells. They are stable **only
because `ensureClassificationResolutionStatus` materializes them into the
persisted rows** via `identifiedSummary.slice(1)`. If a change stops persisting
them, ids become content-derived and drift on every edit, silently breaking the
review queue, the fingerprint check, and undo.

**4. The proposal snapshot and the apply path must read the same column view.**
`getHazardVibeReviewState` and `applyHazardVibeReviewDecision` both read through
`removeProposedSafetyAssessmentColumns`. A proposal is fingerprinted from one and
re-checked against the other; any column-set difference reads as "the row
changed" and refuses valid decisions.

**5. Session compaction must never trim a field undo reads.**
`compactReviewSession` takes `trimmableDecisionFields` per domain. Hazard undo
restores from `previousGovernedFields`; **functional undo rebuilds the row from
`previousRow` and reverses propagated reallocations from `affectedRows`**.
Trimming those breaks undo for decisions older than the retention window.

**6. A thread's review sessions are stored as a STACK, not a bare object.**
`Object.values(sessions)` now yields arrays. Reading `session.threadId` off them
silently yields `undefined`. This broke Collaborator thread retention — active
review threads lost their protection under exactly the storage pressure a long
review creates. Verified that `copilotThreads.js:29` is now the only external
reader and handles both shapes; if you add another, handle both.

---

## Product invariants that are NOT bugs **[operational]**

Do not "fix" these.

- **Safety Significant is governed by the reviewer**, not derived from Safety
  Classification. This is a recorded product-owner decision (2026-09-20).
  `reconcileDerivedSafetyColumns` seeds it only while blank or `Needs Review`
  and never overwrites an explicit Yes/No.
- **A classification that contradicts a governed significance will not close a
  policy gap.** The review holds position and reports the conflict. This is the
  designed consequence of the ownership model and will look like a bug if you
  are not expecting it.
- **A follow-up review whose target already exists further down the stack
  resumes rather than duplicating.** `duplicateOfSuspendedReview` at
  `XHandleCopilotView.jsx:5637` exists to stop a re-entrant cascade.

---

## Confirmed findings

### F1 — Compare-and-set is unused and not atomic (High)

`saveProjectHazardAnalysisRecord` accepts `expectedRevision`
(`projectHazardAnalysisStorage.js:177`) and checks it, but **no production caller
supplies it** — a repository search finds it only in the storage module and its
test. Every production write is unconditional last-writer-wins.

The check is also not atomic: head `get`, revision `put`, and head `put` are
separate operations. Two tabs can both read revision N, both pass, and both
write N+1.

Review commits call the save without a revision at `App.js:11232` and
`App.js:11283`.

### F2 — The pre-review checkpoint is neither ordered nor durable (High)

`XHandleCopilotView.jsx:7021` calls `checkpointHazardAnalysis(...).catch(() => {})`
— **not awaited** — then immediately creates the review session.
`checkpointHazardAnalysis` (`projectHazardAnalysisStorage.js:119`) reads the head
*before* joining the write queue, so a fast first mutation can land first and the
checkpoint can capture already-mutated state.

It is also an ordinary rolling revision: `RETAINED_REVISIONS = 5` (`:15`) and
`pruneHazardAnalysisRevisions` (`:254`) will prune it during any review longer
than a few writes.

### F3 — Recovery exists only as unused library functions (High)

`listHazardAnalysisRevisions` (`:64`) and `restoreHazardAnalysisRevision` (`:86`)
have **no production callers**. No recovery UI, no automatic fallback when the
head is missing or invalid. Data can survive in IndexedDB and remain
operationally unrecoverable.

### F4 — Full revisions multiply quota pressure (High)

Every save with rows writes a complete artifact to the revision store *and* a
complete head. Five revisions plus the head hold roughly six full analyses.
**No deduplication**: autosave, each review commit, regeneration, and checkpoints
all create revisions even for byte-identical content. For a 210-row analysis with
long text cells this accelerates the same quota exhaustion associated with the
incidents.

### F5 — Project deletion leaves every revision behind (Medium-High)

`deleteProjectHazardAnalysisRecord` (`:271`) deletes only the head from
`analyses`; `analysisRevisions` keys are never removed. This contradicts the
delete confirmation ("This will remove its locally stored data") and consumes
quota indefinitely.

### F6 — Review Center reports success after persistence failure (Medium-High)

`saveReviewItems` (`reviewStore.js:65`) catches an IndexedDB failure, logs,
dispatches an event — then **returns the input list as though saved**.
`ResultsReviewProvider.persist` (`:65`) resolves normally and keeps optimistic
in-memory state, so the UI can report evidence as saved when it will vanish on
reload.

### F7 — The cascade test does not exercise production orchestration (Medium)

`src/features/vibe-review-engine/cascadeReentry.test.js` reimplements the
`alreadySuspended` decision and manually pops the stack. The production logic is
inline at `XHandleCopilotView.jsx:5637` inside `handleVibeReviewAction`, which
the test never invokes — and cannot, because that file is unimportable. The test
can pass while production diverges.

### F8 — Mixed closure/ref reads remain in hazard commit and undo (Medium)

The commit path reads the analysis from `analysisResultRef.current` but builds
draft rows from the **render closure** `draftHazardRowsByIndex` (`App.js:11186`).
Undo reads `const summary = analysisResult?.Summary` from the closure
(`App.js:11266`) and merges into `analysisResultRef.current`. Build warnings
corroborate: `App.js:11238` and `:11288` report missing `commitAnalysisResult` /
`commitCodeArchitectureHazardRun` dependencies; `:11053` an unnecessary
`analysisResult` dependency.

### F9 — Functional undo throws after committing (Medium)

`XHandleCopilotView.jsx:6008` passes `result.state` inside the **undo** branch,
where the undo result is named `undone`. `result` is not declared until
`const { record, result } = engineOutcome;` at `:6078`, in the same function
scope — so `:6008` hits the temporal dead zone and throws a `ReferenceError`
**after the undo has already committed**. Correct value: `undone.undoResult?.state`.

The identical call at `:6112` is in the commit path where `result` *is* in scope.
**Do not change that one.**

### F10 — Revision APIs collapse distinct failure categories (Medium)

`listHazardAnalysisRevisions` returns `[]` for both "no revisions" and "storage
failed". `restoreHazardAnalysisRevision` returns `null` for missing revision,
unavailable database, and write failure alike. The write path emits a detailed
`xhandle:hazard-analysis-write` event but keeps a boolean return, and **no
production listener consumes it**. A recovery UI cannot distinguish "no backup
exists" from "storage is temporarily unavailable".

---

## Do not regress these — they already work

- Failed hydration is distinguished from a missing record; autosave stays blocked
  after a load failure.
- A populated analysis cannot be replaced by empty state without
  `allowAnalysisClear`.
- Fields omitted from a partial save keep their stored values.
- Same-runtime writes for one project are serialized (`enqueueProjectWrite`).
- Review commits verify the live project id and read the analysis through a live
  ref.
- Row fingerprints reject a commit whose row changed since the proposal.
- The duplicate suspended classification session is detected.
- Review stacks have a maximum depth.
- Audit records carry changed-field diffs, not whole rows.
- Review Center writes incrementally and never dumps a failed collection into
  localStorage.
- Thread retention understands stacked review sessions.
- A revision is written before the head.

---

## Architecture requirements

1. **One transactional hazard repository.** All head/revision access goes through
   a single module owning an IndexedDB `readwrite` transaction spanning head
   read, revision compare, revision insert, head update, and pruning. No caller
   outside it touches the object stores.
2. **Revision-bearing application state.** The loaded head revision travels with
   in-memory hazard state so every mutation passes `expectedRevision`. A mutation
   without a known base revision is rejected, not silently promoted to an
   unconditional write.
3. **Structured outcomes.** Persistence APIs return a discriminated result —
   `ok` / `missing` / `stale` / `blocked-clear` / `quota` / `unavailable` /
   `write-error` — carrying revision and byte size where relevant. Keep the
   boolean `saveProjectHazardAnalysisRecord` as a thin compatibility wrapper, or
   migrate all ~16 callers deliberately. **Inspect every caller first**: several
   use `if (!persisted)`, and a truthy object return would silently disable them.
4. **Pinned checkpoints as a distinct class**, excluded from ordinary pruning,
   released only when their review completes or is explicitly stopped.
5. **Testable orchestration.** Extract cascade transition selection into a pure
   module that `XHandleCopilotView` calls. Prefer new logic in testable modules
   over `App.js` and `XHandleCopilotView.jsx`.

---

## Implementation sequence

Two phases. **Phase A is independently shippable and closes the data-loss
class.** Consider stopping and reporting between phases; attempting all of it in
one pass is how defects were introduced last time.

### Phase A — persistence integrity (F1, F4, F5, F10)

1. Add `fake-indexeddb`; establish a suite that exercises real IDB semantics.
2. Build the transactional repository with the discriminated result type. Keep
   the boolean wrapper.
3. Thread the head revision through hazard state; pass `expectedRevision` from
   commit, undo, autosave, and regeneration. On conflict, reload and reconcile —
   never retry a stale full snapshot.
4. Deduplicate byte-identical saves. Use `navigator.storage.estimate()` where
   supported; surface low-storage and quota conditions before data is endangered.
5. Delete head and all project revisions in one transaction (or implement a
   visible recoverable-trash policy). Behaviour must match the delete
   confirmation text.

### Phase B — orchestration, recovery, and reporting (F2, F3, F6–F9)

6. **Extract the cascade decision module first** — F7's test depends on it, and
   several later steps are easier once orchestration is importable.
7. Fix F9 (`undone.undoResult?.state` at `:6008`); add the undo continuation test.
8. Pinned pre-review checkpoint: created inside the project write queue,
   **awaited** before the first actionable review card, pinned for the review's
   lifetime, released on completion or stop.
9. Eliminate mixed closure/ref reads in commit and undo; resolve the flagged hook
   dependency warnings.
10. Propagate structured persistence outcomes through `saveReviewItems` and
    `ResultsReviewProvider.persist`. **If the hazard decision committed but
    audit/evidence persistence failed, preserve the decision** and report
    incomplete bookkeeping explicitly.
11. Recovery UI: list revisions and checkpoints with timestamp, revision, row
    count, write reason, and checkpoint status; support preview and explicit
    restore; when the head is missing or invalid but a valid revision exists,
    offer recovery instead of an empty analysis.

---

## Required tests

Every behaviour needs a test that fails without the change. Note the harness
constraints above and state honestly which are real and which are simulations.

**Against real IDB (`fake-indexeddb`, `idb` mock removed):**
- Two writers read revision N; the second receives an explicit conflict and does
  not replace the first.
- An interrupted write between revision insert and head update leaves the
  previous head intact and the orphan revision discoverable for restore.
- Project deletion removes head and all revisions (or moves them to trash).
- Byte-identical save creates no new revision.

**Module-level:**
- Quota failure during a review preserves the head and all pinned checkpoints and
  is reported, not swallowed.
- Checkpoint ordering: no actionable review card before the checkpoint is
  durable; the checkpoint holds pre-review content.
- Checkpoint retention through a review longer than `RETAINED_REVISIONS`.
- ≥100 sequential review decisions without unbounded storage growth.
- Functional undo continuation commits and loads the correct next item.
- **Production cascade**, via the extracted module: classification parent →
  significance prerequisite → Safety Significant = Yes → resume the *same*
  classification parent → classification accepted → return to the original queue.
  Assert stack depth never exceeds two and no duplicate `(row ID, review target)`
  session is created. Must exercise the production module, not reimplement it.
- User-visible restore: listing, preview, restore round-trip.

**Manual (document as such if not automatable here):** true cross-tab conflict;
reload and project switch at each cascade stage.

**Always:** full existing Jest suite and `npx react-scripts build`.

---

## Manual verification protocol

1. Generate a recognizable hazard analysis; export its CSV as an external control.
2. Start a Safety Classification review on a row whose Safety Significant is
   unresolved.
3. Trigger the significance prerequisite, select Yes, classify, and verify return
   to the next original parent item.
4. Repeat across ≥10 rows; confirm one active session per `(row, target)` and
   stack depth ≤ 2.
5. Reload at each stage: before decision, after significance commit, during the
   classification follow-up, after downstream selection.
6. Confirm row count and an export hash of non-reviewed rows are unchanged.
7. Open a second tab on the same project; mutate in tab A, then attempt a stale
   mutation in tab B. Tab B must receive an explicit conflict.
8. Force IndexedDB rejection / quota exhaustion. The current analysis must remain
   visible after reload, and the UI must report the failed persistence.
9. Run more than five review decisions; verify the pre-review checkpoint is still
   listed.
10. Restore the checkpoint through the UI; compare the CSV to the control export.
11. Delete a test project; verify head and revisions follow the documented
    deletion/trash behaviour.

---

## Acceptance criteria

- [ ] No stale writer can replace a newer hazard analysis.
- [ ] A valid last-known-good analysis always remains recoverable.
- [ ] Starting a review presents no actionable decision until the pre-review
      checkpoint is durable.
- [ ] A 100-item review retains its pre-review checkpoint through completion.
- [ ] Classification → significance → classification returns to the same parent;
      stack depth never exceeds two.
- [ ] Two tabs produce a conflict, never last-writer-wins replacement.
- [ ] Reload/project switch at every cascade stage restores both the analysis and
      the exact review position.
- [ ] Simulated quota failure preserves the head and all pinned checkpoints.
- [ ] Failure between revision and head writes exposes the orphan revision.
- [ ] Users can list, preview, and restore revisions without developer tools.
- [ ] Project deletion removes revisions or moves them to visible trash.
- [ ] Review Center persistence failure is visible and never described as saved.
- [ ] Storage usage stays bounded across 100 review decisions.
- [ ] Functional undo completes and loads the next proposal without error.
- [ ] Hazard analysis, functional decomposition, Review Center, and Collaborator
      behaviour do not regress.

---

## Safety constraints

- **Preserve unrelated user changes in the dirty working tree.** No destructive
  Git operations (`checkout --`, `reset --hard`, `clean`, `stash drop`). Do not
  commit or push unless asked.
- **Inspect all callers before changing any API.** Grep every call site and check
  how the return value is used.
- **Verify edits by reading the result**, not by trusting the edit applied.
  Scripted edits in `App.js` and `XHandleCopilotView.jsx` previously produced
  infinite recursion, an out-of-scope identifier, and a silently ignored
  parameter — **all while the full test suite passed.**
- **Run the production build, not only Jest.** It has caught scope errors every
  test missed, because those two files have no unit coverage.
- **Run the full suite before and after each change.** A previous session
  rewrote a storage function wholesale and silently broke three passing tests
  that encoded requirements it did not know about. Treat existing tests as
  specifications.
- **Do not declare the problem resolved because unit tests pass.** F1–F3 are all
  "green suite, broken product" — the feature existed with no production caller.
  For each finding, cite the call site that proves it is wired through.
- If you find a previous change was wrong, say so plainly and correct it.

---

## Expected final report

1. **Verdict** — resolved / partially resolved, and what specifically remains.
2. **Per-finding disposition** — F1–F10, each fixed / partially fixed / not
   fixed, **with the file and line of the production call site that proves it is
   wired through**, not merely implemented.
3. **Architecture changes** — new modules, the transaction boundary, the result
   type, with paths.
4. **Test results** — suite totals, build status, and each new test with what it
   would catch. State which tests use real IDB and which are simulations.
5. **Verification beyond tests** — call-site greps, build output, anything
   exercised manually.
6. **Known gaps and risks** — anything unverified, any caller not migrated, any
   behaviour depending on manual confirmation.
7. **Manual verification steps** for the user, including how to confirm a
   checkpoint exists before a review and how to restore one.

State clearly which claims are verified facts and which are inferences.
