# Code-based STPA quality and rapid regression

Implemented the [Codex prompt](../codex-prompts/code-stpa-quality-and-rapid-harness.md) against the active results-first pipeline. Scope is code-based STPA; HARA remains available with its existing behavior. No commit, push or desktop publication was performed.

## Findings and changes

The active STPA path previously completed persistent malformed output, unavailable evidence, and some provider account/rate-limit failures by generating local assumption-based bounding scenarios. Those templates could assign an unestablished protective role and fatal consequence, and the run could then be marked complete. STPA now preserves accepted work and returns an incomplete, resumable attempt when rows remain unfinished. Independent successful rows are checkpointed; a replacement preserves the prior completed run. Failed/incomplete results cannot supply downstream published software requirements. Existing bounded automatic recovery and targeted correction remain active.

Generated and resumed STPA rows use the same local artifact checks: required fields and action identity, distinct loss/hazard/UCA/scenario artifacts, binding controller/system constraints, actionable verification, and citation integrity when source-supported causation is declared. Old local fallback checkpoints are rejected. This changes neither the HARA/FHA contract nor their checkpoints; valid accepted STPA work can still be reused. The pipeline version stays unchanged because the acceptance checks run when reading cached rows.

STPA generation now requests direct, concrete scenario statements without confidence or review-status labels. It explicitly includes feedback/process-model errors and control-path/actuator mechanisms, keeps controller constraints distinct from software requirements, and asks for a verification stimulus and observable expected behavior. These instructions are shared with the detailed generation path. No independent model-review stage or additional per-row model call was added.

The STPA table defaults to 11 columns:

1. Operational Context
2. Guide Phrase
3. Guide Phrase Applicable
4. Unsafe Control Action
5. Loss
6. Hazard
7. Causal Scenario
8. Safety Constraint
9. Software Safety Requirement
10. Verification
11. Safety Classification

Controller/action/target identity remains in the interface group heading and is available as optional table columns. The column picker excludes confidence/review fields, internal processing fields, redundant assessment declarations, and fields belonging to other methodologies. Empty unused optional columns are removed from locally available sheets; populated custom user columns remain available. Paged datasets keep a stable column set across windows rather than inferring whole-column emptiness from one window. New sheets include the already-computed combined Operational Context in their headers. Local legacy sheets derive it without mutating saved data; paged legacy sheets keep their separate scenario/mode/conditions fields.

Underlying traceability, original column indices, user edits, full CSV data and evidence metadata remain intact. This is presentation cleanup, not destructive schema migration. The STPA review-badge column is disabled independently of the platform presentation flag. No scrolling algorithm was changed.

## Rapid harness

Run `npm run test:stpa:synthetic -- --out /private/tmp/a-new-stpa-run` or select `--only stpa` in the existing Electron regression runner. The standalone command requires shared dependencies and Node; it does not require Electron, Playwright, a build, provider credentials or external services.

The harness runs the production screening, generation, checkpoint acceptance and sheet builder against deterministic synthetic provider responses, plus runner/storage/CSV/requirement and table component tests. Fixtures cover braking, train doors, reactor heating and landing gear across omission, unsafe provision, timing and duration categories. It checks exclusions, invalid artifacts and citations, wrong actions, targeted correction, malformed output, provider rejection, cancellation, preservation of independent results, retry/resume, 320-row throughput and causal trace links. HARA/FHA compatibility tests remain included. A preloaded guard blocks HTTP, HTTPS, socket, TLS and fetch access; a blocked attempt fails the harness even if application recovery catches its exception.

The final integrated `stpa` selection passed **175 tests across 11 suites in 18.5 seconds**, with no skipped tests, no live calls and a stable source fingerprint. The controlled 320-row generation-plus-cache-resume check took **124 ms** during that run. These timings measure the local synthetic path, not live model latency. A final fixture review separated unsafe-provision consequences from omission consequences and included a mission-only batch-loss case.

Evidence: `/private/tmp/xhandle-stpa-integrated-reviewed/report.json` and its `stpa-synthetic/result.json`, `jest-results.json`, and `tests.log`. The report explicitly labels the Electron gate as a partial selection: this is not a claim that all native GUI categories ran.

The initial broader hazard run identified older tests that explicitly expected STPA fallback completion. Those expectations were updated to assert incomplete recovery and preservation of prior/successful results. HARA/FHA fallback tests remain.

Final broader checks:

- Full frontend: **4,608 passed, zero failed, four existing skips**, 503 passing suites, 272.6 seconds. Evidence: `/private/tmp/xhandle-stpa-frontend-final.json` and `.log`. The four skips remain the two paid-model evaluations and two opt-in capacity checks.
- Production renderer build passed, output `/private/tmp/xhandle-stpa-production-final`; log `/private/tmp/xhandle-stpa-production-final.log`. Existing ESLint and chunk-cycle warnings remain.
- Focused ESLint completed with zero errors; two existing hook/loop warnings in the table and pipeline remain. Evidence: `/private/tmp/xhandle-stpa-eslint-final.log`.
- `git diff --check` passed. Manual guard probes confirmed fetch and HTTPS attempts throw before network access.

