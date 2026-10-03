# Subsystem description persistence fix

Executed `docs/codex-prompts/fix-subsystem-description-persistence.md` against the reviewed working tree, preserving existing diagram changes.

## Implementation

- Category layout rebuilds now retain saved description text (including intentionally empty descriptions), its user-edit flag/source metadata, color, and manual membership. The merge uses stable IDs or a unique compatible label identity; layout still supplies new geometry. Untouched/new groups continue to use automatic category descriptions. Both Auto arrange and automatic category rebuild callers supply existing metadata.
- Explicit system/subsystem modal Save writes and reads back the group data synchronously before closing. Older debounced writes are cancelled after success, preventing stale overwrites. A failed or swallowed storage write keeps the modal/draft open with a retryable error, without applying the edit to the node.
- Save is disabled and guarded while description generation is pending. Unique request tokens prevent late responses from modifying a reopened modal or a new request with the same node ID. Cancel still discards the draft.

## Validation

- **1,191 tests passed across 128 suites**, with two tests/one suite skipped.
- ESLint: zero errors; the same 11 pre-existing component warnings.
- New tests cover manual/automatic/nested Save, immediate storage durability, Auto arrange, undo/redo, reload, thrown and swallowed storage failures/retry, intentionally empty descriptions, ambiguous identity matches, generation blocking, and Cancel/late responses.
- `scripts/diagnostics/verify-subsystem-description-persistence.cjs` passed all eight scenarios in native automated Chrome and WebKit. Auto arrange and immediate reload now retain the saved text; generation must finish before Save; injected quota failure retains the draft and succeeds on retry. Unsaved generation still does not persist, as expected.
- Existing WebKit CSV replacement checks passed in diagram, table and split views, including complete hierarchy, Auto arrange parity, tab switching and reload.
- Browser results are recorded in `subsystem-description-persistence-fix-results.json`. All fixtures use isolated synthetic storage and mocked AI responses. No customer projects or paid API calls were used.

The original investigation prompt, diagnostic and results remain available for comparison. No commit or push was performed.
