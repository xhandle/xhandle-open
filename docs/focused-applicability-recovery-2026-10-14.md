# Focused applicability recovery implementation

Implemented the prompt in `codex-prompts/focused-applicability-recovery.md` for
the shared code-based STPA/HARA/FHA screening path.

## Behavior

- Compact decisions are evaluated in bounded parallel batches before evidence
  follow-ups. Related phrases share one evidence decision, grouped by full original
  interface/evidence identity so different evidence cannot cross-contaminate.
- Follow-ups retain the model's specific missing-information questions. Oversized
  evidence is extracted with those questions as its focus, with source-reference
  coverage validated and original evidence unchanged. Focus participates in summary
  cache identity, so a targeted summary cannot replace a general hazard summary.
- All screening decisions, including singletons, obey a 60,000 UTF-8 byte limit.
  Extraction retains its existing bounded chunking and validated citation coverage.
  Extraction and applicability share a three-request ceiling in the active pipeline.
- A valid response requesting more information gets one focused evidence follow-up.
  If still unresolved, its question/reason is checkpointed as information-needed,
  separately from Yes/No. Unchanged recovery passes and Continue do not repeat it.
  Source, context, profile or method changes invalidate the key; explicit reviewed
  decisions take precedence. Persistence across reload requires working storage.
- Missing/duplicate IDs, invalid JSON, invalid values/rationales, and truncation
  receive specific structural feedback. Output allowance increases only for
  truncation. Provider failures retain the existing bounded recovery behavior.
- Diagnostics include reason codes, screening mode, request bytes and pre-dedup
  context/interface/question byte sizes. They do not dump full evidence payloads.

## Verification

382 tests passed across 39 suites (hazard feature and STPA request transport).
New regression tests cover all three methods, two decision calls instead of twelve
for persistently missing information, zero additional calls on unchanged Continue,
cache invalidation, reviewed No precedence, interface evidence isolation, question
propagation, compact priority, oversized evidence, duplicate-ID correction,
independent partial results, shared concurrency and cancellation during extraction.
`git diff --check` passed.

These are mocked-provider tests, not a live performance benchmark. Extraction of
large evidence can require additional calls beyond the two applicability decision
calls. A model can still identify genuinely missing information; that stays pending
with a specific reason rather than becoming an invented No or a completed assessment.
No customer analysis was started or stopped, and no changes were committed/pushed.
