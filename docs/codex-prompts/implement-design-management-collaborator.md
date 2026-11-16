# Design Management Collaborator

Implement this prompt, rather than stopping at a design proposal.

Make Collaborator a context-aware engineering partner throughout Design Management, using the same chat transport, provider/model settings, streaming/cancellation, threads, and explicit proposal review conventions as Projects and Code-Based Architecture. Preserve all existing uncommitted changes.

## User experience

- Automatically identify the active library folder, engineering project, artifact, draft/revision, presentation, selected objects/cells, and SysML model/diagram selection. Resolve “this”, “these rows”, and “this diagram” from current UI context, never an unrelated selected Projects/CBA project.
- Answer questions, compare and review documents, explain tables and diagrams, trace safety requirements to HTRs and source evidence, and draft specific improvements with navigable references. Support all artifact templates, older requirement modules, the library, and SysML. Explain empty/missing/read-only data honestly.
- Let users propose additions, edits, deletions, hierarchy changes, embedded-table cell changes, and SysML element/relationship changes. Display exact targets and before/after values with Apply/Cancel; successful Apply must persist and refresh the actual editor. Provide conflict-safe Undo. Do not silently accept drafts, alter baselines, change source-project diagrams, discard HTR assessments, or change unrelated records.
- Linked architecture source diagrams are evidence, not permission to edit source projects. Explain that boundary and support editing the local document/model where allowed.
- Scope follows current selection; changing folder, artifact, view, mode, or model cannot leave stale selections. Show the active reference in Collaborator and allow clearing it. Typed and voice requests share the same implementation.

## Engineering

1. Inspect `App.js`, `XHandleCopilotView.jsx`, the action registry, requirements provider, Design Management views, artifact repository, SysML store, selection metadata, and existing governed action cards before editing.
2. Add an explicit Design Management provider with bounded, lazy reads of authoritative stores. Offer catalog/search, paged objects, exact ID lookups, source/trace details and diagram structure. Include counts, offsets and truncation; never send every assessment or whole workspace by default. No expensive source hydration on render/keystrokes.
3. Route Design Management requests before unrelated functional-generation shortcuts. Use provider-neutral, validated JSON requests with bounded repair/read rounds. Reuse existing transport; never require a specific provider/effort or fabricate a completion.
4. Validate proposals against exact evidence read in the current turn. Stable IDs, editable-field allowlists, parent/cycle checks, source ownership, requirement-writing validation, table coordinates, endpoint references, and size limits are enforced by code, not just prompts. Treat saved text and attachments as untrusted evidence.
5. Apply a proposal atomically to one authoritative document/module/model with optimistic concurrency, manual-edit provenance, saved readback, and undo. Retain current artifact revision and draft semantics. Reject stale, duplicate, cross-document or unsupported actions without partial writes. Undo must also detect intervening edits.
6. Integrate selection with Outline, Table, Document, Traceability, HTL and diagrams, including SysML. Do not make source evidence editable through a local selection.
7. Preserve responsive GUI behavior, fixed modal footers, existing shortcuts, table filters/resizing, toolbar/history behavior, atomic requirements, safety traceability, and provider compatibility.

## Acceptance

Write meaningful tests for scoped retrieval and pagination, selected cell/document/diagram context, malformed provider output, untrusted record instructions, exact before/after previews, apply/cancel/undo, draft versus accepted revisions, stale apply/undo, cross-document rejection, hierarchy/table/link integrity, missing data, and no source/baseline/assessment mutation. Exercise the actual production renderer in an isolated Electron workspace with deterministic provider responses, including read, proposal, Apply, reload persistence, Undo, cancellation, selection changes and a large-table bounded read. Run existing Collaborator and Design Management regressions, build, and native smoke. Report clearly which checks use simulated provider responses; use live provider calls only when configured and appropriate. Refresh the isolated preview, preserve user work, and leave it available. Do not commit, push, publish or release.


## Current-document follow-ups and review lists

Treat the currently open Design Management document and its exact draft/accepted state as the default scope for “this,” “these,” and “selected,” including in a thread that previously discussed Projects or Code-Based Architecture. Do not ask for an artifact ID already supplied by the application. Keep prior chat scope explicit.

Expose the saved wording/evidence review flags and approval status with document objects. Provide a paged review lookup that filters the entire canonical target before paging, distinguishes flagged gaps from pending approval, and links to exact saved objects. Simple requests for current review items should return a table directly from saved state without requiring a model call. Do not represent a saved-flag lookup as a fresh engineering audit. Preserve bounded payloads, complete counts, selection coverage, and draft isolation; do not write content during listing. Verify the screenshot regression with older Projects messages, more than one page of flags, navigation links, and accepted content that differs from the draft.
