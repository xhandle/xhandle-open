Implement reliable connectivity recovery for code-based architecture source decomposition and Functional-model AI processing.

Confirmed failures: HTTP 520 was not retryable; upstream DNS/socket failures became generic HTTP 500; a prolonged loss of connectivity exhausted short retries; failed browser fetches triggered semantic hierarchy splitting; persisted errors remained visible during new attempts; the dev launcher couples frontend/backend lifetimes without useful exit diagnostics.

Requirements:
- Classify upstream connectivity errors with safe machine-readable codes and distinguish them from auth/configuration, HTTP provider errors, content errors, and timeouts.
- Retry transient provider statuses including 520 with bounded backoff. Never retry permanent auth/configuration failures indefinitely.
- For identified connection failures, wait outside per-request deadlines and content retry budgets, periodically retry the original request, and resume automatically. Keep cancellation responsive and existing checkpointed work intact.
- Do not split responsibilities, consolidation or hierarchy batches in response to network errors.
- Keep current progress counts during connection recovery; show accurate waiting/recovered messages. Suppress the prior attempt's persisted error when retry starts without hiding a new failure.
- Log dev process startup, fatal error type/code, signals and exit code without logging credentials or request bodies. Preserve normal Node crash semantics and document the coupled launcher behavior; do not silently restart crashing processes.
- Cover prolonged outages, backend loss/recovery, HTTP 520, permanent errors, cancellation, checkpoint reuse and stale UI errors with deterministic tests. No paid provider calls or customer data changes.
- Do not claim the customer's backend exit cause has been proven or promise completion while services remain unavailable.
