# Live functional hazard-quality validation

This is an opt-in paid benchmark for the current code-based functional model and STPA pipeline. It complements the network-blocked synthetic harness. Synthetic tests cannot establish live model interpretation quality.

## Run and preview

```sh
npm run test:hazard:quality -- \
  --live \
  --campaign /private/tmp/xhandle-quality-campaign \
  --max-spend-usd 100 \
  --app-profile "$HOME/Library/Application Support/xHandle" \
  --electron /path/to/Electron \
  --organization-profile /path/to/approved-profile.md \
  --functional-view /path/to/exported-functional-view.csv \
  --preview --keep-preview \
  --playwright /path/to/node_modules/playwright-core
```

`--functional-view` accepts the exported CSV or a pasted Markdown table. Its interaction/node IDs, labels, descriptions, eligibility, endpoint allocations and supporting trace IDs are retained. Every supporting trace ID must resolve to the benchmark source fixture. The supplied snapshot is restored as a functional model, with full source evidence joined to it. Existing complete allocations are recognized without making hierarchy-generation calls.

The runner checks source and modeled-input snapshots before and after analysis and review. Improving prompts must not rename functions, change allocations/eligibility, edit code limits or add expected hazards to the source model. Exactly one explicit scenario/mode/conditions context is required and checked against every generated analysis input. The completed output retains that same context.

For small multi-file snapshots the production pipeline derives a separately cached behavior summary before screening/generation. Its facts must cite exact source excerpts; raw code takes precedence. This reading aid covers guards, retained state, reset, branch priorities and cancellation, and never rewrites the functional graph or source. It is not populated from the quality oracle.

Those snapshots also receive a source-conformance check before publication. Related-case context explicitly lists the peer fields supplied; omitted peer requirements/tests cannot prove those artifacts absent. Concrete contradictions remain blocking, while an already-qualified compatible hypothesis or a style preference alone is not a source-conformance defect. In the explicitly scoped source gate, a request for more test cycles/boundaries alone is a quality-coverage judgment when all stated outputs match source. The quality evaluator still grades that gap, with unchanged coverage and critical-error gates. The independent quality evaluator still reviews complete results under the fixed rubric. The pipeline corrects only failed generated assessments, preserves applicability/source inputs, and rechecks corrected content. Related failing cases stay together in correction batches; dependent siblings are rechecked when their generated case context changes. Three bounded correction rounds accommodate propagated findings, without accepting outstanding issues. Unavailable review or persistent contradictions leave an incomplete run with retained independent work. For small outputs, reviews also receive a complete bounded ledger of generated requirements to check conflicting shared-state contracts across batches. The ledger is output evidence, never source truth or expected hazards; no ledger is truncated to fit. Reviews are cached against the exact source, context, sibling contracts and assessment. Source names, decomposition and code are never changed by correction.

New software requirements, safety constraints and safety goals contain no metrics or numerical limits, including source-defined values. Reference exact existing source parameters or qualitative source predicates; never invent a target or parameter. Numerical source evidence and verification stimuli/results remain intact. Existing analyst-authored reviewed inputs are preserved and are not silently rewritten by this generation policy.

Without `--functional-view`, the runner uses the actual production abstraction and hierarchy prompts against the raw source fixture. In either mode, a ready functional model must exist before hazard analysis. The visible Electron project is checked for a rendered functional model with nodes before continuing. A supplied snapshot is not described as fresh AI abstraction.

`--preview` opens the real Electron shell in a disposable profile. The fixture's functional model is visible in the native architecture view. A live panel observes the actual diagnostic worker: stage, completed assessments, current accounted spend, quality score and findings. Provider calls run in the metered worker using production prompts and generation/persistence functions. The preview's own AI routes are blocked so clicking an unrelated app action cannot cause unmetered requests. This observer is not a claim that every generation button was exercised through the renderer; existing Electron suites cover those interactions.

`--keep-preview` leaves the observer open for inspection. Close its window or terminate the recorded `runner.pid` to stop it. The live profile and external projects are never used as the test workspace. Desktop settings are read from an ephemeral Local Storage copy; only selected model/effort/credential and organization profile are used. Credentials are never included in request artifacts or results. A private `--settings-file` is available for managed runners; do not place it in source control or an artifact directory.

For a local observer without credentials or provider calls:

```sh
node scripts/diagnostics/open-hazard-quality-preview.cjs \
  --playwright /path/to/node_modules/playwright-core
```

Sending source/architecture/profile material to a provider needs authorization for that payload and destination. A spending limit alone is not a substitute for that authorization.

## Quality gate

The versioned rubric is in `src/features/hazard-eval/functionalQualityScoring.js`. It scores grounding (20%), applicability (15%), causality (20%), requirements (20%), verification (20%) and failure-theme coverage (5%). The target is at least 9/10 overall, no scored dimension below 8/10, no critical contradiction, complete required coverage and a passing offline regression gate. Unknown/missing/duplicated results, unsupported judge citations and incomplete persistence fail; they never become passing averages.

The selected model receives a separate audit prompt and the complete unmodified fixture source corpus; generation never sees its scores. All exclusions are reviewed as well as applicable rows. A global coverage/consistency review checks incompatible rules across interfaces. The judge must cite actual source/fact text and verbatim offending assessment text. Code quotes remain case-sensitive; sentence capitalization in natural-language benchmark facts does not fabricate a different fact. A single unambiguous JSON object/array may be recovered from response framing without changing its content. Multiple answers or truncated structures fail. Truncated/malformed judge JSON retries once with a larger bounded output allowance; failure remains incomplete.

