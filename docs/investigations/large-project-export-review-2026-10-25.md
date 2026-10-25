# Review of large project export fix

Executed prompt: `docs/codex-prompts/review-large-project-export.md`.
Scope: uncommitted token codec and archive exporter/importer changes, their integration in App.js, and existing partial-analysis transfer tests. No production code changes, commit, push or release were made during this review.

## Finding

**P2 — Large streamed imports can appear stalled because progress callbacks are skipped during frame processing.** `projectArchive.js:254-258` consumes stream-data and continues without invoking the visitor that reports progress. Percentages are only emitted for semantic entries whose final physical count happens to be divisible by 32 (`projectArchive.js:294`). A 2,000,000-character partial hazard record produces more than 64 physical lines but reports only 99% during validation and 99% during import. Larger records can leave the UI unchanged for much longer. Report byte-based progress from the physical-line reader independently of semantic record delivery. The new review test explicitly captures this existing defect; change its expectation to require intermediate progress when fixing it.

## What is verified

- Whole-record JSON string creation has been removed for large exported entries and for destination conflict comparisons. The download handler uses the Blob through an object URL; it does not convert the archive back into a whole string.
- The fault-injected stringify-limit test reproduces the old operation's failure and passes a large partial hazard export/import through the new path.
- Existing continuation, conflict, isolation, rollback and compatibility tests pass.
- New adversarial tests reject missing start/end frames, extra end frames and illegal tokens even with a recomputed valid checksum, before project publication. Modified streamed text fails checksum verification.
- No additional data-loss or cross-project overwrite regression was detected in this review.

## Validation

Full Jest run: 2,475 passed, 8 failed, 2 skipped; 284 suites passed, one failed, one skipped. All 61 transfer tests passed, including six new review tests. The eight failures remain in hazardEvalRunner.test.js, with the same missing FD-1/FD-2 assessments. These were already reproduced on isolated unchanged HEAD during the implementation turn. No production code has changed since the successful production build with existing warnings; this review added only a prompt, a report and tests.

## Limits and release assessment

This is a fix for a specific string-allocation defect, not proof of bounded end-to-end memory or guaranteed success for arbitrarily large projects. `records()` still materializes a full IndexedDB record; the assembler retains a full decoded record and joins string fragments/allocates complete typed arrays. The final archive is retained as a Blob. Those are remaining capacity limits, not newly discovered evidence of data loss.

The exact failing user record and packaged Electron runtime have not been exercised. Validate the actual project in an updated packaged build: export, import into an isolated destination, compare saved partial hazards and checkpoints, and continue analysis. Do not delete or replace the source instance during that validation. Both exporter and destination must support v2 archives; v1 import compatibility remains tested.

Conclusion: the targeted serialization defect is addressed and automated transfer regressions pass, but the progress defect remains open and actual-project desktop capacity validation is still required. This review does not establish a regression-free application or authorize a release.
