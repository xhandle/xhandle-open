# Fix subsystem description persistence

Implement the confirmed findings in docs/investigations/subsystem-description-persistence-review.md.

1. Preserve saved container descriptions and user-edit metadata during Auto arrange and category-layout rebuilds, matching stable IDs or unambiguous compatible identities. Preserve existing layout algorithms, hierarchy, and automatic descriptions for untouched/new groups.
2. Make explicit subsystem/system modal Save persist synchronously and verify success before closing. Cancel remains a draft discard. On storage failure keep the modal and draft available with a clear retryable error; handle wrappers that swallow storage exceptions.
3. Disable and guard Save while AI generation is pending. Late responses must not update a reopened modal or another project with the same node ID.
4. Preserve all current uncommitted diagram work and existing function/edge editing, manual creation, resizing, imports, and undo/redo.
5. Add meaningful regression tests for Save/reload, Auto arrange metadata preservation, blocked Save during generation, stale responses, and failed writes/retry. Re-run the browser reproductions with mocked AI responses in isolated Chrome/WebKit storage. No customer data or paid API calls. Record validation. Do not commit or push.
