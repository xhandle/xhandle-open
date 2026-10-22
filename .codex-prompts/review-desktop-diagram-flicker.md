# Review desktop diagram flicker mitigations

Review and execute checks against the current working tree in /Users/Nick/xhandle-open.

User report: the installed macOS xHandle desktop successfully completes local code analysis, but populated projects show diagram rendering artifacts and frequent flickering during panning/zooming and project/tab switches, broadly during GUI interactions. The supplied screenshot shows a large CSU overview. Browser parity and a reproducible project fixture are not available yet.

Changes under review: useDiagramResizeFit.js and its tests; its integration in LiteSummaryDiagramReactFlowGitHub.js; removal of will-change: transform from csuNavigation.css. Inspect the actual diff and surrounding production code, not just the tests.

1. Read applicable repository instructions. Review observer lifetime, callback freshness, timer cancellation, StrictMode, zero-size/hidden hosts, rapid resizes, navigation suppression, project switches, and initial graph readiness. Identify any new regressions or gaps.
2. Trace all auto-fit and layout triggers, large-canvas styling and viewport interaction handlers. Distinguish existing risks from regressions introduced by this patch. Avoid claiming GPU/compositor causation without runtime evidence.
3. Add meaningful tests for uncovered production behavior; fix demonstrable defects in scope. Preserve saved positions, graph structure, routes, selection, and project data. Do not broadly rewrite diagram logic or disable hardware acceleration without evidence.
4. Run the focused regression suites, a production build, and appropriate desktop host tests. Verify what source the desktop build actually contains before interpreting a desktop smoke result. Do not alter personal profiles or installed applications, publish, sign, or release.
5. Inspect the desktop validation options and attempt safe runtime validation if available. Synthetic/JSDOM tests cannot establish absence of visual flicker. Clearly record any missing fixture, automation capability, or packaged build; do not count unrelated old-binary smoke as testing these changes.
6. Write .codex-reviews/desktop-diagram-flicker-review.md with findings by severity, fixes, exact validation results, and a verdict: confirmed fixed, partially addressed, or unverified. Include a short practical runtime acceptance procedure for large/small diagrams, project/tab switches, panning/zooming, resize, saved positions/routes, and browser/desktop parity. Do not promise there are no bugs merely because tests pass.

Execute this review now; do not stop at describing a plan.
