# Platform appearance review — 2026-11-21

The executed implementation prompt is [platform-dark-mode.md](../codex-prompts/platform-dark-mode.md).

## Changes

- Replaced conflicting global dark utility and diagram-paint overrides with shared semantic colors. Tailwind background, text and border roles resolve through the same palette as component CSS. Opacity and existing variants remain supported; SVG stroke/fill and saved custom paint are not globally recolored.
- Updated navigation, code architecture, Projects, hazard/requirements tables, Design Management documents/traceability, Reports, Safety Case, System Test, Collaborator, settings, menus and dialogs. Controls, placeholders, selected rows, warning/error panels, hover colors, diagram toolbars and chart chrome use theme-aware colors.
- Added Appearance settings with Light, Dark and Use device setting. The existing preference key remains supported. First paint, OS changes, storage events, shared hook state, blocked storage and legacy media-query listeners have explicit coverage. Resolving the OS preference no longer silently pins a manual preference.
- Preserved the original top-left xHandle logo image and layout at the user's request.
- Rendered diagram PNG captures composite the actual scene backdrop, preserving readable translucent groups and labels in dark appearance. Document export templates retain their existing styling.
- The private desktop checkout adds a narrow, validated appearance bridge for native theme/window background and a small persisted preference. Native code remains private.

No scrolling, analysis generation, saved-model or hazard-method algorithms were changed. No commit, push, installer publication or update-feed change is part of this task.

## Harness coverage

The comprehensive Electron harness now includes `theme`. It uses the production renderer, disposable profiles and synthetic data. It captures populated cross-area screenshots, checks visible text and field/placeholder contrast, detects unexpected bright HTML panels, exercises light/dark/device settings, native synchronization, storage events, reload and keyboard focus, and verifies custom node/edge paint. A deliberately unreadable white panel proves the audit actually catches regressions.

Preference, settings, palette, first-paint and diagram-background tests join the automatically discovered frontend suite. Native tests cover restoration, OS behavior, failed preference storage, cleanup, validation and sender trust. Fingerprints now cover Tailwind configuration, diagnostic scripts and both shared/native source at completion.

The contrast audit uses unrounded ratios: 4.5:1 for normal HTML text and field text; 3:1 for large text and icon-only glyphs. Semantic field boundaries and focus colors have palette checks. Alpha backgrounds are composited. Canvas/SVG paint, images, gradients and every possible user-authored color combination still require visual/engineering review; sampled checks are not a claim of universal accessibility conformance. Contrast criteria follow [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

## Verification

Final comprehensive run: **all 19 categories passed** in `/private/tmp/xhandle-dark-mode-green-20261121/report.json`. Shared and native source fingerprints remained unchanged throughout verification. Shared fingerprint: `93ee25000687292f5b304318694c3a5f3e95cd501e74119c4c12d4d8e84ce034`.

| Check | Result |
| --- | --- |
| Frontend | 4,493 passed, zero failed; four standard skips in the normal run. |
| Backend/diagnostic helpers | 141 passed. |
| Capacity | 13 passed, including the normally opt-in archive/checksum cases. |
| Native Node/Python | 52 and 19 passed. |
| Appearance workflows | 19 passed; 27 snapshots; 2,646 sampled visible text/field instances; zero sampled contrast failures and zero unexpected bright panels. |
| Other runtime suites | Native shell, workspace, HARA, organization profiles, design, generation, derivation, safety inheritance, Collaborator and worker responsiveness passed. |
| Packaged macOS review app | Unsigned disposable arm64 app passed the packaged smoke test. Its renderer matches the final production build byte for byte; all 31 packaged native files match the tested native source. |

Appearance evidence: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-workspace-regression-d5mhPv/result.json`, with `theme-1.png` through `theme-27.png` in that directory. The harness deliberately tests light appearance and briefly creates an unreadable white regression probe; these are test-only states.

Packaged smoke and exact-source parity evidence: `/private/tmp/xhandle-dark-mode-packaged-20261121/result.json` and `source-parity.json`. The first package attempt could not download an icon helper because of certificate validation; using the existing cached icon tools resolved that without disabling certificate checks. This is a local diagnostic package, not a signed/notarized release or published update. Linux/Windows runtime execution was not performed on this macOS host. Live paid-model evaluations remain disabled.

During iteration, one toolbar test still asserted a removed hardcoded color class. Its assertion now names the semantic class. Appearance sampling now waits for finite CSS transitions, and the HARA reload fixture keeps navigation locked open; these prevent sampling intermediate opacity and racing the auto-collapsing sidebar. The final full run includes these corrections.

Before/after exploratory captures are retained in earlier disposable diagnostic folders. The baseline exposed bright panels and unreadable text; representative final code architecture, document, report and hazard views were also visually reviewed. No external workspace data was used.
