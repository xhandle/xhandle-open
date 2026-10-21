# Automatic assurance read recovery

The displayed 2,355 rows were available while at least one current/source/linked read had exhausted the bounded storage timeout budget. The generic notice did not identify which read failed; the screenshot alone cannot establish Safari's underlying cause.

Implemented view-owned read recovery for Software Requirements, System Requirements, Subsystem Requirements and Design:
- Retry transient timeouts, blocked upgrades and transient database state errors automatically with 2/4/8/16/30-second capped backoff.
- Keep available rows visible and show an automatic-recovery status rather than requiring a manual retry.
- Cancel recovery on unmount/project switch and superseded linked-data/event refreshes.
- Populate successful linked collections independently of slower collections.
- Preserve explicit failures for damaged data rather than treating corruption as empty or retrying it indefinitely.

No schema or generation changes. Browser storage that never becomes available cannot be guaranteed to return saved content.

Validation: 27 suites, 148 tests passed. Includes delayed automatic recovery, cancellation, corruption handling, retained cached results, existing project-switch/write-race/persistence tests, and table windowing tests.

Production build passed with warnings. git diff --check passed. Live Safari reproduction remains unverified.
