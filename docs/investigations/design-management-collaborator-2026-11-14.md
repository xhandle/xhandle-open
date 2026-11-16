# Design Management Collaborator — November 14, 2026

Implemented [the Codex prompt](../codex-prompts/implement-design-management-collaborator.md) in the shared application. No desktop fork, commit, push, release, or installer update was made. Earlier local toolbar, folder, modal, and diagnostics changes were preserved.

## Result

Collaborator now receives Design Management's actual active target and presentation, rather than a stale Projects/CBA selection. Outline, Table, Document, Traceability, HTL, saved architecture diagrams and SysML expose their current selection. The composer identifies its design context; selected references can be cleared. Typed and voice turns share the same conversation path and existing provider/model/effort transport.

The provider supports lazy library catalog/search, paged document objects, exact object IDs, saved source evidence, diagram nodes/edges, and windows into embedded tables. Counts, absolute cell coordinates, paging and truncation are explicit. Large UI selections are bounded to 24 identities with an original count. Ordinary view updates do not load document bodies or legacy undo snapshots.

Conversation responses can answer, request additional bounded evidence, clarify, or propose changes. Proposals reuse the existing review cards with authoritative before/after values and Apply/Cancel. They support local object creation/deletion, text and attribute edits, hierarchy, embedded-table cells, source citations, older-module links, and SysML elements/relationships. One proposal edits one document/module/model, with at most 40 actions. Models cannot edit protected fields, unread objects, unrelated document IDs, invalid table coordinates, hierarchy cycles, dangling endpoints or incomplete requirement statements. Read-only questions do not authorize proposals.

Artifact writes use repository revision/draft concurrency checks and retain a compact undo record with the saved revision or draft. They preserve draft acceptance, source snapshots and baselines. Older modules retain version/history changes; model edits preserve unrelated elements and diagram geometry. Apply reads back the changed values. Undo is bound to the conversation and saved version and refuses to overwrite intervening work.

HTL context uses consolidated records rather than sending every assessment. Actionable issue title/description edits update `hazardIssueSummaries`, the actual source of the displayed columns. Original assessments, grouping evidence and HTR identities are protected. Source architecture snapshots remain read-only; semantic source changes belong in their owning Projects/CBA workspace. Local SysML models remain editable.

## Validation

| Check | Result |
| --- | --- |
| Focused Collaborator and Design Management regressions | 285 tests in 15 suites passed |
| Production renderer build | Passed, with existing lint/Browserslist warnings |
| Live Electron collaboration scenarios | 14 passed; no page errors |
| Full native desktop smoke | Passed |
| Whitespace validation | `git diff --check` passed |

The real Electron shell and production renderer used a fresh synthetic workspace and deterministic AI responses. The GUI tests covered selected-row context, before/after review, Apply/readback, reload persistence, Undo, Cancel, Document selection, Traceability and an additional evidence read, embedded-table editing, draft preservation, a 26,000-assessment HTL edit, source-diagram selection/explanation, SysML rename/Undo, older-module persistence and Stop. The HTL request contained 10,455 serialized prompt characters and retained all 26,000 assessments. The largest request in this controlled run was 12,641 characters.

Unit regressions additionally cover paged reads, cells beyond the initial table preview, malformed model response repair, cancellation, untrusted record instructions, cross-document rejection, stale apply/undo, protected source fields, invalid hierarchy/endpoints and standalone requirement wording. Existing Projects/CBA chat, action-plan/executor, toolbar, modal, artifact and atomic-requirement tests remain green.

These checks validate application behavior with controlled responses; they do not establish semantic quality for every live AI model or exercise microphone hardware. Paid provider endpoints were not called by the GUI test. Existing provider transport compatibility is reused rather than introducing a provider-specific implementation.

## Local evidence

- Regression log: `/private/tmp/xhandle-design-collaborator-regression.log`.
- Build log: `/private/tmp/xhandle-design-collaborator-build.log`.
- Electron harness: `/private/tmp/xhandle-design-collaborator-live.cjs`.
- GUI result: `/private/tmp/xhandle-design-collaborator-live-HNu5GU/result.json`.
- Native screenshot: `/private/tmp/xhandle-design-collaborator-live-HNu5GU/collaborator-preview.png`.
- Native smoke log: `/private/tmp/xhandle-design-collaborator-native-smoke.log`.
- Staging: `/private/tmp/xhandle-design-collaborator-preview-LGCscf` (marked as a local working-tree review build).

