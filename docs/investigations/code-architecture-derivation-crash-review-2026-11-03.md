# Code-Based Architecture derivation crash review — November 3, 2026

Executed [the review prompt](../codex-prompts/review-code-architecture-derivation-failure.md). The user confirmed that Offer saw **“The workspace window stopped unexpectedly”** while deriving software requirements. His exact installed version, termination reason/exit code, crash dump and actual derivation inputs were not supplied. Known context is an M4 / 16 GB machine, a reported 634 MB retained project/archive, and a Functional decomposition about 50% larger than the developer's earlier largest example. Archive size is not a measurement of live memory.

**Outcome:** confirmed scaling/lifecycle defects and a memory-amplifying input path that could contribute to a large-project failure. The exact cause of Offer's process termination is **not established**. This review made no application-code changes and did not reproduce the customer's native crash.

The desktop recovery controller presents this dialog after a non-clean `render-process-gone` event. It is distinct from an ordinary AI response error or a caught React render exception. The message alone does not distinguish OOM, an abnormal native crash, or an externally terminated workspace process. The recent diagnostics fixes improve evidence collection; they do not optimize the derivation algorithms below or retroactively establish Offer's cause.

## Findings

### 1. [P2] Software derivation fully hydrates saved hazard candidates before its first AI batch

References: `src/features/code-architecture-assurance/EngineeringArtifactPanel.js:525`, `softwareHazardSource.js:7`, `src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore.js:152` and `:178`, `artifactAI.js:618` and `:701`.

`resolveSoftwareHazardSource()` concurrently requests the latest run for up to three repository aliases, with no paged/working-set/summary-only options, then selects the newest candidate after the reads finish. The storage reader's default path reconstructs the full saved run. This also happens before deciding whether an already-provided current run is sufficient. Software safety-requirement import ultimately consumes Summary rows rather than all narrative/detail tables.

The synthetic resolver check observed three alias lookups with no read options. This confirms the calling contract, not three full physical reads in every project: some aliases may have no saved run or hit memory. At least the selected stored run can be fully hydrated, and multiple populated aliases can amplify simultaneous working sets. No customer-sized hazard hydration or resulting heap peak was measured here.

This is an important gap in the previous successful software stress tests: they omitted retained hazard runs and the rest of the full workspace. A large latest hazard run could consume substantial memory before functional derivation starts, even with small AI batches.

Recommended fix: select candidate metadata first, then read/stream only the required summary data using a revision/identity-validated indexed reader; reuse a verified current run when appropriate. Preserve organization/architecture staleness checks, incomplete-run rejection and complete safety coverage. Do not silently drop hazard inputs to reduce memory.

### 2. [P2] All four stages repeatedly scan or rebuild indexes over the full source collection

References: `artifactAI.js:771`, `:1049`, `:1286`, `:1319`, `:1357`, `:1599`; `artifactUtils.js:515` and `:704`.

Software normalization invokes the full-array trace resolver for each generated requirement. The resolver allocates `map`/`filter` intermediates even for an exact trace match. System/subsystem/design category and output normalization repeatedly construct parent-ID maps and architecture-reference maps from the entire source list for individual outputs. Later similarity checks rebuild parent maps again. Final downstream deduplication additionally performs a nested candidate search (`artifactAI.js:2007`), though the diagnostic counts below do not isolate its CPU share.

An instrumented read-only harness exercised the actual exported derivation functions with deterministic local responses. Getter counters measured source identity access across 100 and 150 input rows:

| Stage | Reads at 100 inputs | Reads at 150 inputs | Ratio |
| --- | ---: | ---: | ---: |
| Functional → software | 10,200 | 22,800 | 2.235× |
| Software → system | 97,100 | 216,900 | 2.234× |
| System → subsystem | 96,900 | 216,600 | 2.235× |
| Subsystem → design | 79,300 | 175,350 | 2.211× |

The 50% larger fixtures incurred approximately 2.2× source identity accesses. This is algorithmic-work evidence, not a customer runtime or OOM estimate. Small-fixture elapsed times are JIT/noise-sensitive and should not be extrapolated. The prior software-only Electron test independently observed 106.74 s versus 218.49 s derive/save at 50,000/75,000 synthetic source rows, but did not attribute the entire time to this lookup or reproduce a crash.

Recommended fix: build immutable trace/parent/architecture indexes once per source revision or derivation, preserving exact/ambiguous/historical trace semantics. Reuse canonicalized text and bounded candidate lookup for deduplication. Keep source/result collections bounded where possible and yield expensive normalization work so the UI stays responsive. Five-row network batching alone does not bound these source-wide allocations.

### 3. [P2] Leaving and reopening a tab permits duplicate derivations for the same scope

References: `EngineeringArtifactPanel.js:214`, `:484` and `:559`; `src/App.js:17908`–`:17962`; `artifactUtils.js:59`.

The running flag lives in the mounted panel. Switching artifact tabs unmounts that keyed panel; its outstanding async derivation continues, but reopening creates a new panel with `isDeriving=false`. The storage-work tracker prevents cleanup, not another derivation: it increments counters and does not reject an already-running scope. A second click therefore starts another derivation for the same project/repository/kind while the first remains outstanding.

