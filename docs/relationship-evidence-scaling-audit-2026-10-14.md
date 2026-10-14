# Large functional-model hazard pipeline audit

Prompt executed: `codex-prompts/relationship-evidence-scaling-audit.md`.
Production baseline: commit 929285c. No production code changed.

## Outcome

The appropriate fix is relationship-oriented screening with deterministic evidence
selection and reusable source facts, not a higher model context limit or more
recursive summarization. Existing seven-phrase grouping works, but the request
budget is still phrase-row based and evidence escalation still processes the full
payload. The previous fix prevented repeated unanswered decision requests; it did
not bound the total extraction cost of answering a question.

## Customer evidence

Pre-run CSV: 27,272,441 bytes; 6,384 rows; 76 columns; 912 trace IDs, each appearing
exactly seven times; one scenario/mode/conditions/assumptions combination. All
applicability and classification cells are blank. Source Symbols and Source Line
Ranges contain 11,241,293 characters combined. Scenario/mode/conditions/assumptions
contain 4,104,912 characters combined, repeating the same context. This is export
size, not proof of those fields being sent to the model.

Distinct relationship kinds: data 464, service 164, unknown 158, control 68,
feedback 58. Interface Type is Function Call for all 912, and Lifecycle Phase is
Needs Review for all 912. Labels alone cannot determine applicability. Structured
kind should inform the decision together with the modeled behavior and scenario.

The later terminal excerpt contains 66 completed extraction calls, 18 compaction
calls and one screening call. Nine responses hit their output limit (three
extraction, six compaction); no hazard-row-generation calls appear. The excerpt
starts and ends mid-work and cannot explain the customer's final stop. All shown
finished events have API status completed, which does not mean their output passed
application validation. Browser failure details are still required to diagnose
the stop itself.

## Findings, in priority order

### High: total evidence work is unbounded relative to a simple screening question

`fastHazardApplicability.js:18-23` restores full original source/context for evidence
mode. `hazardEvidenceChunking.js:121-123` digests that full payload; lines 94-100
partition all content into approximately 16KB groups. The focus changes the model's
instructions, not which evidence is sent. Files, source-reference arrays and broad
supporting context therefore can still incur extraction calls.

The 60KB decision-request cap improves admission, not end-to-end latency. When it
forces extraction, smaller requests can multiply into many more calls. Reduction
then runs sequentially in groups of four, with up to twelve levels and a separate
non-shrinking failure (`hazardEvidenceChunking.js:105-112`). These bounded safeguards
are not a practical per-relationship cost budget.

### High: functional evidence combines direct links and broad supporting code

`functionalModel.js:407-440` unions direct source indices with internal implementation
indices for both endpoint responsibilities. It builds sourceFunctions from endpoints
and nested evidence lists, without deduplicating that constructed array, then stores
it under both codeEvidence and sourceEvidence. The functional model retains
directSourceIndices separately, but `compactHazardSources` does not carry that
distinction into the prompt representation.

`codeArchitectureHazardUtils.js:592-636` passes those evidence objects through;
`fastHazardPipeline.js:14-27` forwards them. Lossless prompt interning removes exact
repetition inside one request, but does not distinguish directly relevant evidence
from shared supporting material and does not eliminate work across requests.

### High: cache identity prevents broad source-fact reuse

`hazardEvidenceChunking.js:50-52,90-92` keys summaries by evidence items AND focus;
digest keys also include target size and whole payload. Different questions or
interfaces can re-extract the same shared material. That is correct for narrowly
focused summaries, but no separate reusable source-fact layer exists. Simply removing
focus from the key would be unsafe: it could reuse a summary that omitted facts
needed by another question.

Deterministic reproduction with a shared checkpoint and identical ~147KB supporting
evidence: first relationship (seven phrases) made 11 extraction calls; a second
relationship with its own question made another 11. There were four applicability
decision calls total. This proves repeated preparation is possible; it is not a
measurement of the customer's exact hidden payload or live duration.

### High: phrase-row batching leaves substantial ordinary screening latency

`resultsFirstHazardPipeline.js:84` supplies maxBatchRows 48; the grouping code in
`fastHazardApplicability.js:116-128` keeps ordinary seven-phrase groups intact.
That generally fits six complete relationships (42 decisions), not 48 relationships.
At 912 relationships this is about 152 primary requests before retries/escalation,
subject to context/input size. At the previously observed 21.5 seconds per 42-row
request, three workers imply roughly 18 minutes for screening alone. This is an
illustrative extrapolation, not a forecast or benchmark.

### Medium: heavy groups block assessment progress and structured hints are lost

Evidence groups are processed sequentially (`fastHazardApplicability.js:142-146`),
though chunks within a group have up to three workers. Generation waits for the
screening call to return (`resultsFirstHazardPipeline.js:84-94`). Compact screening
priority is useful, but the entire evidence phase still precedes generation.