## Method and evaluation scope

The [MIT STPA Handbook](https://www.mit.stamp-institute.com/get_file.php?name=STPA_handbook.pdf) provides the methodological reference for loss, hazard, control structure, unsafe control action and causal scenarios. Local validation and deterministic provider fixtures test implementation behavior and regression handling. They do not independently evaluate a live model's interpretation of every source path or establish exhaustive coverage of an external system. Existing paid live-model evaluations remain opt-in. No private-data was used.

## Independent second pass

Reviewed the active screening/generation/acceptance path, checkpoint lifetime, sheet publication, imported context assignment and compact-table copy. Added failing regression cases before fixing these issues:

- **Retry could remain stuck indefinitely.** A cached `information-needed` decision was treated as permanent when the user retried with the same inputs. STPA Retry now makes one focused evidence request for that pending decision, retaining the previous question. Accepted rows are reused; persistently unresolved evidence does not trigger an unbounded loop. Cancellation during that request cannot accept its late response. HARA/FHA screening behavior is unchanged.
- **Incomplete runs could release storage before accepted checkpoints finished writing.** The STPA failure path now gives queued writes the same bounded flush opportunity as completion, before the runner disposes its checkpoint connection. A delayed-storage test demonstrates the previously missing accepted checkpoint. Existing cancellation and unavailable-storage bounds remain.
- **Copied compact findings lost their controller/action/target.** Those values live in the group heading rather than default data columns. Local clipboard and paged-copy operations now include the original identity columns without changing visible columns or source indices.
- **Imported context edits left the displayed combined context stale.** Context assignment now recomputes an existing combined column. Repairing only a stale label does not change the recorded basis of user decisions or create a spurious context conflict. Legacy schemas are preserved.
- **Valid technical wording was rejected.** For example, “Unknown obstacle position…” and “Pending brake commands…” describe system conditions rather than unfinished assessments. Status detection now distinguishes those phrases from a bare status or status-prefixed placeholder. Verification accepts observation/confirmation and related test activities, in addition to the existing test verbs.
- **Compact acceptance skipped supplied execution/operator premises.** STPA now checks optional concurrency and interactive-operator declarations when present, including checkpoint reuse and merged publication. It rejects unsupported concurrency citations and operator assumptions that conflict with unattended context. These metadata remain optional. A follow-up end-to-end publication test caught and fixed the empty-cell representation of omitted optional fields.

The new cases exercise failures independently of the fixture's happy-path expected output: persisted pending decisions, delayed writes, cancellation, unsupported source premises, legitimate prose, stale labels and clipboard identity. Final publication is covered with a compact response that omits the extra metadata entirely. These tests are part of the rapid harness, not a separate manual checklist.

Final integrated rapid check: **195 passed across 13 suites in 22.4 seconds**, zero failures/skips, external network blocked, no provider calls. The 320-row controlled generation/cache-resume check took 154 ms. Evidence: `/private/tmp/xhandle-stpa-second-pass-final/report.json` and `stpa-synthetic/result.json`, `jest-results.json`, `tests.log`. Both renderer and desktop source-change checks were false; renderer source fingerprint `484f54e62ec5929bb6b89ea1fa9c4ad1bd5b6eab18347c81162a37510eb94b1c`.

Focused ESLint: zero errors and two pre-existing warnings (`filterState` hook dependencies and the pipeline's loop callback), recorded in `/private/tmp/xhandle-stpa-second-pass-eslint.log`.

Production renderer build passed at `/private/tmp/xhandle-stpa-second-pass-production` with the existing ESLint/chunk-cycle warnings; log `/private/tmp/xhandle-stpa-second-pass-production.log`. An initial ad hoc frontend run used Jest's 5-second test timeout concurrently with the production build. Paged-review and append-integration tests timed out (the append timeout also left its test storage lock occupied), so that run was interrupted rather than accepted as verification. The final full-frontend run uses the comprehensive harness's normal 30-second timeout after the build has finished.

Final full frontend: **4,623 passed, zero failed, four existing opt-in skips**, 504 passing suites out of 506, in 218.8 seconds. Both previously timed-out suites passed. Evidence: `/private/tmp/xhandle-stpa-second-pass-frontend-final/report.json`, `frontend-results.json` and `frontend.log`. The final full frontend and rapid STPA runs used the same source fingerprint; neither reported source changes. These selected Electron-harness categories cover frontend/pipeline behavior; native GUI categories and live model quality were not rerun for this second pass. `git diff --check` passed.

No live-model evaluation credentials were configured (`XHANDLE_EVAL_API_KEY` absent). Existing opt-in live evaluation uses the older standard-generation path, so it was not used to claim coverage of the active compact pipeline. This second pass made no private-data requests, commits, pushes or release changes.