A separate React/Jest reproduction confirmed two simultaneously unresolved calls to the derivation function after unmount/reopen/reclick. Storage/AI/table dependencies were mocked to isolate lifecycle behavior; this test does not quantify real duplicated heap use or demonstrate a native crash. The actual derivation path retains source/result state and requests until completion, so overlapping real runs can add work/memory pressure and race final publication/downstream invalidation.

Recommended fix: coordinate jobs outside tab component lifetime, with single-flight behavior by project/repository/artifact kind, shared progress and explicit cancellation. Keep tab navigation available and do not automatically cancel useful background work merely because a user changes tabs. Verify stale-source publication and downstream invalidation when different artifact stages overlap.

### 4. [P2] Downstream stages label local fallback rows as AI-generated and report success

References: `artifactAI.js:538`, `:1286`–`:1304`, `:1713`, `:2668`, `:2779`; `EngineeringArtifactPanel.js:547`–`:552`.

Category/generation/consolidation failures can substitute local rows, then normalization marks the results `source: "ai-generated"`. System, subsystem and design outputs do not carry the software stage's fallback/failure report. The panel only marks completion as failed when `derivationReport.fallbackRows` is set.

With every mocked provider request returning HTTP 400, all three downstream derivations still returned rows marked `ai-generated` with no `derivationReport` or `derivationFailures`. This is a confirmed reporting/provenance defect. It does **not** itself explain a native renderer-process termination; it makes AI failures harder to distinguish from successful derivation and risks misleading users about output provenance.

Recommended fix: propagate structured per-stage failure/fallback metadata and truthful row provenance through category, generation and consolidation passes. The UI should identify recoverable partial drafts and preserve prior committed results appropriately rather than report unqualified AI success.

## Request timing, storage and other observations

- Functional software requests have an explicit 120-second client deadline (`artifactAI.js:2384`). Generic downstream requests default to no renderer-side deadline (`artifactAI.js:89`, `:523`). The synthetic held-request check registered no client deadline timer during the first system-category request. **This is not proof of an indefinitely unbounded real provider request:** the current server applies a default 300-second request cancellation window (`server.js:44`, `:2305`), configurable with a minimum of 180 seconds. Per-batch retries and many sequential batches can still make a derivation long-running. No derivation cancellation signal is passed from the panel to these requests.
- Requirement checkpoints are present now; the older October review's “not checkpointed” observation is obsolete. Successful accepted responses are written before being reused, and checkpoint-storage errors propagate instead of silently becoming ordinary model fallback. Current checkpoint/archive regression coverage passed.
- The current source selection uses the processed Functional model when ready and supports already-projected rows. The old October observation about always using detailed rows is obsolete. Source selection/staleness regressions passed.
- The active panel also loads all four saved artifact collections for traceability (`EngineeringArtifactPanel.js:327`), so saved parent/downstream data contributes to whole-workspace memory beyond the isolated AI loop. This review did not measure its independent heap contribution.
- Existing valid stress evidence is in [the software Electron stress report](software-requirements-desktop-stress-2026-11-02.md). Its 75,000-row synthetic case completed at approximately 817 MiB sampled JS heap and 1.70 GiB peak native footprint. That isolated workload omitted real hazard history, customer row complexity, overlapping derivations and other retained workspace views. Passing it cannot establish the customer's maximum supported project size or rule out a data-dependent allocation failure.

## Checks performed and evidence

- **69 existing tests passed across eight suites** covering derivation, artifact schema/storage, the panel, software/hazard source selection and checkpoint/archive resume boundaries. Log: `/private/tmp/xhandle-derivation-review-tests.log`.
- **One additional isolated React lifecycle reproduction passed by confirming the duplicate-job defect**, not by verifying desired single-flight behavior. Fixture: `/private/tmp/xhandle-derivation-review-tests/lifecycle.test.jsx`; log: `/private/tmp/xhandle-derivation-lifecycle-repro.log`. Earlier temporary fixture setup failures were harness issues, not application crash reproductions.
- The actual derivation-module harness completed scaled runs for all four stages and confirmed fallback mislabeling, the renderer-side timing observation, and the hazard-reader call mode. Source: `/private/tmp/review-artifact-derivation.cjs`; results: `/private/tmp/xhandle-derivation-review-repros.log`. It transpiles existing modules for Node, replaces only the network/config dependency with deterministic local responses, and uses a mocked store for the resolver call-contract check. It is not an Electron/native-memory benchmark.
- No paid AI calls, user-data modification, full heap snapshots, new desktop build, production-code edit, commit or update publication occurred. The existing preview/profile and installed app were untouched. No additional large Electron stress run was warranted because the prior successful run already established that pure functional derivation can complete; the untested real hazard/context data is the more useful next target.

## What is needed to establish Offer's exact cause

Obtain his Desktop version and the actual termination reason/exit code plus native crash report, correlated with the last operation and workload counts. The screenshot alone cannot provide these. If a saved-run load is the last recorded operation, reproduce with a sanitized/exported representative project in a disposable profile while measuring heap/native peaks. If the reason is OOM, isolate hazard hydration, trace normalization and overlapping jobs first. If it is another native/GPU/OS termination, follow that evidence instead.

The waived general Chrome/Electron responsiveness gap remains separate from this derivation-crash diagnosis. The findings above are recommended implementation work; they are not fixes performed by this review and do not establish that Offer's crash is resolved.
