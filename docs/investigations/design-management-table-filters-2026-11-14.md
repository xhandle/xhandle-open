# Design Management Table column filters — November 14, 2026

Every standard Table header now opens a searchable multiselect: ID, Title, Description, Kind, custom attributes, Status, Version, Updated and Links. Legacy modules and engineering project documents use the same controls. HTL retains its existing assessment-aware filtering through the shared dropdown component.

Checkboxes select exact displayed values, with OR within each column and AND across columns. The option search is case-insensitive and searches the entire column; Select matching applies the matching values. Blank values, Select all, Deselect all, Clear column filter and Clear filters are available. Active headers and a filtered count identify the current scope. Long option lists render 100 values at a time with Show more; options come from the full table, independent of other active filters.

Filtering preserves canonical objects, order, hierarchy numbering and editing callbacks. Intentionally hidden requirement titles remain blank in the title choices. Display formatting is preserved for structured values, default statuses/versions, link counts and dates. Filters are scoped to the document and draft/revision; they do not carry into another target. A filter that hides selected objects clears the editing selection, while new exact object navigation reveals its target. Resizing remains independent from header filtering. These are temporary view filters and are not saved as document changes.

Regression coverage includes every column, multiple selections, combined columns, blank values, no results, text search, large option lists, keyboard focus/Escape, resize, target switching, new data, hidden titles, read-only filtering and editing/navigation callbacks. Existing artifact, engineering project, HTL, modal, toolbar and Collaborator regressions are retained.

Validation: 344 tests in 19 suites passed. The production renderer build passed with existing warnings. All 42 live Electron scenarios passed without page errors, including eight new filter scenarios using real table/header controls. Controlled provider responses were used only for the existing Collaborator scenarios; filtering used the actual saved synthetic document/module/26,000-assessment HTL data and did not call AI endpoints.

Evidence: `/private/tmp/xhandle-column-filters-regression.log`, `/private/tmp/xhandle-column-filters-build.log`, `/private/tmp/xhandle-column-filters-live.cjs`, `/private/tmp/xhandle-design-collaborator-live-CknZ6o/result.json` and `/private/tmp/xhandle-design-collaborator-live-CknZ6o/column-filters-preview.png`. Renderer staging: `/private/tmp/xhandle-column-filters-preview-22wcl5d4`.

Full native smoke passed (`DESKTOP_SMOKE_OK`) in `/private/tmp/xhandle-column-filters-native-smoke.log`. The idle isolated manual preview was refreshed with its workspace preserved; renderer/API health checks passed. The private desktop repository remains unchanged. No commit, push or release was made.
