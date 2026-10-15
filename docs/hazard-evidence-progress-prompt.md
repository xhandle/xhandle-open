# Codex prompt: Overall oversized-evidence progress

Review the shared code-based architecture hazard evidence preparation path for STPA, HARA, and FHA. Implement progress that identifies both the current evidence item and its chunk progress, for example: "Preparing oversized evidence: item 6 of 20 identified so far · chunk 5 of 7".

Pre-register known oversized payloads before each preparation stage. Count unique evidence payloads, not guide-phrase rows or cached summary reuse. Register additional payloads discovered after provider input-limit errors. Label the total "identified so far" because later stages may discover additional work; the item index identifies the current payload and must not be represented as a completed-item count when work is concurrent.

Keep the shared UI/activity progress wiring, cancellation, evidence content, budgets, summary caching, applicability decisions, and generation behavior intact. Add regression coverage for planned totals, deduplication across guide phrases, cached reuse, and dynamically discovered oversized evidence. Run the hazard-analysis regression suites and report limitations honestly.
