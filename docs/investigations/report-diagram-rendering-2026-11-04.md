# Report diagrams: stripped embedded image sources

The user confirmed successful report generation after the JSON/audit fixes, but the Subsystem Design Document showed a blank image with the `Functional Architecture` alt text.

## Confirmed cause

`SafetyReportViewer` has two rendering paths. A retained `[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]` uses a direct React image element. When the AI omits that placeholder, the viewer inserts the captured PNG as Markdown instead. The installed `react-markdown` default URL transform removes `data:` URLs in that fallback path, yielding `<img src="" alt="Functional Architecture">`. The fallback architecture-heading match also only recognized the Safety template's exact `3. Functional Architecture` heading, so subsystem and system images were appended at the end.

Baseline rendering with the actual installed Markdown package reproduced the empty image source for a Subsystem Design Document without a placeholder. The same synthetic PNG retained its source in a System Design Document with a placeholder. Existing Jest viewer tests mock the Markdown package, so they could not detect its real URL policy.

## Local correction

- Permit base64 PNG, JPEG, and WebP sources specifically for image elements. All links and other URLs retain the Markdown renderer's default policy. SVG/HTML data URLs and JavaScript protocols remain blocked by that transform.
- Recognize architecture headings used by system, subsystem, safety, architecture-narrative, and appendix report templates. Preserve the end-of-report fallback when no architecture heading exists.
- Avoid reinserting a captured image already present in the report source.
- Preserve every section after repeated placeholders instead of destructuring only the first two split segments and losing later content.

The correction changes the common report viewer. It does not alter the diagram canvas, add captures, trigger AI calls, modify saved project data, or change report-generation behavior. Both browser and desktop use this shared viewer.

## Verification and scope

- Actual-parser checks: 18 passed using the installed React/Markdown packages, including six architecture-heading variants, placeholder/fallback paths, repeated placeholders, complete trailing content, existing Markdown and HTML images, text-only reports, and URL restrictions. Run with Node 22: `node --test scripts/diagnostics/report-diagram-rendering.test.cjs`.
- Existing report-generation, viewer, and export-control regression checks: 35 tests across three suites passed.
- Isolated Electron 45 runtime: captured PNG sources were retained and decoded to their expected dimensions for subsystem, system, safety, and placeholder report fixtures. The fixture used a temporary profile, synthetic reports, and blocked HTTP/HTTPS requests; no personal project or AI provider was used.
- Focused ESLint and `git diff --check` passed.
- The optimized production build passed with existing repository warnings.

These checks verify rendering of available captured images. Existing capture timing and persistence are unchanged; the report viewer cannot reconstruct a diagram if no capture was supplied. PDF and Word export currently write report text, and the Google Docs action copies Markdown; this viewer fix does not introduce image embedding into those pre-existing export implementations. The changes remain local and unpublished.
