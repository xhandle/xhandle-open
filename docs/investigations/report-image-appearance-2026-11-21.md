# Report image appearance — 2026-11-21

Reports previously retained one PNG captured under the active appearance. Switching the report's surrounding colors cannot restyle pixels already flattened into that image. The same issue applies in both directions. Structured SVG report diagrams also had fixed light colors.

## Implementation

New Projects and code-architecture report captures retain light and dark PNGs of the same scene. Capture re-evaluates the diagram's original CSS inside a sandboxed, offscreen document, preserving its ancestor selectors, source positions, authored node/edge colors and full-scene bounds. It does not toggle the live app theme or invert an image. Each bounded raster uses the existing 4,096-side/8-megapixel full-diagram capture limits. The isolated document is removed after success or failure; stylesheet failures reject the pair instead of publishing unstyled pixels.

The report stores both variants with its immutable saved revision, outside compact library metadata. Theme changes select a saved image; they do not query a model, recapture the current project, replace historical report content or save a new version. Enlarged code-report previews use the same selector. Print media selects the light raster. Legacy single-image reports and unrelated illustrations retain their original pixels; regenerate a legacy report once to obtain paired snapshots.

Projects capture is scoped to a hydrated project and refreshed when its committed diagram changes. Report generation awaits an already-started capture so it does not miss a pair still being prepared. A project switch clears its cached pair and pending capture reference; abandoned captures cannot update the next project's state. New report versions, including graphical conversions and recoverable writing drafts, retain their own pair.

Structured report SVG diagrams use scoped appearance variables for backgrounds, labels, edges and markers. Their model/layout remains unchanged. Print uses their light palette. Normal diagram image/export APIs retain their existing behavior; the new paired API is used for reports.

## Verification

- 151 tests in 12 suites passed: paired-image selection in both directions; print source; safe, complete raster pairs; legacy/unrelated image fallback; isolated capture cleanup and stylesheet failure; immutable storage and compact metadata; existing report generation/library/model/capture geometry and authored diagram paint. Log: `/private/tmp/xhandle-report-theme-final-unit.log`.
- Focused ESLint passed with no errors. `git diff --check` passed.
- The new `report-appearance` Electron harness category checks actual PNG background/custom-node/themed-node pixels for captures begun in both appearances; offscreen nodes; unchanged live DOM, theme preference and cleanup; saved Projects report and SVG theme switching; library reload; code-report and enlarged-preview switching; and light print images. The first isolated preview passed all five checks with no runtime errors.

Final production verification: `/private/tmp/xhandle-report-theme-verified-20261121/report.json` — **passed (partial selection)**. All three selected categories passed: fresh build, synthetic fixtures and report appearance. All five report appearance workflows passed with no runtime errors. Shared and native source fingerprints remained stable. Detailed screenshots/pixel samples: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-report-appearance-aksxWd/result.json`.

The preceding wider run passed build, fixtures, platform theme, cookbook and report appearance. Its overall source-stability gate correctly failed because the final image-validation caching change was made after its build. The final fresh run above verifies that adjustment; all seven direct image-component tests were also rerun successfully (`/private/tmp/xhandle-report-image-final-unit.log`). No contrast assertion or functional check was relaxed. Earlier fixture iteration corrected nested dependency resolution and explicitly reopened the saved report after reload.

The new category is part of the comprehensive harness and documented in `docs/testing/electron-regression.md`. Runtime checks used macOS Electron and synthetic profiles, not live paid-model generation, external workspaces, a new all-category run or Linux runtime execution. A representative final dark report screenshot was visually reviewed. This task does not commit, push or publish an Electron update.

Final shared source fingerprint: `936797151b41e28e5addb5f9c224728264d39d2cbe10e8306342335511abd759`.
