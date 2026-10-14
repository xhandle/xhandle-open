# Applicability screening and deferral audit

Scope: active code-based STPA/HARA/FHA pipeline, including the uncommitted compact
screening changes. Read-only production audit; no provider calls or customer data
changes. Prompt: `codex-prompts/audit-applicability-deferral-amplification.md`.

## Conclusion

Compact screening works, but full-evidence escalation and retry state undermine
its speed. Raising output limits or concurrency alone will not resolve this.
A typed screening state machine and stage-specific evidence selection are needed.

## Evidence and limits

The browser log shows batch 55 screening 42 rows with 37,947 characters in 21.538s.
Batches 48/52/53 each screen one row with 153,030 characters, collectively taking
24.035s, followed by HA-193 being deferred. All three responses finish with `stop`.
The provider reports 73,364 input tokens for those requests, considerably above
the terminal's four-characters-per-token estimate. These are provider-successful
responses, not demonstrated timeouts or output truncation.

Five explicit deferrals appear: HA-193, HA-197, HA-200, HA-201, HA-450. Their only
reason is generic validation failure. Neither log contains their actual answers;
it remains unproven whether they requested evidence, returned malformed JSON,
omitted IDs, or supplied invalid fields. Small output size does not prove which.

## Findings

1. **High: unresolved evidence is retried as malformed output.**
   `fastHazardApplicability.js:8,26,90-100`: the prompt explicitly permits
   `needsEvidence:true`, but the validator excludes that state. In evidence mode
   it falls into the same two retries as missing/invalid answers. Output allowance
   rises to 16K despite there being no truncation in the observed requests.
   `resultsFirstHazardPipeline.js:70-81` repeats unfinished screening in two more
   passes. A persistent evidence request can therefore produce 12 calls (three
   compact and nine evidence) for one row, without a network failure.

2. **High: the evidence question is discarded.**
   `fastHazardApplicability.js:90-94` keeps only the original source when escalating;
   the model's explanation of missing evidence is not passed forward. The next
   prompt cannot focus on the stated missing prerequisite. Structural retries
   similarly receive no validation feedback or prior answer.

3. **High: escalation restores all context, and singleton size targets do not apply.**
   `fastHazardApplicability.js:15-21` restores the full source and shared context.
   Lines 65-72 split over-target multirow batches, but singletons go to the chunker.
   `hazardEvidenceChunking.js:133-136` sends the original request if it fits the
   admission envelope. `fastHazardBudgets.js:4-8,38-43` distinguishes the scheduling
   target from the larger provider admission budget. Thus a 153K-character
   singleton can be admitted unchanged. This is not a broken hard-limit check;
   it is an inappropriate performance budget for applicability.

4. **High: unresolved work has no reusable screening state.**
   `fastHazardApplicability.js:37-46,82-87` checkpoints accepted decisions only.
   Missing-information questions, attempted evidence scopes, and failure reasons
   are not checkpointed. End-of-run recovery sets `maxBatchRows:1`, losing ordinary
   interface grouping for unresolved phrases. Chunk-summary caching cannot help
   full-evidence requests that fit admission and never enter extraction.

5. **Medium: diagnostics hide the rejection reason.**
   Parsing failures become an empty array (lines 74-80); missing IDs, duplicate IDs,
   invalid enums/rationale, and explicit evidence requests converge on the same
   generic error (line 98). The caller logs only that error message. Current logs
   cannot establish the exact cause of the customer's individual deferrals.

6. **Medium: screening escalation occupies the primary workers.**
   Each worker awaits all nested evidence and repair attempts before taking its
   next compact batch (lines 94,100,115-117). Three ambiguous batches can delay
   otherwise inexpensive screening. Downstream generation starts after the whole
   screening call returns (`resultsFirstHazardPipeline.js:80-90`).

