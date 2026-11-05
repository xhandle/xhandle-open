# Report scrolling — November 5, 2026

The Reports page, its document wrapper, and SafetyReportViewer each defined a
vertical scrolling area. The nested height limits let the document scrollbar
move outside the visible part of the page.

Following the user's subsequent screenshot and clarification, the sidebar
Reports page keeps its saved library, generation controls, and exports fixed.
Its document panel fills the remaining height and owns vertical document
scrolling, with a stable scrollbar gutter and bottom padding. The embedded
viewer has no nested vertical scrollbar. The library's existing list scroll
stays bounded and uses a viewport-relative height here so it leaves space for
the document in shorter windows. Wide tables retain horizontal scrolling.
The legacy Reporting tab and safety report drawer retain their parent-owned
scrolling. No data loading, storage, generation, or scroll handlers were added.

Validation: 36 existing report/library/diagram/capture tests and 21 installed
Markdown rendering checks passed. ESLint reported zero errors and 19 existing
warnings in App.js. Whitespace validation passed.

An isolated Electron 45 fixture rendered the current Reports JSX extracted
from App.js with the real report viewer, library, Markdown parser, and generated
application CSS. Long and short synthetic documents passed at 1280×800,
1024×600, and 800×600. All six cases had one vertical document scroll owner,
a scrollbar container ending at the window bottom, and the final paragraph
fully visible with 93 px below it. Wide tables scrolled horizontally inside
the report at narrower sizes without overflowing the page. No renderer errors
or crashes occurred. This was a layout fixture, not a packaged release smoke
test; the existing user preview was not rebuilt or restarted.

Evidence: `/private/tmp/report-scroll-tests.log`,
`/private/tmp/report-scroll-rendering.log`, `/private/tmp/report-scroll-lint.log`,
and `/private/tmp/report-scroll-electron.log`. The disposable fixture and JSON
results are under the temporary directory recorded in the Electron log.

## Document-panel follow-up

The final panel layout passed 14 report/library/diagram tests, whitespace
validation, and lint with zero errors (19 existing App warnings). The updated
isolated Electron check passed all six long/short report cases at 1280×800,
1024×600, and 800×600, using a 20-entry saved-report list and an open notice.
Only the document panel owned vertical document scrolling; the outer page did
not overflow or scroll, export controls did not move, and the final paragraph
was completely visible with 44 px below it. The panel stayed within the window.
No renderer errors or crashes were recorded. These follow-up results supersede
the earlier page-owned scrolling measurements above. Logs are
`/private/tmp/report-panel-scroll-{electron,tests,lint}.log`; the disposable
fixture is `/private/tmp/verify-report-panel-scroll.cjs`. The user preview was
subsequently rebuilt and reopened as `0.2.14-preview.20261105.13`, loading the
matching `main.5f82d036.js` renderer. Its existing project counts and configured
AI key were retained; no production update was published by that preview step.
