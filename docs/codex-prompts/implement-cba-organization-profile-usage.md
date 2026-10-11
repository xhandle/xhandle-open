# Implement consistent CBA organization-profile usage

Use docs/investigations/cba-organization-profile-usage-review.md as the audit baseline. Preserve existing work. Scope changes to enabled organization guidance and CBA workflow integration; preserve human applicability decisions, evidence grounding and method-specific risk semantics.

Resolve Settings project overrides against the active workspace. Pass the complete effective enabled profile to CBA hazard methods, preserve all authored sections under prompt budgets with explicit section allocations, and retain override precedence. Include governed profile guidance in STPA screening and its checkpoint identity. Record effective profile identity even when disabled; flag saved runs stale after policy changes and prevent stale policy from silently feeding requirements. Do not claim legacy paths are profile-aware: reject unsupported profile-enabled legacy dispatch before analysis rather than silently ignoring policy.

Add regression tests for enable/disable/override scope, long profiles, screening cache invalidation and reviewed decisions, persistence/freshness, and supported methods. Run focused tests and production build; report limitations and avoid live model calls or customer-data mutation. Do not commit or push.
