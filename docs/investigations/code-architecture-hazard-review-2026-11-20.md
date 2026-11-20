# Code architecture and hazard-analysis review

Status: review complete; identified issues fixed; all 18 comprehensive Electron verification categories passed on the unchanged final source. No unresolved confirmed findings remain in the reviewed workflows. The reviewed changes were committed, pushed and published in [Desktop 0.2.19](desktop-0.2.19-publication-2026-11-20.md); that record identifies the frozen builds and completed release gates. The user confirmed successful Chrome analysis and excluded Safari from this update.

## Scope and approach

Reviewed source acquisition for GitHub and local folders, immutable revision/content checks, file/chunk completion and retry limits, checkpoint writes, architecture classification, functional-model readiness, publication recovery, and cancellation. Reviewed the Code-Based Architecture STPA and HARA dispatch paths, applicability screening, assessment generation, deterministic ratings, evidence/assumption handling, user-owned values, context selection, interrupted runs, final saves, and downstream hazard-derived requirements. Checked the retained legacy runner where these lifecycle and ownership rules are shared; FHA compatibility remains covered, although it is absent from the current Code-Based Architecture method menu.

The earlier rate-limit, storage-abort, Projects HARA repair and traceability changes remain in the pending changeset. This review adds targeted failure reproductions rather than relying only on those previously passing tests.

## Findings and fixes

### Stop did not reach every architecture stage

Repository-context understanding, nested architecture allocation and component-description requests did not receive the analysis signal. Their fallback handlers could also convert a cancellation or provider-settings mismatch into an ordinary deterministic fallback. Evidence enrichment and cooperative trace-ID preparation lacked cancellation checks, and the App's save-only publication retry omitted its signal.

The same run signal now reaches these operations. Cooperative processing checks it between work units, and cancelled reads cannot fall through to legacy source storage. Cancellation and settings mismatches propagate instead of entering optional AI fallbacks; ordinary provider failures retain the existing fallback behavior. The main generator also checks cancellation before writing its initial extraction checkpoint after context analysis.

Seven tests execute the actual request/classification helpers with controlled provider and storage boundaries, including cancellation during each AI stage, cancelled evidence retrieval, ordinary fallback, and settings mismatch. The existing publication-storage tests cover cancellable publication.

### A queued request could use changed provider settings

The run guard checked settings before waiting for a paced request start, but constructed authentication/provider headers after that wait. A settings change during the queue could therefore send source using the new settings before the response guard rejected the run.

Settings and cancellation are checked again immediately after pacing and before sending. A regression test changes settings during the wait and verifies that no request is made.

### Missing selected context silently broadened the hazard analysis

An unavailable selected context fell back to every effective context while retaining the unavailable selection in run metadata. This could assess a broader scope than requested and produce misleading context provenance.

Input preparation now rejects the unavailable selection with an actionable message. STPA/HARA runner tests verify rejection before provider calls or initial recovery saves, with the previous run untouched. Shared input tests also cover FHA compatibility.

### Scoped hazard runs dropped edits from other contexts

Reproduction: assess driving and parked contexts, accept an exclusion in the parked context, rerun driving alone, reload, then rerun All contexts. The latest run lost the parked-context ownership record, allowing the accepted exclusion to become a generated Yes. Tests reproduced this in both STPA and HARA before the fix.

The completed scoped run now retains other-context ownership and its original row identities without displaying those contexts as newly assessed. Positional `HA-*` IDs are reserved when they belong to governed edits: an unrelated new row receives a run-qualified ID so it cannot inherit a decision for another context. The legacy runner likewise avoids inactive-ID collisions and keeps the identities needed for later reconciliation. Normalizing a legacy run now preserves its supplied ownership records even without a compact-pipeline version marker.

Regression tests cover scoped analysis, ID collisions, real storage save/reload, and re-expansion to all contexts for STPA and HARA. The legacy path has a separate normalization/re-expansion test with a deliberately colliding generated ID. Existing archive/ownership checks remain unchanged.

### Hazard requests could disagree with their checkpoint settings

The hazard checkpoint factory read model/effort preferences lazily, while requests built provider headers independently. Changing settings during a long analysis could mix request settings or accept a response under a checkpoint namespace for different settings.

The compact runner now captures provider, model and effort together once. It uses that frozen snapshot for checkpoint scope and checks it before provider work and after responses. The transport rechecks before every physical request, including retries after a 429 wait. A mismatch interrupts the run with saved partial recovery; it cannot become assumption-based completion. The pipeline version advances to v8 so potentially mismatched older checkpoints are not reused; saved analysis results remain readable.

