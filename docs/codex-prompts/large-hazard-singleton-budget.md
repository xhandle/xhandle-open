# Fix large individual hazard-analysis inputs

Read the active code-based STPA/HARA/FHA screening and generation paths before editing. Reproduce the reported HA-120 rejection: 156,337 characters after lossless deduplication exceeded the fixed 120,000-character guard.

Separate normal batch scheduling from request admission. Keep normal batching/concurrency unchanged. Allow a large individual source or shared context through a conservative allowance for recognized configured Claude models. Reserve the actual requested output budget (including retry allowances) and wrapper overhead; account for UTF-8 size rather than assuming four characters per token. Do not claim application budgets are provider-advertised capacities. Unknown/custom models must not inherit a larger allowance.

Apply the same admission checks to applicability and generation for all three methods. Split multirow requests that exceed either scheduling or admission budgets. Preserve provider rejection handling, bounded retries, explicit Stop, governed applicability, checkpoint keys and completed results. Do not truncate evidence, invent exclusions, change rating logic, or increase normal batch sizes. Truly oversized individual requests must fail explicitly with recoverable partial work rather than repeatedly sending the same rejected payload.

Add regression coverage for the reported size through screening and generation in all three methods, large shared context, output reservation on retries, UTF-8 inputs, unknown models, unchanged normal splitting, and partial-result retention. Run the hazard-analysis regression suite. Report the exact scope and distinguish mocked transport tests from a live customer run.