`compactHazardSources` passes interfaceType and lifecycle but not structured
functionalModel.kind or stable source trace identity. Kind is sometimes embedded
in controlDetails text. The CSV's universal Function Call/Needs Review fields are
not useful substitutes for the actual functional interaction category. No automatic
exclusion should be inferred from these labels alone.

## Recommended cohesive fix

1. **Build a relationship catalog before phrase expansion for model requests.**
   Keep every output row and stable row mapping, but request one compact record per
   relationship/context with seven independently identified phrase decisions. Batch
   by serialized input bytes and expected output, using e.g. 24–32 relationships as
   a tunable initial target rather than a promise. Preserve phrase-specific reasons,
   governed decisions, scenario distinctions and unique evidence identity.

2. **Use an explicit small screening contract.** Functions, action, direct interface
   description, structured interaction kind, current scenario, mode, conditions,
   assumptions and relevant enabled profile criteria. Shared context appears once.
   Filter placeholder lifecycle labels from decision evidence, retaining them in
   source records. Do not ask for a defect proof or a hazard causal chain at this stage.

3. **Keep navigation metadata and broad evidence local.** Source symbol lists,
   line-reference catalogs, repository fingerprints, allocations and supporting
   implementation indices belong in a local evidence registry, not in LLM extraction
   merely because they exist. Preserve every original for traceability/export.

4. **Select direct evidence deterministically first.** Retain direct-versus-supporting
   mappings when building functional relationships. Retrieve snapshot-bound source
   excerpts for direct calls and endpoint contracts, deduplicate by file/symbol/range
   and content digest, then expand only for a specific unresolved question. Do not
   use arbitrary first-N truncation or lexical matching alone where it drops negations,
   relevant branches, conditions, or contradicting evidence. Missing source text is
   unavailable evidence, not an invitation to summarize thousands of references.

5. **Separate reusable facts from scenario-specific decisions.** Cache neutral,
   cited source facts by repository snapshot/content/extraction-contract identity.
   Cache decisions using relationship/context/method/profile/phrase/contract identity.
   Focused extracts must additionally include question/scope identity. Prepare shared
   repository context once per snapshot and preserve profile criteria verbatim where
   feasible. Never reuse narrow extracts as complete neutral facts.

6. **Bound optional preparation work.** Introduce explicit extraction-call, byte and
   reduction-depth budgets per relationship and per run. No recursive catalog-wide
   compaction in routine applicability. Choose caps from representative measurements;
   track preparation separately from useful decisions. If the selected evidence cannot
   resolve a material question within budget, retain a specific pending-information
   state and continue independent work, never invent No or a safety rating.

7. **Release decided relationships to hazard generation as batches finish.** Use a
   shared provider scheduler across compact decisions, focused evidence and generation;
   keep compact work prioritized without starving other work. Do not restore a global
   wait for all unresolved relationships. Preserve monotonic progress, checkpoints,
   Stop, partial results and distinct pending-information versus provider-failure states.

8. **Apply the same evidence scope to generation.** The current generation prompt also
   accepts full source/context. Fixing only screening risks moving the same bottleneck
   into generation. Its evidence needs differ: retain relevant causal facts, assumptions
   and constraints, plus HARA/FHA-specific rating inputs and requirements traceability.

## Acceptance criteria

- A 912-relationship/6,384-row fixture preserves all seven output identities and the
  current input context/profile without 6,384 independent evidence preparations.
- Large shared reference catalogs produce no LLM extraction calls; deterministic
  source lookup stays local. Reused snapshot facts are extracted once, while differing
  contexts and questions cannot cross-contaminate decisions.
- Request/cost budgets tested with large reference arrays, broad shared code,
  non-shrinking summaries, truncation and multiple unresolved groups. No cascade
  exceeding configured limits, and independent rows continue through generation.
- Reviewed Yes/No, No gating, STPA rules, HARA S/E/C/ASIL and FHA severity/SCC/SWCI,
  CSV identity, requirements derivation, cancellation and checkpoint isolation pass.
- Instrument eligible relationships, decisions, escalation rate, retrieval bytes,
  extracted unique source bytes, cache hits, actual input/output tokens, queue time,
  wall-clock time, and reason for any pending row. Do not expose raw customer code.
- Live large-model smoke test validates both sampled decision quality and total
  runtime. The two-to-three-minute aspiration is not established by small mocked tests.

## Audit verification

Ran nine existing focused-recovery tests and one temporary cross-interface scaling
probe: 10 tests passed in two suites. Removed the temporary defect-characterization
probe after recording its result. No production changes, paid requests, customer
data edits, commits or pushes were performed. The exact reason for the reported
stop remains unverified because the terminal excerpt has no final application error.
