# Functional hierarchy validation failure

2026-10-07

The reported message came from one shared field validator covering subsystem, CSCI, CSC and rationale. It rejected missing/nonstring/blank fields and all strings over 300 characters, without identifying which condition or field failed. The provider prompt did not disclose the limit, and corrective retries supplied only a generic validation instruction.

A valid prose rationale longer than 300 characters reproduces the reported error. The actual provider response from the user's run was not available, so its precise failing field is not confirmed.

Changes:
- Validate container names separately, trimming before applying the 300-character display-name limit.
- Accept and preserve complete nonempty string rationales without imposing the display-name limit. Responses remain bounded by the existing provider output-token budget.
- Bound rationale excerpts in the reusable prompt catalog to 600 characters; stored explanations remain complete.
- Document field requirements in the generation prompt and provide the specific failed field/member and validation reason to automatic retries and subdivided requests.
- Preserve exact membership validation, explicit ownership checks, cancellation and atomic publication. No incomplete hierarchy is published.

Validation: 56 tests across hierarchy, Functional model and Functional table suites passed. New tests cover explanations exceeding 300 characters, catalog excerpt bounds, automatic field-specific correction, trimmed name limits, and rejection of empty rationale without mutating input. Production build passed with lint warnings. No customer saved data or paid model calls were used.
