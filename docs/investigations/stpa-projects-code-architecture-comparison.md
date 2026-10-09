# STPA comparison: Projects and Code-Based Architecture

Reviewed October 8, 2026, against the current working tree, including uncommitted fixes. Executed docs/codex-prompts/compare-stpa-projects-and-code-architecture.md. Application code and customer data were not modified by this review.

## Main conclusion

The UI's STPA option uses STPA-Textbook in both areas. Both reach runLiteAIAnalysis and the same generateStandardCodeHazardAnalysisSheets method=STPA implementation. Differences in input preparation, regeneration policy, persistence, and rendering are substantial. Code-Based Architecture is not using a separate, inherently more expensive STPA reasoning algorithm, but it can supply more rows/context, repeat more work, and do more expensive storage/rendering work.

## Comparison

| Concern | Projects | Code-Based Architecture |
|---|---|---|
| Input | responseRows filtered for required function/control-action inputs | Processed Functional rows when ready; detailed architecture fallback when absent; stale/incomplete Functional models blocked by runner |
| Eligibility | Required input-field gate | Explicit hazard eligibility; Include rows become candidates; excluded/review rows recorded separately |
| Expansion | Seven STPA guide phrases times selected operational contexts | Same seven-guide-phrase/context expansion |
| Existing assessments | Normal Run skips meaningfully completed rows; Regenerate explicitly redoes them | Preprocessing is preserved/reconciled, but selected candidates are supplied again; no comparable completed-row skip in runner |
| Human decisions | Reviewed applicability/significance/classification and user preprocessing reconciled against prior rows | User preprocessing constrained and reconciled with output; separate review integration; not identical orchestration |
| AI engine | Shared standard STPA engine | Same engine |
| AI payload | Functional descriptions, selected context, organization calibration | Those plus source traceability, source enrichment and analysis/context-source metadata |
| Batch/retry policy | Shared: up to eight rows/request, four for Claude, two concurrent generation requests; size budget can reduce batch size; two missing-row retry passes | Same; recent incomplete-response and request-body recovery fixes affect both |
| Post-generation stages | Language repair, safety audit, audit anomaly repair, canonicalization, final classification enforcement | Same |
| Consolidation | Omits consolidated requirement from initial config; then consolidates safety issues in Projects workflow after saving hazard rows | Does not pass omitConsolidatedRequirement, so shared default keeps that field; remediation is a separate workflow |
| Checkpoints | Recovery records contain stage data, source rows, contexts and preprocessing; final hazard data saved before safety-issue consolidation | In-memory sheet updates and partial-run callback; runner persists at final completion, no equivalent onStageComplete recovery hook |
| Persistence | Per-project artifact with write serialization, revision/conflict handling and five retained revisions | Run store currently reads all runs for lookups and rewrites all runs for a save |
| Failure handling | Recovery/write outcomes and revision guards in Projects orchestration | Additional final empty-output guard; current App restores prior run on failure/cancellation; no durable per-stage run checkpoint |
| Table rendering | Projects hazard rows use useDeferredTableRow to defer offscreen cell content | CBA table constructs all expanded group rows and visible cells |
| Downstream | Consolidated safety issues/risk register and review items | Hazard run plus source/architecture trace metadata consumed by remediation and assurance features |

## Prioritized findings

### P1: Code-Based Architecture storage scales with all saved runs, not the selected run

Evidence: src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore.js:65-126. readRuns uses getAll; getLatest filters after materialization; save reads all then writeRuns clears/repopulates the entire store. Projects uses project-keyed records, a per-project write queue and revision checks (src/features/project-hazard-analysis/projectHazardAnalysisStorage.js:13-89).

Trigger: large/multiple saved CBA hazard runs, switching projects, editing/saving a run. Impact: avoidable memory/serialization work; concurrent read-modify-write operations can lose another writer's data. This storage race was reproduced in the preceding hazard regression review, not rerun here. Recommendation: indexed single-run/project reads and transactional per-record writes; add latest-run metadata/index rather than retaining all payloads to find the newest. Preserve import/export and run identity contracts.

### P1: CBA expanded hazard tables lack Projects' offscreen cell deferral

