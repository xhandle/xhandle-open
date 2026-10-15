# Codex prompt: Audit final-save recovery changes

Read-only review of pending final-save changes. Verify slow saves, retry limits, underlying errors, memory/reload protection, serialization, deletion, stop/navigation, and UI/registry synchronization. Look for regressions in callers assuming a resolved save is durable. Reproduce findings with temporary tests, run existing hazard/STPA/software-requirement regressions, then remove temporary tests. Do not modify application code. Report remaining defects with exact paths and distinguish browser observations from simulated tests.
