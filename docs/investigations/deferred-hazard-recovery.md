# Deferred hazard-analysis recovery

Recoverable failures previously escaped screening or stopped the shared generation
worker queue. An invalid extraction for one source could prevent unrelated rows
from being assessed.

The active code-based STPA/HARA/FHA pipeline now defers failed screening,
evidence extraction, transport, and structurally invalid assessments, completes
independent work, then makes two end-of-run recovery passes. Recovery processes
unfinished rows individually so a failing source cannot repeatedly block other
members of its original batch. Completed assessments and applicability decisions
are reused from memory/checkpoints; successful recovery removes stale findings.
Structural correction feedback is included in deferred generation requests.

Progress and diagnostics identify deferral and recovery. Persistently unresolved
rows are reported explicitly after the two recovery passes, with all successful
work retained. They are never fabricated, marked No, or reported as complete.
Explicit Stop, authentication/access/billing/model-not-found responses, and
programming errors remain fatal. This is bounded automatic recovery, not an
infinite paid retry loop or a guarantee against provider outages.

Changed: resultsFirstHazardPipeline.js, fastHazardApplicability.js, and the new
hazardDeferredFailures.js failure classifier. The standalone applicability API
retains its existing throw behavior unless a deferral callback is supplied.

Validation: 342 tests passed in 36 hazard-analysis suites. Added tests cover
all three methods, independent work finishing before recovery, extraction and
screening failures, isolated retry batches, persistent failures, invalid fields,
no repeat generation for successful rows, authentication failures, and Stop.
No live provider/customer run was performed.
