# Fix saved hazard-result restoration

Implement a focused restoration fix for completed code architecture hazard analyses temporarily appearing missing after reload.

- Distinguish loading, loaded, empty and failed restoration states. Show a draft/generation actions as an absent saved result only after a successful authoritative empty read.
- Preserve completed results when a background refresh fails. Show an explicit Retry loading action that reads storage without regenerating analysis.
- Scope state to project, connection and repository. Mask departed-scope results immediately and reject canceled/out-of-order reads.
- Respect active generation and intervening edits or clears. A delayed read must not overwrite newer state.
- Publish successfully read results independently of optional imported-context reconciliation saves; report context-save failures separately.
- Re-read when context-version changes invalidate a pending read.
- Keep database schema, generation pipeline and persisted record format unchanged. Do not clear real browser data or rerun paid generation.

Use mounted hook/panel tests for slow reads, success, absence, failures, retries, refresh failures, rapid scope changes, stale responses, context save success/failure and live-run precedence. Run related existing tests and a production build. Document limitations; do not promise zero regressions. Do not commit/push unless requested.
