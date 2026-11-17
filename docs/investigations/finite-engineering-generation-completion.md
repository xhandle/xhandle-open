# Finite engineering generation runs to completion

The reported project finished Architecture, ConOps, and System Requirements, then stopped before completing Software Requirements because a 15-minute budget expired. The budget was shared across the entire project, so later documents inherited time and request counts already consumed by earlier documents.

Normal project generation now runs its saved finite member/dependency plan inside the existing finite-work budget scope. Normal standalone artifact generation uses the same scope for its finite sections, evidence groups, consolidation rounds, and bounded subdivisions. This removes the arbitrary total 15-minute/120-request interruption from those UI flows rather than replacing it with another elapsed-time ceiling.

The change preserves individual provider deadlines, bounded transport/format/citation retries, consolidation/subdivision bounds, user cancellation, source freshness validation, and transactional checkpoints. An explicitly supplied caller budget remains enforceable. Invalid provider output, unavailable sources, and stalled requests can still pause with completed work retained.

No draft migration or reset is needed for the budget change. Resuming an unchanged project reuses its completed documents, evidence reviews, and sections. Real source changes still require a fresh proposal; the fix does not mark changed evidence as current.

Verification includes a five-document functional-decomposition project completing across an advanced wall clock, a 24-document requirements plan completing 144 requests and publishing its revisions, and standalone completion beyond the former elapsed-time cutoff. Existing timeout/cancellation/late-response tests continue to enforce their boundaries. Freshness checks verify unchanged inputs remain current and actual source edits become stale without modifying the saved revisions.

The Electron artifact-generation fixture also creates the five document types through real UI controls and advances the renderer wall clock by 90 seconds per local synthetic response. Its 24 requests represent 36 minutes of elapsed generation time. This tests the old deadline path without waiting 36 minutes or making paid AI calls. It verifies all five drafts are ready, unchanged sources are current, and joint acceptance survives reload. The production renderer and real browser storage/fetch plumbing are used; model responses and elapsed time are controlled fixtures.

Validation passed: 508 tests in 54 Design Management suites, the production build, focused lint and syntax checks, and all five Electron fixture checks. The final Electron report's renderer manifest fingerprint matches the freshly compiled application.

The change is local and does not alter the published desktop packages.