7. **Test gap:** existing tests verify boundedness (four calls for one unresolved
   screen), payload exclusion, and governed values, but that bounded behavior
   itself permits expensive redundant calls. They do not establish live evidence
   escalation rate, correct real-model decisions, or a latency target.

## Recommended correction

Implement together, preserving reviewed decisions and downstream semantics:

1. Represent outcomes explicitly: decided, evidence-needed, structurally-invalid,
   transient-provider-failure. Keep question/reason, source IDs and evidence scope.
2. Screen the supplied functional relationship as modeled. Distinguish a meaningful
   deviation from proof that a defect currently exists. Preserve STPA command/control
   criteria and HARA/FHA functional-deviation criteria. Require evidence escalation
   for material ambiguity, not routine demand for a complete hazard proof.
3. Group unresolved phrases by interface AND original evidence identity, scenario,
   method, organization-profile version and screening-contract version. Resolve
   their explicit evidence questions together. Do not merge different source evidence
   merely because the display labels match.
4. Build a small cited applicability evidence record from relevant source/context.
   Retain full originals in storage. Include qualifications and contradictions;
   never silently truncate evidence or convert absence of information into No.
   Share the record across phrases and cache it using the full relevant identity.
5. Apply an applicability-specific budget to ALL requests including singletons.
   If a relevant record cannot fit, use bounded targeted extraction/chunking, rather
   than forwarding full repository/context payloads. Measure serialized field sizes
   to choose the cap; 153K requests should not be routine screening fallbacks.
6. On evidence-needed, permit one focused escalation. If the same missing information
   persists, preserve that pending state and its reason; do not submit unchanged
   requests during end passes or Continue. Retry when evidence/context changes or
   after a separately identified transient failure. Structural repair should include
   specific missing IDs/fields and validation reasons; raise output only on truncation.
7. Queue compact work separately from evidence work, with a shared bounded request
   budget and compact-work priority. Preserve accepted results and explicit Stop.
8. Log outcome codes, question, missing/duplicate IDs, mode, field byte sizes,
   request/evidence fingerprints and actual token usage. Avoid dumping raw code,
   secrets or full model responses into logs. Report pending information separately
   from transient failures and from No.

Do not weaken the applicability validator to accept arbitrary text, force No for
missing evidence, or treat pending rows as completed. No implementation can guarantee
a correct definitive answer when necessary inputs are absent. Such rows need a
visible, specific information request while independent work completes.

## Verification performed

Ran the existing nine compact-screen tests plus four temporary audit probes:
**13 tests passed, two suites.** Probes confirmed 12 calls (9 evidence) per persistently
unresolved row for each of STPA, HARA and FHA, with no downstream generation and
the missing-evidence explanation absent from every follow-up. A fourth probe
confirmed the singleton is forwarded beyond the scheduling target when its
admission path accepts it. Temporary probes were removed after the audit to avoid
enshrining the defect as expected regression behavior. No production code changed.

## Acceptance criteria for implementation

- All three methods: compact batch plus at most one focused evidence decision for
  persistent evidence uncertainty; unchanged end passes/Continue add zero requests
  for that same uncertainty. Changed inputs invalidate pending-state caches.
- Multi-phrase interfaces reuse one evidence preparation; distinct evidence/context
  cannot cross-contaminate. Ordinary batches remain grouped on recovery.
- Every rejection has a typed reason; malformed IDs/JSON trigger targeted correction,
  missing evidence does not trigger larger identical requests, transport failures
  retain bounded recovery, and Stop halts queued work.
- Per-stage budget enforced for singleton and multirow prompts; raw oversized source
  retained but not repeatedly transmitted. Reviewed Yes/No stay unchanged; No produces
  no UCA generation. HARA/FHA ratings and downstream requirement links remain intact.
- Live smoke test on a representative large functional model: record accepted rows,
  escalation rate, requests per interface, bytes/tokens, cache reuse, and wall-clock
  time. Inspect a sample of decisions against source/scenario. Mock tests do not
  establish a two-to-three-minute runtime or model-answer quality.
