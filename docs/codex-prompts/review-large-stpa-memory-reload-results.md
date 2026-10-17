# Large STPA memory/reload review

## Findings

1. **High: checkpoint cache retains unbounded serialized evidence/context.** The active results-first pipeline builds assessment checkpoint bases from `{pipeline,method,context,source}` (`resultsFirstHazardPipeline.js:69`). Applicability uses another full-source basis (`fastHazardApplicability.js:41`). Source includes details, evidence, allocation and operational context (`fastHazardPipeline.js:14`). The resilient adapter uses `JSON.stringify(basis)` as its Map key (`resilientHazardCheckpoint.js:13`) and keeps every value/key after successful persistence; only dirty entries are removed. Evidence shared between objects becomes repeated text in these keys, potentially twice per row across screening and assessment. This is a confirmed scaling defect and a credible contributor to Safari memory pressure, not proof of the exact allocation that triggered this incident.

   A bounded synthetic experiment executed the actual adapter with an instrumented Map, a successful mock backend, 1,000 rows, two checkpoint stages and 10,000 evidence characters per row. After flush: zero dirty entries, but 2,000 retained cache entries and 20,226,780 retained key characters. Customer evidence sizes were not measured. The durable backend additionally serializes and UTF-8 encodes each basis for SHA-256 (`codeHazardGenerationCheckpoint.js:22`), creating transient allocations; batching does not bound the adapter's retained key map.

2. **High: abrupt reload recovery does not discover an in-progress run from row checkpoints.** The runner writes a full run after generation or in its caught-error recovery path (`fastHazardRunner.js:169-191`). It does not persist an initial in-progress run manifest in this path. A browser termination bypasses that recovery catch. Startup reads the latest saved run (`App.js:8014`) and the in-memory registry, which cannot survive reload. The panel selects Run versus Continue from `latestRun` and displays the draft message when that record is absent (`CodeArchitectureHazardPanel.js:293,429`). This explains the observed UI even if row checkpoints were successfully persisted. Matching checkpoints can be reused by a subsequent non-regenerate run; the screenshot alone cannot establish how many survived.

3. **Additional peak-memory risk: final assembly materializes several full result representations.** The runner builds sheets, reconciles/validates them, retains the architecture snapshot and builds narrative-review inputs (`fastHazardRunner.js:140-157`). This increases peak memory beyond the retained generation state. There is no evidence that this incident reached final assembly, so it is a risk rather than an established incident trigger.

## Recommendations

- Replace full serialized Map keys with compact stable identities/digests; share evidence and context fingerprints. Bound clean-cache retention while preserving unsaved entries and write ordering. Avoid repeatedly serializing identical evidence for every phrase.
- Persist a lightweight in-progress run manifest and checkpoint counts, and discover interrupted work on startup. Offer explicit resume with matching-input verification; do not equate missing finalized run records with missing checkpoints.
- Profile generation and final assembly at 26,278 rows, track peak heap and retained objects, and reduce simultaneous full-table copies. Keep rendering windowed.
- Add large-run memory and abrupt-termination/reload recovery coverage. A durable worker/job architecture would be needed for execution to survive tab termination itself; a web worker alone does not survive page reload.

## Validation and limits

39 tests passed across resilientHazardCheckpoint, codeHazardGenerationCheckpoint, checkpointRunLifetime and useHazardRowWindow. These tests establish existing behavioral coverage, not a memory ceiling or end-to-end Safari recovery. No production code changed, no provider calls made, no customer storage inspected or cleared. Existing uncommitted changes were preserved. The browser banner confirms a memory-driven reload; exact heap attribution requires profiling. The draft row count does not establish completed assessment coverage or permanent data loss.
