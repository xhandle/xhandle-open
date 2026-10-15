# Navigation lifecycle and shrinking-row fix

Implemented the prompt in hazard-navigation-lifecycle-fix-prompt.md.

## Root causes and changes
- Initial navigation was marked handled when merely scheduled. StrictMode cleanup discarded the pending request, while replayed setup suppressed rescheduling. The summary table now tracks pending versus completed requests, clears canceled setup, ignores obsolete callbacks, and acknowledges successful positioning exactly once.
- A deep relative scroll offset could exceed a resized row's height and unmount the anchor before measurement. The row window now bounds the provisional position to keep the row mounted, retains the intended offset until a current measurement is available, and then reconciles the stored offset to the measured height.

## Regression coverage
Promoted the review reproductions into hazardNavigationLifecycle.test.jsx. Tests cover initial navigation with and without StrictMode, exactly-once acknowledgment, subsequent links, shrinking and growing a tall row, replacement of pending navigation, dataset changes, and unmount cancellation.

649 tests passed across 73 hazard-analysis, assurance and STPA suites. Targeted ESLint and git diff --check passed. The production build passed with repository lint/bundle-size and outdated Browserslist warnings.

No hazard reasoning, generation, storage, worker preparation or export behavior changed. No live Safari smoke test was performed against the customer's architecture. No commit or push was requested.
