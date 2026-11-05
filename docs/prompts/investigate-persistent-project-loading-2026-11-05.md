# Investigate persistent project-loading delays

Investigate the minutes-long delays in the current Electron preview when opening Code-Based Architecture projects, saved hazard tables, and ordinary Projects. The previous removal of automatic Collaborator indexing did not resolve the user's observed delays.

Trace the actual running preview and existing profile before drawing conclusions from synthetic tests. Verify running versions, process/profile ownership, database availability and lock contention, memory/CPU, and the exact loading states shown in the screenshots. Compare relevant pending changes with the committed implementation. Distinguish measured causes from hypotheses and independent issues.

Preserve user data and credentials. Do not delete databases or lock files, run analyses, call external AI providers, or publish a release. Use bounded metadata-only diagnostics and local instrumentation. If a duplicate disposable preview holds the profile, establish ownership and inactivity before stopping that process. Recheck database access and actual project loading after resolving the conflict.

Deliver an evidence-backed report: root cause(s), triggering change or launch behavior, affected paths, measurements before/after where available, remaining uncertainties, and a concrete corrective recommendation. Do not claim the regression is resolved solely because unit tests pass.