Invalid citations receive a bounded formatting repair. Only support quotes and offending-text/source quotes may change; scores, severities, reasons, fixes and finding membership remain immutable. Original responses and repair patches are preserved. A failed citation repair invalidates the evaluation rather than creating a passing score.

Before establishing a valid baseline, the evidence-audit protocol independently checks every first-pass judgment against the same source and unchanged rubric. It retains the original scores and findings, requires an explicit evidence-backed decision for every allegation, and records reasons for score changes in either direction. Every original critical finding remains blocking even when disputed. This is one bounded review, applied to every row; it does not select the better of repeated scores. The protocol and quotation validation code are included in the frozen evaluator fingerprint. Exact claim/evidence diagnostics prevent citation repairs from replacing already valid quotations.

Findings about contradictions between assessment fields may cite another field verbatim. Such a quote is internal-consistency evidence, not evidence of implementation behavior: grounding findings and each verdict's support still need external source/fact quotes. Self-citation cannot prove an issue. The evidence contract has separate versioning from the unchanged numerical rubric.

When a reviewer splits a verdict across duplicate IDs with identical scores, transport normalization unions every unique finding/support quote into that ID. Conflicting scores or unknown/missing IDs fail; no advantageous score is selected. Byte-identical repeated code is referenced through the supplied shared source corpus, with unmatched evidence retained intact. Excluded No rows score applicability only. Their original unused score metadata is preserved when an auditor returns null, without changing any scored value or finding. These are lossless transport operations, not rubric changes.

Before trusting the grader, calibration presents nominal helper/integrated reset tests and deliberately unsafe reset/arithmetic tests. It must reject the unsafe probes and avoid a critical finding on nominal guards. These probes are evaluator tests, not generated hazard results.

The fixture expectations are code-derived benchmark facts, not engineer-approved operational safety labels. A same-model, separate-prompt judge can miss correlated mistakes. Preserve the artifacts for independent engineering review and do not interpret the automated score as certification or proof of complete hazard coverage.

## Improvement campaign

Each invocation generates fresh hazard results. Every iteration saves source fingerprints, effective model/profile context, functional model, prompts/responses, usage, persisted run, calibration, row grading, global coverage, findings and regression evidence.

An evaluator-only failure after complete generation/persistence can use `--resume-evaluation /path/to/iteration` in the same campaign. Canonical functional rows, all analysis sources, context and architecture hash must match exactly. Valid judgments are reused; the report records the original generation revision. Evaluation resumption cannot count as fresh confirmation and does not erase charges from interrupted requests.

If the target fails:

1. Inspect `quality.json`, `diagnosis.json`, source evidence and the actual offending rows.
2. Diagnose the production fault or prompt failure; distinguish a harness defect from a generation defect.
3. Change production code/prompts and add a meaningful regression.
4. Rerun the same campaign with `--change-notes` describing the change and linked diagnosis.

The runner refuses an unchanged-source reroll after a scored failure. The fixture, rubric, grading prompt, provider/model/effort and organization context freeze once scoring begins. Setup corrections or a user-supplied functional snapshot can be recorded before the first score, without resetting prior spending. Changing the scoring rules to reach the target is not an improvement.

If every prior scored attempt has an evaluator hard failure, a documented `--repair-evaluator --change-notes 'Concrete evaluator bug and unchanged rubric'` can record a corrected evidence contract before any valid baseline exists. The provisional scores/history remain; the fixture/oracle, numerical scoring rubric and model/profile identity are hashed separately and stay fixed. This exception cannot revise a valid scored baseline.

One passing sample requires a second fresh generation on the same source revision and settings. Two consecutive qualifying runs establish `target-confirmed` for this benchmark. Source changes during a run invalidate that revision's result. Transient/incomplete runs remain distinct from scored failures; they cannot count as a quality pass.

The harness does not execute model-proposed code changes. A developer or coding agent inspects the diagnosis, implements fixes, runs regressions and invokes the next iteration. The same total campaign ledger remains in force throughout this loop.

## Spending and failure behavior

The campaign reserves conservative input and maximum output costs before each physical request, accounting for concurrent requests. Missing usage or interrupted requests retain their reservation as accounted spend. Unused reservation is released only when provider usage is available. Near the cap, admission waits for existing concurrent usage to settle before declaring a new request unaffordable. Resuming carries unresolved reservations forward; its cap cannot be silently increased. An explicit user-authorized increase uses `--increase-cap --max-spend-usd NEW_CAP --change-notes 'Authorization and reason'` and records old/new caps without resetting spending/history. Calibration, abstraction, screening, extraction, correction, generation and grading all share the cap.

The initial registered rate card is Claude Sonnet 5.5 at $2/million input and $10/million output tokens, verified November 22, 2026 against [Anthropic's pricing documentation](https://platform.claude.com/docs/en/about-claude/pricing). Reservations include cache-write and geography headroom. Other models require an explicitly reviewed pricing configuration; the runner never silently switches models. Accounted cost is conservative and may exceed invoiced cost after a failed request.

The isolated backend preserves the configured trusted CA bundle. TLS validation is never disabled. A provider/certificate/format/persistence failure produces an incomplete report, not a low or passing semantic score. No more requests are dispatched after the budget cap is reached.

## Offline validation

```sh
node --test scripts/diagnostics/hazard-quality/budget.test.cjs scripts/diagnostics/hazard-quality/quality-json.test.cjs scripts/diagnostics/hazard-quality/quality-audit-transport.test.cjs
npm run test:stpa:synthetic
```

The synthetic harness includes the rubric hard gates, evidence validation and functional-snapshot restoration tests. Live paid calls remain opt-in and separate from default full regression runs.
