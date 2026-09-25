# Stop the functional decomposition asking settled setup questions

## Objective

A request to draft a functional decomposition must produce the abstraction
picker, and the reviewer's selection must lead straight to a generated
seven-column table. No setup question at any point: a draft modifies no project,
so there is nothing to ask about.

Observed, twice in one thread:

    Create a functional decomposition for a Warehouse Yard Truck.
    > Should this be created as a new project or added to an existing one
      (e.g. 'Atoms Transport'), and should the rows use system-level or
      subsystem-level control actions?

with no abstraction picker at all. Answering "no" then produced the draft.

## Confirmed findings

### F1 — The workspace action planner claims the request (root cause)

`isWorkspaceMutationIntent` (`src/features/collaborator-workspace/workspaceActionPlan.js`)
matches on a mutation verb plus a workspace noun. "**Create** a functional
**decomposition** for a Warehouse Yard Truck" satisfies both, so `runCopilot`
took the planner branch, the planner returned `intent: "clarify"`, and the
handler appended the clarification and **returned** — before the abstraction
gate, before generation.

This is why adding a "generate now, do not ask another setup question" directive
to the request changed nothing: the model that asked the question was the
*planner*, which never sees that directive.

`isFunctionalDecompositionMutationRequest` already has exactly this guard
(`functionalDecompositionDraftIntent && !explicitApplyToFunctionalTable` →
`false`). `isWorkspaceMutationIntent` did not.

### F2 — A consumed selection is replayed onto a repeat request

`recoverCompletedFunctionalAbstractionLevel` matched the last completed
`functional-abstraction` choice by comparing its preceding user message to the
current request **by text**. Typing the same sentence a second time therefore
inherited the first turn's answer, `runCopilot` set `abstractionResolved: true`,
and the picker was skipped. The selection had already been consumed by the
earlier turn.

### F3 — The directive was dead code on the live path

`generateFunctionalDecompositionWithCollaborator` builds its own request message
carrying the directive **only when the caller supplies no `messages`**. The live
caller always supplies the full prompt history, so that copy was never used.

## Changes made

1. `isFunctionalDecompositionDraftRequest()` (exported from
   `XHandleCopilotView.jsx`) identifies a draft request: an explicit
   functional-decomposition generation request that is neither a
   create-project-from-rows command nor an apply-pending-rows approval. The
   workspace-planner branch is now guarded by it. "Add a braking subsystem to
   the Atoms Transport project" is still a planner mutation.
2. `recoverCompletedFunctionalAbstractionLevel()` recovers a selection only when
   no user message follows the choice — the selection still belongs to the turn
   being run. The existing exact-text check is kept on top of it.
3. `withFunctionalDecompositionDirective()` appends the directive to a supplied
   prompt history when it is not already present, so every generation carries
   it exactly once.

## Tests

`src/components/XHandleCopilotView.test.jsx` — the file mocks `react-markdown`,
so the component module *is* importable from a test:

- A repeated identical request recovers no level and re-opens the picker.
- A selection that belongs to the running turn is still recovered.
- A draft request is excluded from the planner while `isWorkspaceMutationIntent`
  still claims it, and real edits and apply/create-project commands are not
  excluded.
- The directive is appended once, is not duplicated, and is detected inside
  multi-part content.

Full suite: 951 passed, 2 skipped. `npx react-scripts build` compiles.

## Constraints

- Preserve unrelated changes in the dirty working tree; no destructive Git
  operations; do not commit unless asked.
- `XHandleCopilotView.jsx` has absorbed seven defects from scripted edits that
  the full suite passed. Verify edits by reading the result and run the
  production build, not only Jest.
