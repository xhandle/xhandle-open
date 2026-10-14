# Fix evidence-extraction output exhaustion and summary rejection

Read the active hazard evidence chunker, results-first STPA/HARA/FHA callers,
and shared LLM transport. Reproduce the reported requests: 4,000-token output
allowance, repeated finishReason=length, and completed 7,082/7,686-character
summaries rejected by a 6,000-byte summary ceiling.

Separate summary validity from compactness. Accept and checkpoint complete
summaries with valid coverage/citations even above the preferred size. Use
existing hierarchical compaction when the combined evidence exceeds its prompt
budget, preserving original summaries and lineage. Never truncate summaries or
accept partial JSON just because it parses.

Start extraction/compaction with 8,000 output tokens. On explicit output
truncation, retry the same input once at 16,000 before splitting further. Keep
all retries bounded; child chunks inherit the larger allowance. Check the input
budget with the actual output reservation before every request. Preserve Stop,
deferral, checkpoint reuse, and existing normal-input behavior.

Give extraction and compaction distinct terminal workflow names. Ensure the
transport continues to propagate HTTP failures and truncation for those names.
Do not change analysis reasoning, classifications, applicability governance,
normal generation batch sizes, provider effort, or requirements wiring.

Test complete oversized summaries, invalid coverage/citations, output-budget
escalation, persistent truncation with splitting, checkpoint reuse, distinct
workflow labels, and transport error propagation. Run the hazard and transport
regression suites and report the limits of mocked validation.
