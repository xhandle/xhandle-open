# Review xHandle quick search

Review the current working-tree implementation of quick search without changing application behavior. The requested feature is Cmd+F on macOS / Ctrl+F on Windows for the functional diagram canvas and all table areas.

Inspect QuickSearch.js, quickSearchUtils.js, quickSearch.css, TopNavBar.jsx, the functional diagram search provider, tests, and the actual table integrations. Verify:
- Shortcut ownership, keydown/keyup lifecycle, Delete/Backspace isolation, IME input, repeated shortcuts, dismissal, focus restoration, and interaction with existing modal/canvas handlers.
- Search coverage and accuracy for table cell values, editable controls, filtered/collapsed rows, hidden columns, diagrams, nested containers, and connections.
- Correct navigation/highlighting, stale or detached results, result limits, and keyboard accessibility.
- Performance when opening and typing, with representative large tables; avoid introducing background observers or writes.
- No unintended diagram rearrangement, data mutation/deletion, or persistence changes.
- Browser behavior in WebKit and Chromium when available; distinguish these checks from reproducing the user's installed Safari error.

Run existing relevant tests, add reproducible investigation scripts if useful, and perform focused browser probes in isolated browser contexts. Do not use or modify the user's browser data. Report confirmed defects with severity, exact source locations, reproductions, impact, and recommended fixes. Separate unconfirmed risks and limitations from confirmed findings. Save the review under docs/investigations. Do not claim passing tests prove absence of bugs. Do not fix findings, commit, or push as part of this review.