Evidence: src/features/code-architecture-hazard-analysis/CodeArchitectureHazardSummaryTable.js:500-529 eagerly maps expanded groups to rows; App.js:22290 uses useDeferredTableRow in Projects. This is a structural code difference, not a measured customer benchmark. Projects deferral is not equivalent to database pagination and does not guarantee bounded total dataset memory.

Trigger: many expanded hazard rows across many columns. Impact: large DOM/render workload. Recommendation: reuse the proven row-deferral behavior as an interim change, then validate bounded row/column virtualization with editing, focus links, search, copy/export and variable-height rows.

### P2: CBA repeats completed assessment work while Projects can fill only missing rows

Evidence: App.js:12160-12255 skips completed candidates unless regenerating; codeArchitectureHazardRunner.js:41-57,126 supplies all prepared selected candidates. Prior-run preprocessing support does not implement an equivalent completed-row skip.

Trigger: rerunning an already partially/completely assessed CBA project. Impact: additional AI work and wait time, even though batching is shared. Recommendation: distinguish fill-missing from regenerate; reuse results only when source, scenario, method, organization-policy basis and human-review ownership remain valid. Never skip merely because a hazard cell is nonempty.

### P2: CBA has less durable recovery during generation

Evidence: App.js:12277-12313 writes Projects recovery records through stage callbacks. CBA runner:104-141 keeps currentGeneratedSheets in memory and does not pass onStageComplete; final persistence occurs at line 211.

Trigger: reload, crash or failure late in a CBA run. Impact: completed intermediate work is not durably checkpointed in the same way as Projects. Recommendation: persist stage/batch checkpoints with explicit incomplete status, separate from published hazard runs. Do not let draft checkpoints feed downstream analysis as completed results.

### P2: CBA hazard loading is triggered by full architecture state changes

Evidence: App.js:7885-7909 reloads hazard results on activeCodeArchitectureRepoMeta and cbaTableData dependency changes, and subscribes to unfiltered hazard-store change events. Combined with all-run reads, this amplifies avoidable work. Recommendation: stable project/repository identity dependencies and scoped change events, with cancellation/sequence guards retained.

## Shared mechanics and limits

- Shared entry: src/components/aiAnalysisLite.js:238-260; shared stages: aiAnalysisCodeHazardStandard.js:2595-2600,2626-2690; final generation:2710-2750.
- Projects expansion: App.js:432-489; source filtering:517; CBA selection/expansion: codeArchitectureHazardUtils.js:666-705; stale guard: codeArchitectureHazardRunner.js:38.
- UI label STPA is not the same as passing literal `STPA` into runLiteAIAnalysis. The function defaults to literal STPA, which reaches its legacy else branch at line 329; current UI paths use STPA-Textbook. Direct callers should preserve that distinction.
- Same prompt engine does not imply identical results: evidence, input counts, context and consolidation differ, and AI generation is not deterministic.
- Neither browser workflow becomes a backend job merely by storing records in IndexedDB. Changing databases without reducing loaded/rendered data would leave memory costs.
- The current 8/4 row caps and concurrency of two apply to both. A first run with identical candidate counts should not be assumed slower in CBA solely because it is CBA; actual payload size, provider time, repairs, storage and rendering need measurements.

## Validation

17 existing Jest suites passed, 170 tests. Command:

    CI=true npm test -- --watchAll=false --runInBand --testPathPattern='aiAnalysisSTPA|aiAnalysisCodeHazardStandard|code-architecture-hazard-analysis|projectHazardAnalysisStorage|hazardUserPreprocessing|hazardOperationalContext'

Log: /tmp/stpa-comparison-tests.log. Tests cover the shared generation/retry layer, hazard inputs/contexts/eligibility, CBA runner and table/panel behavior, Projects persistence and preprocessing. They do not establish live provider correctness, equal end-to-end behavior, a browser memory ceiling, or customer-scale responsiveness. No paid generation, customer data modification or production build was needed for this documentation-only review.

## Recommended order

1. Fix CBA per-record storage and avoid redundant reloads.
2. Bring CBA hazard rendering in line with Projects' deferral and verify large-table performance.
3. Add durable CBA checkpoints and safe fill-missing behavior.
4. Share orchestration contracts incrementally; retain CBA source traceability and Projects review/consolidation behavior.
5. Benchmark full architecture plus hazard workloads before and after, then migrate to backend storage/jobs with bounded loading if proceeding with the broader architecture change.
