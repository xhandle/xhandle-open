# Compact Reports controls and report names — 2026-11-21

The Reports area now has one compact toolbar: saved-report selection/search on the left and a … action button on the upper right. The saved-report heading/count, Refresh button, large generation controls and Exports panel are removed from this area. The contents/document panel fills the space below the toolbar. Existing Projects Reporting controls remain available.

The … popup contains Report type, Generate AI Report and the existing PDF, Word and Google Docs export callbacks. It also exposes Rename selected report and Delete selected report. Generation and export guards remain in place, including project hydration. The popup reuses the platform's existing bounded action disclosure and follows light/dark appearance.

The compact picker retains access to all saved reports and search. A currently selected report remains represented while filtering; same-named reports show dates to distinguish saved versions. Delete uses the existing confirmation and storage deletion path. Rename is also available on the full report library rows.

Renaming uses a focused modal with name validation, keyboard containment, Escape/Cancel, pending-state guards and retry feedback. It updates the title in both report and metadata stores in one transaction, preserving the saved report ID, generation date, body and light/dark diagrams. An updatedAt marker refreshes indexed metadata. The selected report updates without regenerating it or creating a new report version. Cross-project writes and deleted reports are rejected. Pending renames participate in the project-deletion write barrier, and a failed metadata write rolls back the document title as well.

## Verification

52 tests across four suites passed: report actions and callbacks, generation/export guards, rename keyboard/error flows, confirmation before deletion, compact selection/search, same-named reports, selected-report updates, project-switch races, atomic storage/name validation, deletion barriers and the existing contents controls. Log: `/private/tmp/xhandle-report-toolbar-final-units.log`. Focused ESLint and `git diff --check` passed.

The Electron report diagnostic now covers removal of the large panels, the menu in both appearances, reclaimed document height, title changes across reload without body/image changes, confirmed deletion and retention of other reports. The broader workspace/Collaborator diagnostics use the compact picker and retain their report evidence checks. Final production run: `/private/tmp/xhandle-report-toolbar-green-20261121/report.json` — **passed (partial selection)**. Fresh build, fixtures and report appearance passed. The report diagnostic completed all nine workflows with zero runtime errors, including both theme menus, rename/reload with unchanged content/diagrams, compact sidebar behavior, cancelled/confirmed deletion and preservation of other reports. Shared and native source fingerprints remained stable. Evidence and screenshots: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-report-appearance-ULA46r/result.json`. The final compact workspace and dark action popup were visually reviewed.

Earlier selected runs passed the platform theme and Collaborator context categories. Iteration caught a light search-placeholder contrast issue and a narrow timing window where the report renderer had replaced heading nodes before the sidebar observer's frame. The placeholder now has explicit semantic color, and navigation synchronizes heading references immediately before a jump. A new regression test forces immediate heading replacement before a click. No assertions were relaxed; the final run above includes these fixes and preserves the original report image checks.

Tests ran on macOS Electron using synthetic profiles, without private-data, live model generation, Google Docs publishing, a new all-category harness run or Linux execution. No commit, push or app publication is included.

Final shared fingerprint: `8fcd92b168e809834142f701bc989cf80366a26d38be27470dd59a28bda393e9`.
