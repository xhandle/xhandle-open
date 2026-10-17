# Duplicate local connection review

Reviewed 2026-10-17. Production code unchanged by this review.

## Remaining findings

1. **P2 — Reusing a saved connection from a blank setup form overwrites its settings.** The chooser updates source provenance only. Verification builds a fresh repository configuration from the blank draft and preserves only the existing repository ID. Upsert then overlays that configuration on the saved connection. Executing the actual `makeRepoConfig`, `verifyCodeArchitectureRepo` and `upsertCodeArchitectureRepo` functions with a reused source reproduced saved analysis context becoming an empty string and selected extensions becoming an empty array. Source/repository IDs were correctly retained. Preserve the selected existing connection's context, file-type selection and configuration in the draft when reusing it; distinguish explicit edits from untouched defaults. Locations: App.js local chooser onChange, verifyCodeArchitectureRepo and upsertCodeArchitectureRepo.

2. **P2 — “Remove unused connection” does not establish that the connection is unused.** The button checks only inactivity and absence of `lastAnalyzedAt`. That timestamp is set on successful completion; interrupted analysis can have recoverable checkpoints without it. The handler removes the configuration without inspecting rows, metadata, checkpoint or pending publication state. Stored records are not deleted, but their project connection and normal recovery route disappear. Executing the actual handler confirmed it removes any such inactive entry. Before calling a connection unused or removing it, inspect persisted/in-memory work and protect recoverable analyses; alternatively provide a deliberate archive flow with a restoration path. Location: App.js dashboard Remove unused connection handler.

## Verified

- Explicit same-name choice prevents silent name-based merges.
- Reconnect and reuse preserve source identity; verification now preserves repository storage identity.
- Separate same-name folders remain separate when explicitly chosen.
- Pending duplicate choices block verification.
- 45 tests passed across seven suites. git diff --check passed.

No production changes, paid-provider requests, or direct access to the user's browser data. No guarantee of absence of other bugs. Existing passing tests do not cover settings preservation or removal with saved checkpoints.
