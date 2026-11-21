# Append response and hazard worker recovery review — November 21, 2026

Published after review in [Desktop 0.2.20](desktop-0.2.20-publication-2026-11-21.md). That record supersedes preparation/unpublished status below and identifies the frozen source, final requested UI and release evidence.

## User-reported failures and scope

Append completed source processing but stopped during cross-batch integration when a model response began with a Markdown JSON fence. Existing publication and draft progress remained available. The exact provider payload was not supplied; a valid fenced response with surrounding explanatory text reproduces the parsing failure in the previous implementation.

A separate local-development hazard view displayed an uncaught worker `importScripts` download error for a shared JavaScript chunk. A subsequent read of that exact URL returned HTTP 200 with JavaScript. The historical network failure cause is unconfirmed. The draft worker handled its error state but did not cancel the duplicate global error report that triggers the development overlay.

The user explicitly deferred hazard-table scrolling on November 21. No scroll, virtualization, row-cache, or table rendering behavior is changed in this review.

## Changes

- Share a JSON response parser across Append integration, Functional processing and hierarchy allocation. Accept complete raw JSON or exactly one complete JSON Markdown block with optional surrounding prose; support CRLF, uppercase JSON labels, compact fences, tilde fences and longer fences. Reject truncation, malformed JSON, multiple answers and arbitrary prose containing JSON. Preserve `SyntaxError` so the existing bounded correction/retry logic continues to work. Do not expose raw provider/source fragments in parsing errors.
- Retain all existing schema, citation, identity, coverage and source checks. Presentation cleanup does not repair or fabricate model facts.
- Cancel the hazard draft worker's default global error report after handling the failure through the existing retry UI. Seal a completed or failed worker so late messages/errors cannot replace the result or a later retry.

## Validation

The new checkpoint integration regression failed on the old parser, then passed with the fix: an incomplete response leaves the prior publication unchanged; retry accepts the wrapped response, discovers both cross-batch directions, preserves earlier trace IDs, and does not repeat completed source extraction.

Focused parser/integration/Functional/hierarchy coverage: **109 passing tests**. Focused hazard worker/panel/read coverage: **27 passing tests**. Changed modules passed ESLint; `git diff --check` passed. The existing Browserslist data-age notice remains.

Final comprehensive Electron and production renderer recovery results are recorded below after execution. Signing, notarization, installer publication and Linux runtime execution are separate release steps; no such results are implied by the macOS regression harness.

### Final comprehensive Electron gate

**All 18 categories passed** for the final shared source fingerprint `37abc71cc4c75297a3f2efb4a99190c3ac5b72dc25021ca618bb8e00a21c4f5c` (1,216 files). Evidence: `/private/tmp/xhandle-append-release-ready-20261121/report.json` and `report.md`.

- Frontend: **4,476 passed**, zero failures, four pre-existing skipped tests; 491 executed / 493 discovered suites.
- Backend and diagnostic handlers: **140 passed**.
- Large-archive and project capacity: **13 passed**.
- Native Node: **49 passed**; native Python: **19 passed**.
- Fresh production build, native protocol/preload/backend/persistence smoke, populated workspace interactions, Projects and code HARA, organization profiles, design/traceability, artifact generation, derivation, safety inheritance, collaborator context, and worker responsiveness all passed.

The desktop staging is explicitly a review of the uncommitted shared working tree. No shared commit, desktop pin/version update, push, installer signing/notarization, public draft or update-feed promotion has been performed.

### Production Electron Append recovery walkthrough

**Nine checks passed, zero renderer errors**, using 27 controlled GitHub responses and 14 controlled model responses. The walkthrough used the fresh production renderer from the comprehensive gate and a disposable Electron profile. It covered initial C analysis, Cancel, a deliberately malformed integration response, preservation of the earlier publication, saved-progress retry with fenced JSON plus surrounding prose, no repeated file extraction, C→JS and JS→C links with stable earlier identities, coverage limitations, the merged Functional diagram, persistence after reload and explicit Replace.

Evidence: `/private/tmp/xhandle-cross-batch-ui-gSUyuS/result.json` and `connected-functional-diagram.png`. Reproducible runner: `/private/tmp/xhandle-append-json-recovery-ui.cjs`. These are controlled response-format and recovery checks, not a claim about the exact historical provider response, live-provider correctness or customer repository permissions.

Disposition: shared changes are ready for commit/push and subsequent desktop release preparation. Hazard scrolling remains explicitly deferred and unchanged. No installer/update has been published.

### User-requested UI follow-up

After accepting the current connection-verification level, the user requested removal of the entire “Connections between analysis batches” notice. Removed that display from the architecture project view only; discovery, stored coverage/evidence, relationships, publication and recovery remain unchanged. No stricter conclusion gate or additional analysis engine was introduced. The comprehensive and production UI results above describe the source before this display-only removal. Both existing App configuration diagnostic suites passed afterward (10 tests), and `git diff --check` passed.
