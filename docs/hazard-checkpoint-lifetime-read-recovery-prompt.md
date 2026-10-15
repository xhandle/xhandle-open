# Codex prompt: checkpoint ownership and read recovery

Review and fix the two reproduced defects without changing hazard reasoning or classifications:

1. Background checkpoint retries from a finished run survive its registry entry and can overwrite regenerated checkpoints for the same inputs. Retire storage work when its owning run finishes, including standalone runner callers and save-pending results. Cancel pending retries and abort active IndexedDB transactions. Do not cancel another scope or interrupt runs merely because users navigate. Preserve completed unsaved results for retry-save/export.
2. A rejected checkpoint read permanently disables further reads, even after writes recover. Permit bounded read probes after transient failures and after healthy writes. Avoid overlapping a timed-out read, handle late rejection/success, retain newest in-memory values, and do not repeatedly retry permanent errors.

Reproduce both defects in regression tests. Cover same-scope regeneration, late/in-flight writes, read cooldown/exhaustion, permanent read failure, cancellation, standalone completion, and final-save failure. Run the complete hazard-analysis, STPA transport, and downstream requirements tests. Report actual results and limitations. Do not commit or push.

Implementation: registry completion retires the old controller; the runner also owns a separate checkpoint controller and retires it on every exit. Active IndexedDB transactions listen for cancellation. Read retries use the existing finite 1/3/10-second retry schedule; a successful write allows an early transient read probe without resetting its attempt budget. Pending reads must settle before another probe. Permanent failures remain blocked.
