# Improve Projects HARA decision quality

Update the Projects HARA workflow without rerunning a completed, compatible STPA foundation. Preserve source identities, generic core losses/hazards, user edits, durable checkpoints and unrelated work.

Implement these requirements:

1. Preserve emergency braking and necessary steering/stopping authority. A planned-stop position, mission phase, stale interface value or operator-command freshness gate must never prohibit an emergency response. Adapt unsafe inherited constraints in the derived HARA requirements while leaving the STPA source intact.
2. Base exposure on a separately identified normal operating situation and its frequency/duration. Never reduce exposure because a malfunction, communication loss or validation failure is rare. Preserve genuinely different sub-situations and use an explicit engineering assumption when needed.
3. Derive FTTI from the interval between fault and hazardous behavior. Keep freshness limits, diagnostic deadlines and reporting intervals as response allocations. Do not relabel a timeout as the hazard interval or invent measured evidence.
4. Produce concise item/vehicle-level safety goals. Keep schema checks, timestamps, network mechanisms and detailed interface behavior in linked functional requirements. Consolidate shared objectives across batch boundaries without combining different harm outcomes or targeting a fixed goal count. Keep event links and highest linked ASIL.
5. Preserve the practical-completion policy during display, recovery, editing and export. Completed drafts must not acquire blanket review/inconsistent-exposure labels merely because a view reconstructed a summary without metadata. Keep deterministic ASIL calculation and strict legacy diagnostics available.
6. Use a bounded correction opportunity for explicit reasoning errors, followed by a usable local completion. Do not add indefinite/per-row semantic retry loops, manufacture evidence, hide cancellation/account/storage errors, or overwrite completed user work merely by opening a view.

Validate with deliberately synthetic regression cases for dangerous braking gates, failure-based exposure, circular FTTI, cross-batch goal consolidation, preserved STPA reuse/checkpoints, and policy-consistent display/export. Run the relevant existing tests and a production build. Do not modify private exports, credentials or desktop release feeds.