The persistent isolated preview was refreshed successfully. Its renderer and API are healthy, and it is left open in Design Management with Collaborator docked. No synthetic test records were added to that manual preview during these checks.


## Follow-up: current draft review lookup

The reported screenshot showed Collaborator asking which document to inspect while Safety Requirements was already open and identified in the composer. Inspection found that the evidence projection omitted saved wording/evidence review metadata. The initial content read was also a single page, and the thread's earlier Projects discussion was supplied without explicit historical scope. Those gaps allowed an unnecessary model clarification.

The content reader now exposes saved review state, evidence-issue identifiers, and proposed kind. The new `review` read filters all canonical objects before paging, returns exact scoped totals, and separates wording/evidence gaps from ordinary Proposed approval status. HTLs use consolidated issue records. It does not reanalyze requirements, load original assessment payloads into chat, or change saved content.

Straightforward current-view requests such as “which of these still require review? show the list in a table” return a linked Markdown table from the saved state without a model request. Lists contain up to 24 objects per page, bounded further by payload size. A follow-up can retrieve the next page; a changed saved version restarts the listing. Draft identity, selections, incomplete selection coverage, and explicit alternative document requests are preserved. Other engineering questions continue through the normal model path with stronger current-target instructions, scoped historical messages, and review metadata.

Interactive testing also exposed review-table remounting during scroll: saved review results were going through the editable chat-table renderer. They now use a stable, read-only Markdown table, preserving links and preventing blur-based chat-table rewrites. Internal Design Management links open in the current app. A DOM-stability regression covers context rerenders and read-only cells.

Final follow-up validation:

| Check | Result |
| --- | --- |
| Related regressions | 297 tests in 15 suites passed |
| Production renderer | Passed; existing lint/Browserslist warnings |
| Live Electron scenarios | 18 passed; no page errors |
| Full native desktop smoke | `DESKTOP_SMOKE_OK` |
| Whitespace | `git diff --check` passed |

The 14 existing collaboration flows used controlled provider replies. Four additional scenarios exercised the actual saved-state lookup without an AI request: the screenshot's query after misleading Projects history, 40 draft flags across two pages, a normal mouse click opening the exact draft object, and the separate approved revision returning zero review items. Canonical saved content was unchanged by listing. These checks do not claim live-model semantic validation for arbitrary engineering questions.

Follow-up evidence:

- Regression log: `/private/tmp/xhandle-design-review-regression.log`.
- Build log: `/private/tmp/xhandle-design-review-build.log`.
- Live harness: `/private/tmp/xhandle-design-review-live.cjs`.
- Live result: `/private/tmp/xhandle-design-collaborator-live-JEKPbL/result.json`.
- Screenshot: `/private/tmp/xhandle-design-collaborator-live-JEKPbL/collaborator-preview.png`.
- Native smoke: `/private/tmp/xhandle-design-review-native-smoke.log`.
- Verified renderer staging: `/private/tmp/xhandle-design-review-preview-8jalfmsz`.

The isolated preview was checked for open dialogs and unsent composer text before refresh. The private native repository remains unchanged; this is a local shared-application review build.


## Follow-up questions with selectable answers

Collaborator now uses the shared choice card for ordinary follow-up questions as well as guided workflows. Design Management and the provider-neutral context protocol accept a bounded question/choices payload; evidence-backed free-form completions can return a trailing choices marker. Direct numbered choice questions from older response formats are recognized conservatively, while factual lists, recommendations, code and review tables remain unchanged.

Cards offer distinct radio choices, an explicit Continue button, and Something else with a required free-text field. Existing domain-specific custom-scope options retain their handlers. Answers are recorded in the current thread and completed controls remain visible as receipts. Generic selections continue the original request with the chosen answer; custom replies continue as a new user answer, with the question and original request supplied as conversation context. Option text does not execute operations or replace Apply/Cancel controls. Only the latest unanswered question can be submitted, duplicate submissions are guarded, and questions tied to a design document cannot silently retarget another document or draft state. Typed and spoken labels use the same generic continuation path.

Choice labels and answers survive bounded conversation-history preparation, so follow-ups such as “choose for me” retain the alternatives. Unsaved workspace content and original source snapshots are excluded from the choice metadata. Saved review-result tables keep their stable read-only renderer.

