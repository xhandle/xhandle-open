# Review Collaborator latency without sacrificing response quality

Review the current pending xHandle implementation in Chrome and Electron. The latest overview optimization is noticeably faster, but users still want faster answers. Identify remaining optimizations, not merely faster progress indicators.

Review only: do not change application code, publish, commit, restart the user's preview, change provider/model/effort, or send new project content to an external AI service. Preserve existing pending changes. Create an evidence-based report.

Trace typed/pasted requests through scope resolution, context routing, local index preparation, direct source reads, read planning, final prompt construction, transport, streaming display, completion, and thread persistence. Separate first visible answer, final completion, and local preparation time. Inspect metadata-only existing timing records where available. Use focused local tests and existing reproducible measurements; label mock-provider results and unmeasured estimates clearly.

Rank opportunities by impact, confidence, complexity and correctness risk. Look for avoidable serial AI calls, duplicate evidence/history, unnecessary index rebuilding, repeated database scans, cache invalidation gaps, provider queue/transport delays, hidden streaming, UI updates and background contention. Evaluate the current overview sample's limits rather than assuming a sample fully represents a large project.

Preserve factual grounding, citations, project/domain isolation, fresh edits/imports/deletions, exact count semantics, cancellation, bounded memory, technical depth and model independence. Do not recommend silent truncation, stale answer caching, skipping necessary evidence, lower reasoning effort or cheaper models as quality-neutral fixes.

Deliver concrete findings with source references, measured evidence versus hypotheses, an ordered implementation plan, acceptance tests/benchmarks, and limits of the review. Do not promise an unmeasured speedup or guarantee zero regressions.
