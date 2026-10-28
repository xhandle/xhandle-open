# Review workspace memory fixes

Review the pending workspace memory and Storage inventory changes against the reported large-project Desktop crashes, slow hazard restoration, and sleep/wake symptoms. Inspect actual callers and database ownership, not only unit mocks. Check automatic backup gating, overlapping operations, cancellation retirement, stale-result publication, data integrity, lazy hazard loading and diagram links, database upgrades, and cleanup behavior.

Run focused regression tests and isolated diagnostics using disposable data only. Add small reproductions for suspected regressions. Preserve all live projects, profiles and pending changes. Do not publish or install a release. Report confirmed defects with severity, source locations, reproduction evidence, and practical impact. Separate regressions from pre-existing architectural limits. State explicitly what remains unverified; passing tests cannot establish that every memory crash is resolved.
