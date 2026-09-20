# Resolve classification policy-validation gaps with Vibe Review

Implement a first-class hazard-analysis Vibe Review target for rows whose `Classification Resolution Status` is `Policy Validation Gap` or `Human Disposition — Evidence Gap`.

- Parse the resolution-status column independently from `Safety Classification`.
- Show the exact validator findings for each row.
- Reconcile classification and supporting causal/evidence fields using only existing row evidence.
- Preserve governed applicability and safety-significance decisions.
- Recalculate the resolution status; never write it directly.
- Preserve review persistence, audit, sequencing, and downstream review behavior.
- Add focused tests and run them plus the production build.

Preserve unrelated working-tree changes.
