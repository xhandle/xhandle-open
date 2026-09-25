# Make the hazard analysis loss-proof and the Vibe Review non-re-entrant

Hazard analyses have been permanently lost during Vibe Review activity. Two
independent mechanisms were found and fixed at the source:

1. A cross-project write: the review commit checked project identity from a
   stale React render closure while reading artifact state from a live ref, so a
   decision for project A could be written using project B's loaded analysis and
   persisted under A.
2. A re-entrant cascade: a safety-significance prerequisite raised from a
   classification review pushed a *second* classification review on top of the
   suspended original, so the pair re-entered itself and every cycle wrote
   another full copy of the row into sessions, audit records, and review
   evidence.

Both are fixed. This work addresses what those fixes do not: the analysis is
still held as a single mutable record with no history, evidence writes are large
enough to create the storage pressure that makes failures likely, and
persistence failures are invisible to the caller.

The goal is that **no defect — including ones not yet found — can permanently
destroy a hazard analysis.**

## Required outcomes

### 1. The hazard artifact becomes recoverable

- Store versioned revisions rather than one mutable record.
- Write the new revision first, then update the head pointer, so an interrupted
  write leaves the previous revision intact and reachable.
- Retain at least the last three known-good revisions and prune beyond that.
- Add a compare-and-set check so a writer holding a stale revision cannot
  replace a newer one.
- Expose listing and restoring revisions, so a lost or corrupt head can be
  recovered without a developer.
- Take an automatic checkpoint before a Vibe Review session starts.

### 2. Evidence stops being the storage-pressure engine

- Audit records carry a governed-field diff, not complete before/after rows.
- Review Center writes update individual records instead of clearing and
  rewriting the whole collection.
- A failed IndexedDB collection write must never be dumped wholesale into
  localStorage.

### 3. Persistence failures are visible

- Every hazard write reports whether it durably landed, with its revision,
  serialized size, reason, and failure category.
- A refusal (stale revision, blocked clear) is distinguishable from a genuine
  storage error.

### 4. The re-entrant sequence is pinned by a test

Reproduce the exact sequence that caused the incidents:

    classification parent
      -> significance prerequisite
      -> significance = Yes
      -> resume the SAME classification parent
      -> classification accepted
      -> return to the original queue

Assert: stack depth never exceeds two; no duplicate (row, target) session is
created; exactly one significance and one classification decision are committed;
repeating the sequence does not grow persisted storage without bound.

## Constraints

- Keep the existing `saveProjectHazardAnalysisRecord` boolean contract. Sixteen
  call sites depend on `if (!persisted)`; returning an object would silently
  disable every one of those checks.
- Preserve the protections already in place: partial saves keep omitted fields,
  a populated analysis is never replaced by an empty one without an explicit
  clear, and writes for one project are serialized.
- Prefer changes in testable modules. `App.js` and `XHandleCopilotView.jsx` are
  not unit-testable in this project; three defects have already been introduced
  there by edits that the full suite still passed. Touch them only where
  unavoidable, and verify by reading the result rather than trusting the edit.
- Every behaviour above must be covered by a test that fails without the change.