Tests cover provider, model and effort changes during a response, suppression of a request after settings change during Retry-After, and failure priority over provider fallback. The four focused pipeline/transport suites passed 72 tests before the final full gate.

## Verification

- Focused architecture/hazard suites: 111 tests passed, including the new ownership and context-scope reproductions.
- Request lifecycle: seven tests passed. These Node tests are automatically discovered by the comprehensive harness's backend/diagnostic suite.
- Comprehensive harness: **passed**, all 18 categories, macOS arm64 / Electron 45.0.0, 526 seconds. Evidence: `/private/tmp/xhandle-0.2.19-architecture-hazard-comprehensive-20261120/report.json` and `report.md`.
- Frontend: 4,406 passed, four existing skips, zero failures across 488 suites. Backend/diagnostics: 133 passed; archive capacity: 13 passed; native Node: 49 passed; native Python release validators: 19 passed.
- Fresh production build, native startup/storage reload, workspace interactions, Projects/Code HARA, hazard and platform organization profiles, design/traceability, artifact generation, derivation, downstream safety inheritance, collaborator context and worker responsiveness all passed.
- Final source fingerprint: `308ef7787cdfa9ce6e67dc29b053ea2201216a503c10ff380fe9b6826016065e` (1,207 files); `sourceChanged: false`. Final lint over the 36 changed application/test files reported zero errors and existing warnings. `git diff --check` passed.
- Two earlier runs were deliberately stopped: the first for regression-test import ordering, the second to include the subsequently identified hazard settings/checkpoint fix. Their reports remain at `/private/tmp/xhandle-0.2.19-architecture-hazard-review-20261120/report.json` and `/private/tmp/xhandle-0.2.19-architecture-hazard-final-20261120/report.json`. They are superseded by the final comprehensive run.

The comprehensive gate uses a fresh production renderer in the real macOS arm64 Electron host, isolated temporary profiles, synthetic workspaces, and controlled provider responses. It covers frontend/backend/capacity/native tests, workspace navigation, HARA/STPA, organization guidance, design/traceability, artifacts, derivation, safety inheritance, collaborator context and worker responsiveness. Its source fingerprint must remain unchanged through completion.

## Behavior and limits retained

GitHub quota waits remain outside network deadlines, share a cooldown across source workers, and retry the same pinned request. Closing the app still requires explicit checkpoint continuation after reopening; automatic continuation applies while the app stays open. Authentication/permission errors do not become quota waits.

File completion does not claim a complete runtime call graph. Python has a syntax inventory; other languages use bounded model extraction with coverage limitations retained in the run. Architecture publication remains separate from incomplete extraction, and a failed functional abstraction remains explicit metadata rather than a valid current functional model.

STPA applicability and safety significance remain distinct. HARA S/E/C classifications are proposed assessments with rationales; ASIL is calculated locally using the shared deterministic matrix. Governed exclusions are retained and excluded downstream cells remain marked accordingly. The results-first hazard pipeline can produce explicitly labelled assumption-based bounding assessments after bounded provider/row recovery; successful generation is not approval of those assumptions or confirmation of source defects. Narrative review and HARA findings remain part of engineering review.

Controlled tests do not establish live-provider assessment quality, a customer's specific GitHub permissions, standards conformance, or the original Safari abort's cause. Safari is outside the release blocker scope at the user's direction.

## Commit and desktop update preparation

Target desktop version: 0.2.19 for macOS arm64 and Linux x64, retaining the Windows 0.2.16 feed. Shared application changes stay in this repository. The prepared private desktop patch bumps package/lockfile versions and adds the new source, lifecycle, hazard/context and ownership regressions to its shared checks.

The exact desktop submodule pin must be the reviewed shared commit after publication. Official packages require clean committed checkouts, matching source provenance, destination-OS Mac/Linux builds, packaged smoke checks and release receipts. Mac distributions additionally require verified signing/notarization. Validate the complete selected-platform updater asset set before public promotion. The local regression stage is review evidence, not a signed 0.2.19 installer or a published update.

The shared and private desktop remote main branches still matched their local review baselines when checked. The desktop patch passes `git apply --check`; the private checkout remains clean. The combined readiness record, reviewed-file manifest, shared review patch, desktop patch, proposed commit text and publication sequence are prepared in `/private/tmp/xhandle-0.2.19-release-preparation/`. Native Linux execution and official Mac signing/installer validation remain post-commit release gates.
