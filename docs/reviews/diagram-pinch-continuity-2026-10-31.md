# Initial overview pinch continuity — 2026-10-31

The user reports that the initial pinch now responds quickly but jumps directly to the zoomed-in view. This change adds intermediate camera positions for large overview pinch steps in the shared Code-Based Architecture renderer, including Functional and CSU. It does not establish uniformly smooth frame pacing on dense graphs.

## Implementation

`architecturePinchZoom.js` intercepts trackpad pinch wheel events only on large architecture canvases at overview scales (starting zoom at or below 0.2). Small changes apply on the next animation frame. Larger accumulated changes interpolate logarithmic zoom over 100 ms of animation-frame time; each frame advances at most 32 ms so a busy frame cannot consume the entire transition. Reduced-motion preference skips interpolation.

The controller updates the actual D3/React Flow camera. It uses the existing wheel normalization, zoom bounds and translation constraints, and keeps the cursor anchor fixed. Pending input accumulates against the requested final camera, preserving coalesced events, reversals and moving anchors. Close-view gestures and zoom buttons keep their native handling. Panning, pointer interaction, keyboard commands, external navigation and unmount cancel pending animation so it cannot move the camera afterward. Focus, visibility and window-size changes finish the requested zoom once instead of discarding input; container-size changes do not discard it.

The motion presentation remains active through the final animation frame. The controller reuses the measured D3 viewport extent during animation and immediately restores its original accessor, avoiding repeated layout measurements between frames. Listeners, subscriptions and animation frames are released on cleanup. No project storage or graph model format changes are involved.

## Validation

- **84 tests across eight suites pass**, including controller lifecycle and anchoring tests and an actual React Flow integration test. Production build and whitespace checks pass. ESLint reports zero errors and 11 existing warnings in the large diagram component; the new controller and its tests have none.
- Four headed Chrome/Electron × Functional/CSU cases pass on synthetic diagrams with 1,500 functions and 3,000 connections. Each exercises a single large pinch, clustered input, returning from close view to overview, 120-event pinch reversals, two-axis trackpad panning, matched button/pinch zoom amounts, cursor anchoring, page-scroll preservation and idle restoration. No runtime errors were recorded.
- Before this change, each single 1.8× overview pinch produced one camera update containing the entire zoom. The updated cases produce **five updates**, including the final position, with no update exceeding 32% of the total logarithmic zoom. Clustered input produces 10–12 updates. Final zoom amounts and anchors match the requested input.
- Chrome and Electron separately pass route and node editing with reload, offscreen-endpoint route interaction, source inspection, keyboard interaction, notes, zoom limits, PNG/JSON/XML export and PDF printing. Ten tab-switch cycles show zero DOM-node/document growth; post-GC heap growth from the warm checkpoint is approximately 0.66 MiB and 0.63 MiB respectively.

These are trusted CDP inputs and animation-frame camera samples on an Apple M2 / 8 GiB machine, not physical-trackpad presentation measurements on the customer's M4. Dense graphs still show individual gaps of approximately 150–267 ms between changed camera samples. Single large pinches finish in approximately 413–519 ms including initial delivery/rendering time. This validates removal of the single-step jump, not a universal 60 fps guarantee. Physical-trackpad feel remains for the user to assess in the preview.

An earlier candidate failed one Electron balanced-reversal check. Its interruption handling could discard queued input; the final code preserves it across focus/visibility/size changes, with regression tests and the full passing integration matrix above. The failed run did not capture its exact interruption trigger, so that specific cause is not conclusively established. Its log remains in `electron-functional-final.log`. An exploratory raster-cache experiment did not remove dense-frame pauses and was not added to application code.

## Artifacts and preview

The [measurement artifact](../investigations/diagram-pinch-continuity-2026-10-31.json) records baseline/current samples, source and harness hashes, runtime details and semantic checks. Raw results, rejected candidates and logs are under `/tmp/xhandle-pinch-continuity-20261031`; accepted runs use the `confirmed` suffix.

The tested renderer is `/tmp/xhandle-pinch-continuity-20261031/build-confirmed`. Its asset-manifest SHA-256 is `21f2807dcc70b7102123d9254c7120fa01d7b3e40cfb6db552f7a5c689ddd201`. The isolated **xHandle — Local Preview** was refreshed to this bundle using its existing preview profile. No desktop release was published.
