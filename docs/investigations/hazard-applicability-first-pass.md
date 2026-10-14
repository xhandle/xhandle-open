# Applicability-first code architecture hazard analysis

Implemented the prompt in `docs/codex-prompts/hazard-applicability-first-pass.md`.

Previously, the compact pipeline determined unresolved applicability while producing detailed hazard assessments. AI exclusions also incurred narrative-review work. The new active STPA/HARA/FHA path screens unresolved action/context/guide-phrase pairs first, in batches of at most 48 decision records, bounded by prompt size. The enabled organization profile accompanies screening. Human-governed Yes/No decisions bypass screening. STPA uses command/control applicability; HARA and FHA retain meaningful functional-deviation applicability.

Only Yes proceeds to detailed generation and independent narrative review. Screened applicability is read-only there, and its rationale is retained. No creates an excluded row locally. Function, action, target, context, phrase, decision and applicability rationale remain visible; downstream assessment cells are Not applicable. The internal Safety Significant flag remains No for compatibility with requirements generation. Imported prior downstream findings cannot refill an excluded row during final merge.

Screen decisions are checkpointed separately by method, complete source and shared context within the existing project/repository/provider checkpoint scope. Continue reuses saved decisions and approved assessments. Regenerate retains existing checkpoint-reset behavior. Failed or truncated screening is never treated as No: missing/invalid rows get bounded targeted retries, and failures retain completed work for recovery. New transport workflow `hazard-applicability-screen` propagates provider errors and explicit output truncation.

Changed production code: `fastHazardApplicability.js`, `fastHazardPipeline.js`, `fastHazardSchema.js`, `fastHazardRunner.js`, and compact-workflow handling in `aiAnalysisSTPA.js`. Existing downstream-focused tests isolate the new prepass; dedicated integration tests exercise the real prepass and runner dispatch across all three methods.

Validation: 355 tests passed across 33 suites, including all three methods, mixed decisions, all-No skipping, 147 decisions in four mocked screen requests, governed decisions, read-only Yes, scoped resume, bounded truncation recovery, partial failure recovery, table fields, software requirements compatibility, and workflow transport propagation. This is not a live-model performance benchmark; elapsed-time savings depend on exclusions and provider latency.

Production build passed with existing warnings. `git diff --check` passed. No live provider requests were made.
