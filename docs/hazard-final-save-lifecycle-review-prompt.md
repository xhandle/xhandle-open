# Codex prompt: Review final-save lifecycle fixes

Read-only audit of pending final-save implementation. Verify per-revision success requires persistence, Stop preserves eventual storage notifications, scope isolation, deletion invalidation, observer callbacks, and retry ordering. Run existing regression suites plus targeted probes for uncovered orderings. Do not modify production code. Report verified remaining defects separately from limitations; do not equate a passing suite with proof of no regressions.
