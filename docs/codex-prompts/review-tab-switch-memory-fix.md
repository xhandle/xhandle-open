# Review tab-switch memory fixes

Review the current uncommitted implementation for the Chrome/Electron crashes reported during rapid architecture, hazard, requirements and design tab switching. Inspect restoration cancellation, durable revision reuse, prepared-view retention, scope changes, background saves, import/delete invalidation, and preservation of partial analyses. Do not infer the cause from Chrome error code 5 alone.

Run targeted regression suites and the isolated 100-reentry Chromium diagnostic. Add focused characterization coverage for uncovered lifecycle risks. Distinguish synthetic loader testing from full application rendering and real large-workspace validation. Preserve user data and unrelated changes. Report actionable findings with code references and validation limitations; do not claim all crashes or regressions are eliminated. Review only: do not commit, publish, or change production behavior.
