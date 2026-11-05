# Reports: complete diagram capture

After embedded images rendered successfully, the user observed that report diagrams were cropped. They requested either the complete diagram or separate subsystem images. This change implements the complete-diagram option; it does not add subsystem-specific report panels.

## Cause and correction

The project's `exportAsImage` captured the `.react-flow` canvas at its current screen dimensions and transform. Content beyond that viewport was already missing from the PNG before the report viewer displayed it. Scaling the existing PNG could not recover those elements.

`captureFullDiagram` instead measures rendered nodes, nested containers, routed paths, and edge labels relative to the scene's transformed origin. It captures the `.react-flow__viewport` with a full-scene transform applied only to the image library's clone. It does not call fitView, pan/zoom, change layout, or restyle the live scene. Controls and selection rectangles are excluded. All nodes are already rendered in this project diagram path; viewport-only element rendering is not enabled.

Raster dimensions are bounded to 4,096 pixels per side and 8,388,608 total pixels, with `pixelRatio: 1` to avoid Retina multiplying the backing canvas. Integer rounding is included when choosing the scale so the graph still fits. Very large diagrams are reduced in resolution rather than cropped. This bounds the bitmap allocation, not the entire DOM-cloning operation or every native allocation.

Both Markdown-inserted and placeholder images use proportional, container-width sizing. Capture readiness now waits for measured nodes and initial layout. Returning to the functional diagram or visible hazard split diagram triggers a fresh capture. Abandoned captures are ignored, failures are caught, and changing projects clears the previous project's capture. No new continuous capture loop or per-frame work is introduced.

## Verification

- 95 tests across five frontend suites passed: capture geometry and bitmap limits, live-scene preservation, negative/offscreen coordinates, routed paths/labels, system/subsystem editing, report generation, viewer behavior, and existing export controls.
- 18 tests with the actual installed Markdown renderer passed.
- Focused ESLint passed with no errors and existing warnings; `git diff --check` passed.
- A fresh optimized production build passed with existing repository warnings.
- Isolated Electron 45 pixel checks captured a synthetic graph with red, green, and blue nodes outside both sides of the visible viewport, plus an outlying edge path and label. At zooms 1.5 and 0.15, both full captures measured 2,720 × 1,780 pixels and retained all three exact node colors at their expected image coordinates. The live viewport transform stayed unchanged. The report image fit a 320-pixel container at its original aspect ratio despite a conflicting stylesheet rule.

The Electron check used a separate temporary profile and blocked HTTP/HTTPS requests. No customer data, paid provider calls, or installed app data was used. These checks cover the shared browser/Electron rendering path; they are not a live Safari acceptance test against the user's project.

## Preview and limits

Existing cropped images cannot be expanded into missing content. Open the project's Functional Diagramming view, allow the diagram and capture to finish, then return to Reports; the existing report can use that fresh image without another AI generation. Image persistence and PDF/Word embedding remain outside this change. Full diagrams can become small when scaled into report width; separate subsystem panels remain a possible subsequent improvement. Changes are local and unpublished.
