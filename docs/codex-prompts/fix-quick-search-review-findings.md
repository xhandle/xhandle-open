# Fix confirmed quick-search review findings

Implement the three confirmed defects in docs/investigations/quick-search-review.md:
1. Index current editable values and selected dropdown labels only. Exclude unselected options, stale textarea defaults, hidden/password controls, and default checkbox/radio "on" values.
2. Exclude hidden cells, hidden text descendants, and visibility:hidden/collapse rows while retaining horizontally offscreen content. Avoid repeated style/layout work within one scan.
3. Reset the results viewport on query changes and keep keyboard selection visible when the result set changes. Scroll only the result list, not the background page.

Preserve Cmd+F/Ctrl+F, key-release activation/dismissal, IME safeguards, Delete/Backspace isolation, table filters, diagram positions, persistence, and existing public component behavior. Keep indexing on demand. Do not broaden this fix into cross-project search or redesign unrelated table behavior.

Add meaningful regression tests for all three defects. Run the relevant tests and the full suite. Repeat the existing browser diagnostics against WebKit and Chromium in isolated contexts; turn the defect conditions into assertions and compare performance against the reviewed fixture. Record results and limitations. Do not commit or push unless requested.
