# Implement faster, resumable functional decomposition

Implement the findings in `docs/investigations/functional-decomposition-generation-performance-review.md` for the shared GitHub/local pipeline.

Reduce latency through bounded source concurrency, token/output-budget-aware packing of independent Functional callers, durable reuse of validated intermediate responses, and targeted recovery. Preserve the selected provider/model, every selected source and relationship, semantic instructions, evidence, boundary validation, deterministic assembly, explicit ownership, project isolation, atomic publication, and downstream hazard/requirements contracts. Never claim incomplete results are ready.

Coordinate rate limits and retries. Cancellation or fatal errors must stop new work and drain in-flight workers before returning. Serialize checkpoint writes, and keep memory bounded. Cache only validated responses with exact prompt, input revision, project/repository, schema, and model/settings identity; revalidate cached responses. Do not persist credentials. Unknown provider identity must disable durable reuse. Keep hierarchy catalog consistency; reuse explicit allocations only when valid, without treating heuristic groups as authoritative.

Add meaningful tests for bounded concurrency, deterministic output, cancellation, batching membership and partial failures, resume after later-stage failure, stale-input/settings/project isolation, and unchanged evidence/functional contracts. Run the relevant regression suites and a production build. Report measured request-count/latency improvements separately from projected live-provider gains and remaining limitations. Do not change hazard reasoning, applicability governance, or user data.
