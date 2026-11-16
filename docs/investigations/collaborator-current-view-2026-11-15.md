# Collaborator explanations of the open workspace

The reported Projects question, “describe this diagram,” reached the first model request with the project name and selection metadata, but no diagram content when nothing was selected. That allowed a redundant upload/saved-diagram chooser even though the diagram was already open.

Collaborator now captures bounded evidence from the current mounted workspace at send time. The current diagram/document/table is the default subject for references such as “this,” “the diagram,” and “what am I looking at.” Explicit attachments or a named different subject retain priority over that default. Current content takes precedence over earlier conversation; explanations remain read-only.

- Projects supplies live functional relationship direction, interface labels and descriptions. The table sample respects its filters. Inactive Projects tabs no longer contribute stale diagram/table/safety-issue selections.
- Code-Based Architecture supplies its current architecture relationships through a lazy surface reader, including the filtered decomposition when the table is open. Report presentation uses rendered report content rather than substituting architecture rows.
- Design Management retains its document/draft identity, scoped paged readers and edit review workflow, with current rendered evidence and shared explanation guidance.
- Safety Case supplies claim/evidence identities, text, review status and directed support links from its current model.
- All mounted areas, including Reports, System Test, dashboards and other tables/documents, share the bounded rendered-content reader. Hidden tabs, dialogs, inputs, sidebar controls and the conversation panel are excluded. Full-screen Collaborator does not silently borrow a previous workspace.

The architecture sample reads at most 32 relationships and about 9,000 content characters. Rendered evidence is capped at 8,000 characters and 4,000 visited DOM nodes. Samples and virtualized/paged/unloaded coverage limits are explicit. No storage indexing or workspace migration is needed for the current-view snapshot. Readers use current refs and do not publish context updates on every render.

Shared instructions request direct, evidence-grounded explanations of purpose, elements, directed flows and recorded details. A redundant “which diagram/document?” or upload/navigation question for an already supplied current target receives bounded repair. Missing content and attachment-only requests retain clarification. Saved-data questions still use the governed retrieval path, which also retains the current-view evidence.

## Validation

- 356 tests in 19 suites passed: current-view capture/routing, natural question variations, redundant clarification repair, hidden/stale/attachment scope, live-reader lifecycle, large-payload bounds, diagram support links, design edits, existing Collaborator actions/choices and affected workspaces.
- Production renderer build passed with existing lint/Browserslist warnings. Source maps match all eight changed application modules.
- Electron and Chrome each passed nine live scenarios with no runtime errors. The exact diagram question and two variations reached the model with current directed relationships and no selection; older unrelated history did not replace the subject. A forced redundant chooser triggered format repair before becoming a follow-up card. Area switches then exercised CBA architecture, Design Management Table and Document, System Test, Safety Case, and Reports. The canonical functional decomposition remained unchanged.
- Each live run made 11 controlled explanation/repair requests; the largest complete prompt was 19,883 characters. Paid AI endpoints were not used.
- Native smoke passed: renderer mount, backend ping, SQLite, persistence, diagnostics and isolated profile.
- The stopped manual Electron preview was reopened with its existing profile and the verified staging. The native desktop source repository remains clean; `git diff --check` passed.

These tests inspect application behavior with controlled model responses. They do not assert semantic correctness for every live provider/model. No paid AI endpoint is required by the live harness. No commit, push, release, or desktop source change is included.

Local evidence: `/private/tmp/xhandle-current-view-regression-final.log`, `/private/tmp/xhandle-current-view-build.log`; live harness `scripts/diagnostics/verify-collaborator-current-view.cjs` and synthetic seeder `scripts/diagnostics/build-collaborator-current-view-fixture.cjs`.

Live evidence:

- Electron: `/private/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-current-view-live-8OMoON/result.json`.
- Chrome: `/private/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-current-view-live-VniIT0/result.json`.
- Screenshots: `current-view-explanation.png` beside each result.
- Native smoke: `/private/tmp/xhandle-current-view-native-smoke.log`.
- Source-map verification: `/private/tmp/xhandle-current-view-build-source-check.json`.
- Renderer staging: `/private/tmp/xhandle-current-view-preview-nv4354vh`.
