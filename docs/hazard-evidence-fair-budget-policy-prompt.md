# Codex prompt: fair evidence budgets for large analyses

Read the STPA/HARA/FHA evidence recovery path. Remove the run-wide 24-request and cumulative-time caps that let earlier relationships force later relationships into fallback. Keep bounded evidence recovery per relationship, including compaction, recursive splitting and retries. Different guide phrases and summary targets must not reset a relationship's allowance. Do not charge idle time or time waiting behind other relationships.

Reuse matching evidence preparations across guide phrases, including concurrent requests. Keep different source evidence, contexts, and focused applicability questions isolated: a summary for one question must not silently stand in for a different question. Preserve original evidence, citations, reviewed applicability, explicit No skipping, cancellation and existing fallback premises. Add diagnostics that distinguish relationship-budget exhaustion from global resource exhaustion.

Test more than 24 independent preparations, an exhausted relationship followed by a successful independent one, per-relationship retry bounds, guide-phrase reuse, concurrent preparation, focus/context isolation, idle time, and all three methods. Run the full hazard-analysis, STPA transport and downstream requirements suites. Do not commit or push.

# Policy implemented

- Removed run-wide evidence request and time caps.
- Retained 12 requests and 90 seconds of active evidence work per original relationship/context payload; recursive children, compaction, focus variants and smaller summary targets share the allowance. The existing runtime groups screening phrases by original relationship and splits generation to singleton rows before oversized preparation.
- Active time counts overlapping work for the same relationship once, excludes scheduler waiting and gaps between calls, and is checked before starting another request. In-flight requests retain existing transport deadlines.
- Matching preparations remain memoized across phrases. Question-specific summaries retain their focus-specific cache keys; different questions share the budget, not their selective evidence conclusions.
- Budget diagnostics report scope, request count, and active time. A difficult individual relationship can still exhaust its allowance and use the existing documented-premise fallback; it cannot exhaust other relationships' allowances.

This removes size-dependent starvation. It does not promise every oversized relationship will finish remote analysis or a fixed runtime for large projects. Total work can increase because later relationships now receive their own allowance.
