# Sparse-array compact export fix

Implemented 2026-10-26. Byte packing now requires an own entry with a valid byte at every index. Sparse arrays take the existing ordinary-array path, restoring missing values as undefined, consistent with the previous transport. Dense byte arrays retain compression; negative zero and explicit undefined remain intact. No format/version change or user-data migration is needed.

Validation:
- Before the fix, four regression cases failed (first, middle, last and all missing entries).
- After the fix, 133 transfer tests passed; one opt-in benchmark skipped.
- Tests cover explicit undefined and negative zero, as well as existing dense-array compression and structured-value compatibility.
- Targeted ESLint and git diff whitespace checks passed (tool emitted an existing Browserslist age notice).

This resolves the sparse-array finding in review-compact-transfer-safari-results.md. Earlier archives that already encoded missing entries as zeros cannot be repaired from that archive alone; re-export the original source project with this fix. No evidence shows the user's exported projects contained this edge case. Changes remain local and have not been published to Desktop.
