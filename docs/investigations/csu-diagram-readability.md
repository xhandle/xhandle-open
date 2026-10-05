# CSU diagram readability

Implemented `docs/codex-prompts/improve-csu-diagram-readability.md` following the screenshot comparison with Projects.

## Findings and changes

- CSU view uses restrained outer container tints and stronger CSC/CSU fills, with distinct header bands. The final colors incorporate the requested darker backgrounds after the initial readability adjustment. Compact abstraction styling is unchanged.
- Function cards used translucent backgrounds. They now use the same opaque white base with a tint overlay as Projects, so background details do not bleed through text.
- CSU functions were placed alphabetically. Automatic arrangement now improves local call distance through deterministic swaps within the same grid. It never accepts a swap that increases weighted Manhattan distance for local calls. It preserves node references, membership, grid dimensions, function gaps, and container gaps. The saved-position branch bypasses ordering.
- Removed the flat ELK calculation whose coordinates were discarded by the architecture grid layout. Nonarchitecture layout still uses ELK.
- A crossing edge could intercept a selected edge's route handle. The highlighted edge now renders above other edges while editing.
- Projects' orthogonal function routing is shared with CSU; see `csu-function-edge-routing.md` for that preceding change.

## Validation

- 60 tests passed across Projects history/system tests, CSU routing persistence tests, and local ordering tests.
- Isolated Chromium fixture retains all 16 functions, 15 edges, and four containers. Opaque card backgrounds and visible tints at all four hierarchy levels were verified. Horizontal card gap remains 216 layout units; measured vertical gap is 160 (162 grid gap minus the rendered card's extra border height).
- Browser routing fixture passed: segment dragging, scoped callbacks/persistence, style switching, compact views, reopening, reset, moving connected nodes, bidirectional markers, bundle adjustments, and read-only controls.
- Production build passed with existing warnings; targeted ESLint found zero errors and 11 existing warnings.
- `git diff --check` passed.

## Limits

Local ordering is a bounded heuristic, not a global crossing minimizer or obstacle router. Cross-CSU calls can still span other groups. No calls or analysis rows are filtered out to achieve the visual improvement. The browser fixtures use synthetic data, not the user's live projects. Safari and the exact large screenshot dataset were not tested. Existing layout restoration logic was retained, not redesigned.
