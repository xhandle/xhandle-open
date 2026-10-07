# Functional response JSON recovery

The screenshot reports `Functional processing could not validate source row 486: JSON Parse error: Expected '}'`. This identifies a response parsing failure after the existing retry/split path, not a missing CSU source row. The actual provider response is unavailable, so its specific malformed content cannot be established from the screenshot.

The Functional request adapter previously relied exclusively on prompt wording to obtain JSON. Automatic GitHub/local Functional processing and manual generation now explicitly request `response_format: { type: 'json_object' }` through the existing backend support. Other analysis requests retain their existing format. Providers that do not enforce this format remain subject to response validation and recovery.

Parsing accepts whitespace around an enclosing JSON fence. Retries include explicit JSON/schema/escaping instructions. A malformed single-relationship response gets at most three attempts before failing; larger batches retain bounded subdivision. Coverage, duplicate IDs, source boundaries, and semantic validation remain mandatory. The code never fills in missing model output or publishes partial mappings as complete.

Validation: 51 tests passed in the Functional model/response suites, including fenced responses in both processing stages, malformed singleton recovery, persistent invalid JSON rejection, timeout recovery, cancellation, provider failures, and source equivalence. No live model run or customer data was used.

Production build passed with lint warnings; `git diff --check` passed.
