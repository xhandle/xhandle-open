# Hazard completion-policy review

Read-first review completed; production implementation awaits selection of the
fallback contract described in `codex-prompts/hazard-run-completion-policy.md`.

Confirmed paths:

- `resultsFirstHazardPipeline.js`: three bounded passes complete independent work;
  unresolved evidence is checkpointed separately and excluded from unchanged
  recovery attempts. Any remaining failures then throw HAZARD_DEFERRED_REMAINING.
- `fastHazardRunner.js`: the error path builds and saves an incomplete attempt,
  preserves a prior complete run, publishes partial results, then rethrows. The
  successful path already retains in-memory results if final saving fails.
- `fastHazardSchema.js`: explicit assumptions are already part of the common
  assessment contract. Hypothesis is a recognized causal basis. Structural
  validation still protects identities, governed values, classifications and
  valid rating inputs. It does not establish substantive correctness.

The latest supplied failure demonstrates the completion-policy problem: 134
accepted assessments survive, but 13 unresolved applicability rows cause the run
to be reported as failed. It does not establish a provider outage or lost results.

A nonblocking completion outcome is technically achievable for recoverable row
failures. Guaranteed correct final safety conclusions without supporting information
are not. Nor can client-side code guarantee execution after browser termination.
The outstanding design choice is whether missing assessments should be constructed
under visible premises in existing fields or remain explicit unavailable records.
No production code, tests, saved customer data, commits or pushes changed in this
review.

## Implementation after approval

The user approved explicit premises in Assumptions and Assessment Basis. The
normal results-first pipeline now completes exhausted recoverable row failures
with local conditional bounding assessments. It retains screened/reviewed Yes/No,
successful rows, source IDs and checkpoints. Provider account errors use local
completion without futile repeated requests. Stop, programming errors and
contradictory governed values remain errors.

The local fallback supplies method fields and software-allocated requirements;
HARA ASIL and FHA SWCI continue through the existing deterministic calculations.
Unreviewed ratings use conservative bounding premises, not evidence-derived
estimates. Human rating overrides retain their corresponding premise. No source
citations, concurrent execution or operator interaction are invented.

Assessment Basis is retained in Summary and reconstructed assessment metadata.
Integration tests cover saved/reloaded results, CSV round trips and requirements
derivation for all three methods. Checkpoint failure leaves exportable memory
results with accurate unsaved status. No new demo mode or mandatory narrative
review loop was added.

The change does not guarantee progress after browser/process termination or
remove provider latency during bounded attempts. Existing stored failures can be
continued; accepted matching checkpoint rows remain reusable.
