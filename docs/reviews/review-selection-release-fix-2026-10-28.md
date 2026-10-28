# Review selection release fix — 2026-10-28

The prior review found that preparing a durable hazard review save reset the drawer to its first item. A failed save then left the pending item and its Retry action off screen.

The drawer now tracks the selected review item by ID. Queue content or ordering updates keep that item selected; opening a new review scope still applies its requested starting item. After preparation, the pending item and Retry button remain visible. A mounted React regression covers preparation, retry, reordering, and a new scope.

The previous review report remains as the record of the finding. This change closes that finding in source code; packaged desktop behavior still needs release validation.

Validation: the mounted drawer tests passed, the production build completed with warnings, and the full Jest run had 317 passing suites. Eight failures in `hazardEvalRunner.test.js` were reproduced unchanged in a clean worktree at `4a56e75`; they predate this release. The suite remains red for that existing fixture issue.