Live testing also exposed a context-notification feedback loop: equivalent surface-state objects re-registered the Design Management provider, notified the app and triggered another render. The provider now remains registered for its scope, reads current state through a ref, and notifies only when bounded context values change. Two regressions cover equivalent renders, selection/draft changes, current callbacks and a 26,000-item selection. Normal mouse navigation between Design Management, Code-Based Architecture and Projects passed after this fix.

Final selectable-answer validation:

| Check | Result |
| --- | --- |
| Related regressions | 320 tests in 17 suites passed |
| Production renderer | Passed; existing lint/Browserslist and bundle-size warnings |
| Live Electron scenarios | 26 passed; no page errors |
| Full native desktop smoke | `DESKTOP_SMOKE_OK` |
| Whitespace | `git diff --check` passed |

The previous 18 collaboration/review scenarios remain green. Eight additional GUI scenarios cover structured choices, required Something else text, reload persistence, legacy numbered options, stale document targeting, unchanged canonical document content after answering, Code-Based Architecture continuation and keyboard selection in Projects. Provider replies were controlled; no paid AI endpoints or microphone hardware were exercised.

Evidence:

- Regression log: `/private/tmp/xhandle-follow-up-regression.log`.
- Build log: `/private/tmp/xhandle-follow-up-build.log`.
- Live harness: `/private/tmp/xhandle-follow-up-live.cjs`.
- Live result: `/private/tmp/xhandle-design-collaborator-live-qituol/result.json`.
- Screenshot: `/private/tmp/xhandle-design-collaborator-live-qituol/collaborator-preview.png`.
- Native smoke: `/private/tmp/xhandle-follow-up-native-smoke.log`.
- Verified renderer staging: `/private/tmp/xhandle-follow-up-preview-1mrnlelh`.

The idle isolated manual preview was refreshed to this staging after checking for dialogs, unsent composer/custom text and pending choices. Its production renderer mounted, API ping passed and isolated workspace health checks passed. The private desktop repository remains unchanged.

## Follow-up: missing Apply control

The screenshot showed a plain-text Collaborator response referring to an Apply button and claiming approval would lock editing. That response had no validated edit plan, so no Apply control existed. The generated document's separate acceptance controls were also hidden in the artifact overflow panel.

Design evidence now includes application-owned workflow facts: ready versus incomplete proposal state, project-managed acceptance, exact control labels, object approval and the effects of acceptance. Conversation instructions distinguish a Collaborator edit proposal from accepting a generated document and from individual object approval. Text-only responses that direct users to an unavailable Apply control, falsely claim saved edits, or describe automatic approval/edit locks receive bounded repair. An explicit edit can produce a real before/after plan; a persistently invalid answer falls back to truthful workflow guidance without changing content. Missing-Apply questions use current saved state and the exact pending document/draft plan, with no model request.

A compact proposal bar above the artifact views exposes Review proposal and, once review is opened, Accept proposal. Detailed comparisons remain in the overflow panel. Incomplete drafts expose no acceptance control; project-managed documents retain project-level acceptance. Existing source freshness, revision and job-token checks still govern acceptance. Acceptance preserves object statuses and review flags and creates a document revision. Explicit object approval can be proposed through Collaborator, with Apply/Cancel, saved readback and Undo.

Validation: 338 tests in 18 suites passed, production renderer build passed with existing warnings, all 34 controlled live Electron scenarios passed with no page errors, and full native smoke returned `DESKTOP_SMOKE_OK`. The eight new GUI checks cover missing-button help without an AI call, prose-to-proposal repair, exact pending-card help, individual approval/Apply/Undo, visible document review/acceptance controls, accurate ready-draft guidance, stale-source acceptance rejection and incomplete-draft gating. Unit tests also verify successful acceptance preserves statuses and leaves objects editable. Paid provider endpoints were not called.

Evidence: `/private/tmp/xhandle-apply-controls-regression.log`, `/private/tmp/xhandle-apply-controls-build.log`, `/private/tmp/xhandle-apply-controls-live.cjs`, `/private/tmp/xhandle-design-collaborator-live-Me2GXN/result.json`, `/private/tmp/xhandle-design-collaborator-live-Me2GXN/apply-controls-preview.png` and `/private/tmp/xhandle-apply-controls-native-smoke.log`. Renderer staging: `/private/tmp/xhandle-apply-controls-preview-cc0x1we5`.
