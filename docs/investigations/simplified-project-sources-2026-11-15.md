# Simplified project source selection

The systems engineering project creation dialog no longer asks for architecture scope, functional diagram level, per-project source notes, source modules and owner assignments, or shared project context. Users still select owning projects, source diagrams and document types. Complete selected diagrams supply the captured evidence and provenance; project creation does not infer module ownership or fabricate notes. The code architecture abstraction selector remains available.

The project dialog no longer enumerates source modules when opening. The shared source picker hides scope and functional level fields for project creation; existing artifact creation and source management retain their scoped-selection behavior. Stored projects and APIs continue to support existing notes, module selections and scope metadata.

Validation: 106 tests across four related suites passed. The creation tests now use actual saved diagram rows in place of manual notes, confirm complete relationship capture and ownership, and compare the source project data before and after. ESLint reported no errors. The production build succeeded, and source maps matched both changed components plus the preceding traceability toolbar change.

Live Chrome and Electron checks use isolated profiles and no AI requests. Both created a project from two saved functional diagrams without the removed fields, verified owner deselection prunes its diagram selection, inspected the persisted document configurations, and confirmed source rows remain unchanged. They also confirm the separate Fit diagram toolbar button is absent while the canvas fit control remains available. Evidence: `xhandle-traceability-live-CWaG8W/result.json` (Chrome) and `xhandle-traceability-live-lmUJhO/result.json` (Electron), under the session temporary directory.

The manual Electron preview uses the new build with its existing isolated profile. No commit, push or release was performed.
