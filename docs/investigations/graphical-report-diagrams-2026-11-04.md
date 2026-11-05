# Graphical diagrams in generated reports

The user requested graphical figures in place of AI-generated ASCII diagrams, including the functional control diagram in an existing Subsystem Design Document.

## Implementation

New final-report writing requests diagrams as `xhandle-diagram` Markdown fences containing bounded node/edge data. The report viewer renders these as vector graphics with labeled boxes, routed arrows, feedback edges, and wrapped text. The existing captured project-diagram image continues to work. No dependencies were added: layout uses the project's installed Dagre library.

The graphical renderer accepts a small data schema rather than raw SVG, HTML, scripts, or URLs. It limits diagrams to 60 nodes and 100 edges, validates identifiers and endpoints, and limits text lengths before layout. Invalid data produces a local source/details fallback while preserving the rest of the report. The renderer uses React text nodes, distinct arrow-marker identifiers, and a proportional SVG viewBox. Layout is memoized for a stable diagram source; ordinary viewer rerenders do not restart a pending conversion.

Older ASCII/Unicode code-block diagrams offer **Render as graphical diagram**. Source diagrams are retained in a collapsed Original diagram section. Conversion runs only after the user's click, uses the configured AI provider and existing structured-response validation, and cancels if the diagram unmounts. No provider requests run merely from opening a report. Ambiguous connections must be called out in notes rather than invented.

Successful conversion replaces the matching diagram block in a new saved library version. The original report and its diagram snapshot remain intact. Reopening the converted version renders its stored graph data without another AI request. A failed save retains the rendered preview and offers a save retry without another conversion call. A late conversion cannot replace a different project/report selected while it was running.

This concerns report display and stored report figures. PDF/Word image embedding is still outside the existing text-only exporters; Google Docs still uses the existing Markdown clipboard action.

## Verification

- 78 tests across eight frontend suites passed: model/schema validation, labels and directions, feedback/self/duplicate edges, size limits, ASCII detection, fenced/indented source replacement, explicit-click conversion, cancellation, save-only retry, new-report instructions, provider routing, library/version persistence, and existing viewer/export controls.
- 21 checks using the actual installed React Markdown renderer passed. They cover SVG diagrams, old ASCII conversion controls, invalid diagram fallback, existing captured images, repeated placeholders, trailing content, and URL policy.
- Focused lint and whitespace checks passed. App lint retains existing warnings.
- The optimized production build passed with existing repository warnings.
- An isolated Electron 45 render of a manually specified test graph based on the screenshot's control-flow labels displayed seven nodes and nine connections. Every node was inside the SVG viewBox; no ASCII/code block remained. The resulting screenshot was visually inspected. This verifies the renderer, not the accuracy of a live AI conversion.

All automated generation/conversion tests use mocked responses. The Electron fixture used a separate temporary profile and blocked HTTP/HTTPS. No customer profile or paid provider call was used. Actual conversion with the user's configured provider remains an acceptance check. All work is local and unpublished.
