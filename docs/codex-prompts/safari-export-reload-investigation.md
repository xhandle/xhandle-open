# Safari export reload investigation — 2026-10-25

The user reported that exporting Manpads-test in Safari reloaded the page with “a problem occurred,” after the export-scope change.

Local diagnostic evidence:

- `~/Library/Logs/DiagnosticReports/com.apple.WebKit.WebContent-2026-10-25-170729.ips`: capture 17:07:24 EDT; EXC_BAD_ACCESS / SIGSEGV in JavaScriptCore DFG abstract interpretation and constant folding on a JIT worker thread.
- `~/Library/Logs/DiagnosticReports/com.apple.WebKit.WebContent-2026-10-25-172722.ips`: capture 17:27:17 EDT; EXC_BAD_ACCESS / SIGSEGV in `ScriptExecutable::newReplacementCodeBlockFor` and `operationOptimize`, with `asyncGeneratorUnwrapYieldResumption` and asynchronous iterator frames in the main-thread stack.

These are native WebContent process crashes. They do not establish that the immediate cause was an out-of-memory termination. Virtual address-space figures in these reports are not resident RAM measurements. Native stacks do not identify the exact application function, so linking them to the export encoder is a working hypothesis, not a proven root cause.

The encoder traversed each structured value through recursively delegated asynchronous generators. Replaced it with a pull iterator using an explicit traversal stack. Ordinary tokens now return directly; only Blob page reads require promises. The existing archive token protocol, compression, chunk sizes, integrity validation, and saved-result scope remain intact. Added early budget termination to the small-record estimator so deeply nested input cannot exhaust the call stack before reaching streamed encoding.

Validation:

- 120 tests passed in 13 transfer/hazard-storage suites. Added token-order, repeated-alias, 12,000-level nesting, and closed/error-iterator regressions. Existing binary, Unicode, cycle, corruption, cancellation, partial-analysis, and legacy-archive checks passed.
- Chrome, Playwright WebKit, and Electron each completed a 10,000-record / 3,600,000-token roundtrip stress test, followed by compressed disk export/download/import with partial analysis data and cancellation checks.
- Production build succeeded with warnings. Final encoder ESLint check and focused encoder tests passed after moving the Blob completion callback outside the traversal loop.
- Installed Safari WebDriver refused a session because “Allow remote automation” is disabled. That setting was not changed. Playwright WebKit is not the installed Safari build.

No live user database was changed, no application storage was cleared, and no desktop release was published. The actual Manpads-test export in installed Safari remains to be verified. Do not describe this change as a guaranteed fix for all Safari reloads or memory pressure.

## Installed Safari automation follow-up

After the user enabled remote automation, added `scripts/diagnostics/check-project-transfer-safari.cjs` to run the isolated fixture using Safari's native WebDriver. The permission-disabled error cleared, but two attempts both timed out while requesting a new Safari automation session, before any test page loaded. No installed-Safari test result is available yet. Driver processes and temporary fixture files were cleaned up. Suggested next step: the user saves unfinished browser work, quits and reopens Safari, then retries the runner. This runner retrieves the archive attachment through Node and supplies it through Safari's file input; it does not test Safari's native download UI.
