# Export modal height fix

Executed `docs/codex-prompts/fix-export-modal-height.md`.

The export panel now uses a viewport-constrained flex column. The project list can shrink and scroll; the header, status/download region and action buttons retain their space. Short windows use reduced vertical padding. Existing project selection, cancel and download handlers are unchanged; no archive serialization code was changed in this step.

Validation:
- Production build passed with existing warnings.
- All 66 transfer tests passed.
- The browser diagnostic now asserts visibility, selection disabled state, and that scrolling the list does not move the status. All 30 cases passed: Chromium and WebKit; 1280×800, 1024×600, 800×450, 390×844 and 390×400; exporting, download-ready and error states; 20 synthetic projects per case.
- At the previously failing 390×400 ready state, action buttons now end at y=382, within the viewport; the download link ends at y=327. The list shrinks to 107 pixels.
- git diff --check passed.

The browser test renders the actual modal JSX with synthetic state and the production CSS in isolated pages. It does not run an actual export or access user storage. Actual large-project capacity testing remains outstanding; extremely smaller viewports and arbitrarily long error text were not tested. The earlier eight unrelated full-suite hazard-evaluation failures remain outside this change. No commit, push or release was performed.
