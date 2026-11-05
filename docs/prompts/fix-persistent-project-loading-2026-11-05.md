# Implement persistent project-loading fixes

Use the evidence in `docs/investigations/persistent-project-loading-2026-11-05.md`.
Prevent repeated native backing-store initialization during navigation with one managed, idle connection (no retained transactions or row bodies). Release it for schema upgrades, deletion, shutdown and prolonged backgrounding. Never create a competing schema. Bound failures and retries.

Reuse bounded hazard layout metadata across mounts, keyed by project/run/generation/revision and query. Validate saved revision before reuse. Preserve continuous scrolling, filtering, imports and cancellation; never cache entire table bodies.

Keep navigation free of automatic Collaborator indexing. Preserve existing user data and pending changes. Review the independent projection-repair cost, but do not conflate it with navigation or introduce an unvalidated storage migration. Ensure preview restart waits for the previous process to exit rather than deleting locks.

Run focused lifecycle/invalidation/regression checks and measure the existing aged Electron profile, including first and repeated opens. Report measured improvements, remaining cold costs and validation limits. Do not commit, push or publish an update.
