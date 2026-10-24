# Concurrent hazard failure priority fix

Implemented the prompt in `docs/codex-prompts/fix-hazard-parallel-error-priority.md`.

The review reproduction showed an exhausted preparation budget winning a race against a missing previously prepared evidence checkpoint. That allowed the pipeline to treat unavailable saved evidence as an assumption-completion condition.

Evidence preparation, applicability screening, and hazard generation now use the same stable error selection: cancellation, required-evidence storage failure, other non-deferrable failures, then deferrable failures. Equal priorities retain the first error. Selection retains the original object and cause and does not mutate frozen errors or DOMExceptions. Evidence preparation also checks cancellation after concurrent workers settle. Request budgets and validation are unchanged.

Regression coverage exercises the real chunker with a partially completed preparation and missing checkpoint in both arrival orders, plus cancellation; concurrent provider/storage failures in both screening and generation; and identity, cause, and equal-priority selection. Missing required evidence interrupts the run instead of publishing assumption-based replacements.

Validation: 71 hazard suites, 631 tests passed. Focused regression run: 3 suites, 18 tests passed. `git diff --check` passed. Production build passed with warnings (including lint, outdated Browserslist data, and bundle size).

This fixes the reviewed error-priority defect, not the original native renderer crash. All-source/result residency and renderer-owned job execution remain architecture limitations. No long-running customer workload or combined packaged Desktop build was tested in this turn. No release was published, and the running app and personal workspace data were not modified.
