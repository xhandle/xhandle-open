# Pre-release readiness — November 16, 2026

**Local fix verification: passed. Desktop publication remains pending.** The final source passes all 17 suites in the Electron regression gate, all four 31,500-row hazard-analysis cases, and all eight failure-recovery and cancel/reload/resume cases. Each large case completed, saved and reloaded every expected assessment without a renderer crash, input timeout or assumption fallback, and stayed below the existing two-second maximum renderer-gap limit.

The earlier Projects HARA out-of-memory failure is preserved and superseded by these final-source checks. See the [investigation](../investigations/large-hazard-analysis-memory-fix-2026-11-16.md) and [executed Codex prompt](../codex-prompts/fix-large-hazard-analysis-memory-and-responsiveness.md).

No commit, push, version change, desktop upstream-pin change or update publication was performed during this fix task. The results support reviewing and committing the pending changes; newly packaged installers still need verification.

## Final source gate

Shared source fingerprint: `440cbd8898f9e81a14a27fa9de58b7223bc32117b2a927c0383a42ba71b73204` (1,201 files), unchanged through the final gate and large acceptance runs. Native runtime source fingerprint: `4b17dc36c73bfa66496a479700659b19fb7a609fd68c29ca334bb9933cebb1e5` (50 files). Runtime: macOS arm64, Node 22.23.4, Electron 45.0.0.

| Check | Result |
| --- | --- |
| Frontend | 4,347 tests passed; four default opt-in tests skipped; 483 suites passed |
| Backend/parser/harness | 122 passed, zero failures or skips |
| Archive capacity | 13 passed, including the two capacity tests skipped by the ordinary frontend run |
| Native Node | 49 passed |
| Native Python release checks | 11 passed |
| Production build, fixtures and native smoke | Passed |
| Cross-area Electron UI, HARA, hazard/profile scope, platform profile context, Design, derivation, safety inheritance, Collaborator and worker responsiveness | All passed |
| Changed frontend lint | 194 files checked; zero errors, 76 warnings |
| Whitespace | `git diff --check` passed |
| Diagnostic process cleanup | Four focused Node tests passed, including cleanup when Electron is not a process-group leader |

Counts overlap and must not be summed as unique tests. Two paid live-model evaluations remain unexecuted. Controlled-provider tests exercise the real dispatchers and persistence, without certifying arbitrary model-output quality.

## Large hazard-analysis acceptance

Each case uses 1,500 interfaces, three operational contexts and seven guide phrases: **31,500 assessment rows**. Cases ran sequentially without overlapping performance workloads. The original two-second renderer-gap and five-second real-input timeout limits were retained.

| Area and method | Completion, save/reload | Elapsed | Max renderer gap | Max input probe | Renderer-reported peak JS heap |
| --- | --- | --- | --- | --- | --- |
| Projects STPA | Passed, 31,500 rows | 56.20 s | 1,773.5 ms | 934 ms | 1.80 GB |
| Projects HARA | Passed, 31,500 rows | 117.65 s | 1,766.6 ms | 922 ms | 1.40 GB |
| Code STPA | Passed, 31,500 rows | 195.12 s | 532.6 ms | 2,285 ms | 2.00 GB |
| Code HARA | Passed, 31,500 rows | 266.51 s | 1,001.2 ms | 659 ms | 2.73 GB |

All cases preserve exact source identities/counts; HARA checks include classification fields, deterministic ASIL and goal links. There were zero renderer errors, zero input timeouts and zero assumption-fallback rows. The Code cases include durable-save waits of approximately 112.56 and 168.92 seconds; readiness is based on committed reload, not the earlier results-ready progress message.

All eight 672-row recovery cases pass: mixed output-limit, malformed-result, missing-row and rate-limit injection for both methods in both areas, plus cancel/reload/resume for each combination. Resumed runs reuse committed assessments without repeating their identities. Projects HARA also passed the 672-row and 5,376-row sizes on the final source.

Memory figures are sampled renderer JS heap measurements, not total application memory or evidence of unlimited supported size. Large Code persistence remains slow while the GUI services input. These runs verify the reproduced workload on this Mac; Windows/Linux execution and signed installers remain separate checks.

## Publication sequence

1. Review, commit and push the tested shared changes. Update the private desktop repository to that committed upstream pin; include its two pending backend-staging changes and increment package and lockfile versions together.
2. Build and run packaged checks from the same committed source for macOS arm64, Windows x64 and Linux x64. Sign and notarize the macOS application and installer, then verify the installed copy and all platform receipts.
3. Validate the three-platform assets, checksums and update manifests in a draft release. Promote after verification, then check the anonymous public update feed.

Existing installers and earlier release receipts do not verify this pending source. Committing and pushing shared source alone does not make a desktop update available.

## Local evidence

- Aggregate acceptance: `/private/tmp/xhandle-hazard-final-verification-20261116.json`
- Complete final gate: `/private/tmp/xhandle-hazard-fix-final-regression-20261116/report.json` and `report.md`
- Final lint: `/private/tmp/xhandle-hazard-final-lint-20261116.json`
- Projects HARA size sweep: `/private/tmp/xhandle-hazard-graph-acceptance-20261116/report.json`
- Projects STPA/recovery: `/private/tmp/xhandle-hazard-final-projects-stpa-20261116/report.json`
- Code methods/recovery: `/private/tmp/xhandle-hazard-final-code-20261116/report.json`
- Projects HARA recovery: `/private/tmp/xhandle-hazard-final-projects-hara-recovery-20261116/report.json`
- Original crash: `/private/tmp/xhandle-precommit-large-hara-20261116/report.json` and its native flight/crash logs
