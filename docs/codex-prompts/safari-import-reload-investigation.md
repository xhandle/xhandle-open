# Safari import reload investigation

The user reported a successful compact download followed by Safari reloading during import.

Local crash reports inspected read-only:
- October 26, 2026 09:39 EDT: WebContent EXC_BREAKPOINT / FOUNDATION termination; JavaScriptCore optimization-completion frames and async-generator resumption.
- October 26, 2026 10:37 EDT: WebContent EXC_BAD_ACCESS / SIGSEGV, address 0x48; `llint_entry_osr_function_for_call`, `asyncGeneratorUnwrapYieldResumption`, async iterator driver frames, and IndexedDB event dispatch.

These reports establish native engine failures, not an out-of-memory diagnosis. They do not identify the precise application JS function or prove which import stage failed. Asked the user for the file and final status before reload.

Change: replace import archive-line async-generator/for-await delegation with an awaited sequential callback reader. The callback completes validation or the IndexedDB transaction before reading the next line, retaining backpressure. Conflict hashing now explicitly pulls the value iterator and closes it in finally, avoiding the async iterator driver on that import path. Gzip reading, cleanup, checksums, two-pass preflight, cancellation, and normal-error rollback remain in place. No source projects or destination browser databases were edited during investigation.

124 transfer tests passed (opt-in file benchmark skipped). Chrome and Electron synthetic compressed download/import checks passed. Playwright WebKit compressed download/import also passed, preserving architecture, partial hazards, requirements and continuation state. Installed Safari verification is still required.

Publication occurs after validated writes; catch-based rollback cannot run after an OS/browser-process crash. Do not infer that a crash left no records, and do not clear conflicting destination data automatically. Newer compact export changes and this import mitigation remain local and unreleased.
