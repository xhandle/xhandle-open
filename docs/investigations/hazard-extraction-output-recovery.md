# Evidence extraction output recovery

The provided terminal excerpt contained nine completed evidence requests with a
4,000-token output allowance; six reported finishReason=length. The old chunker
split input immediately on output truncation without increasing output headroom.
It also treated a complete summary above 6,000 UTF-8 bytes as invalid, causing
regeneration instead of using the existing compaction stage. These are separate
output-handling problems from oversized input admission.

Changes:
- Start extraction and compaction at 8,000 output tokens. On truncation retry the
  same prompt once at 16,000 before splitting. Child chunks inherit the enlarged
  budget. Check input admission against the actual reserved output each time.
- Validate reference coverage and citations independently of summary size.
  Complete lengthy summaries are checkpointed and reused. The existing bounded
  hierarchical reduction compacts combined summaries only when they exceed the
  target. Reduction instructions now explicitly request a smaller result.
- Use hazard-evidence-extraction and hazard-evidence-compaction workflow names.
  Both names retain strict transport error/truncation propagation.

No changes to provider effort, classifications, applicability governance, normal
hazard generation batches, or downstream software requirements were made. No
checkpoint version change is needed: previously valid summaries remain valid.

Validation: 364 tests passed across 37 hazard and transport suites. Added coverage
includes 7,082/7,686-character valid summaries and checkpoint reuse, compaction
with lineage, same-input output-budget escalation, splitting after persistent
truncation, and transport behavior for both new workflow labels. Existing tests
continue to enforce missing-reference rejection, cancellation, deferral, and
normal-input behavior. No live customer/provider rerun was performed.
