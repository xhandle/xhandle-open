# Software and Hardware Requirements Specifications — November 14, 2026

Added versioned `software-spec` and `hardware-spec` document templates named Software Requirements Specification and Hardware Requirements Specification. The shared catalog exposes both in Generate engineering artifact and the systems engineering project's document checkboxes. Existing template IDs, section IDs and default project document selection are preserved.

Both types use the selected system/project scope, source diagrams, source modules and source notes. Software sections address allocation, functions, performance/resources, interfaces/data, quality/design constraints and verification gaps. Hardware sections address allocation, functions, performance/physical characteristics, electrical/mechanical/data interfaces, environmental/reliability/design constraints and verification gaps. Neither type requires hazard analysis; they use explicitly selected engineering evidence rather than the safety-only HTL source path.

Domain guidance preserves upstream allocations and citations, distinguishes observed implementation from required behavior, and records unsupported actors, numerical criteria, interfaces or verification as gaps. Both templates use existing INCOSE-oriented standalone requirement guidance and bounded wording correction. Persistent defective wording stays a review gap. Saved/generated requirements use the atomic object organizer; multiple complete statements from a manual edit become separate children under the original topic title. These automated checks do not certify engineering correctness.

Project dependency order places these specifications after selected system/subsystem requirements and before design documents. They participate in the same saved drafts, review/acceptance, immutable revisions, source freshness, traceability, object edits and exports as other artifacts. Individual requirement statuses and engineering approval semantics are unchanged.

Validation passed:

- 493 regression tests in 23 suites, including both creation dialogs, generation prompts, wording correction and review gaps, atomic child objects, citations, exports and joint project acceptance.
- Production renderer build, with existing lint, Browserslist and bundle-size warnings.
- 50 live Electron scenarios, including creation, generation, acceptance, filterable tables and reload persistence for both specifications; joint project generation and acceptance; and the existing Collaborator, review, filter, Projects and Code-Based Architecture interactions. No renderer page errors were recorded.
- Full native smoke covering storage, API parity, streaming, cancellation, updates, renderer recovery and diagnostics. The native repository remains unchanged.

Live checks used isolated synthetic workspaces and controlled AI responses to exercise the production renderer and backend. They verify the workflow and prompt contracts, not the engineering quality of a particular model's output. The driver waits for the actual acceptance controls to disappear before checking saved revisions.

Local evidence: `/private/tmp/xhandle-specifications-regression.log`, `/private/tmp/xhandle-specifications-build.log`, `/private/tmp/xhandle-specifications-live.log`, `/private/tmp/xhandle-specifications-native-smoke.log`, and `/private/tmp/xhandle-design-collaborator-live-akZLN7/result.json`. The project selection screenshot is `/private/tmp/xhandle-design-collaborator-live-akZLN7/specifications-preview.png`.

The idle manual Electron preview was refreshed to `/private/tmp/xhandle-specifications-preview-n6ky6fci`, retaining its isolated profile and workspace. No commit, push or release was performed.
