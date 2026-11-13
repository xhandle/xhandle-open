# Natural Language Design engineering-artifact generation review

Date: November 7, 2026. Executed prompt: [review-design-management-artifact-generation.md](../codex-prompts/review-design-management-artifact-generation.md).

## Confirmed scope

The user clarified that this update targets **Design Management → Natural Language Design specifically**. Generation controls, generated artifact modules, editable objects, Document view, review and maintenance controls belong in that area. The SysML v2 Modeler remains outside the proposed UI changes. Reports remains a source of reusable presentation/generation infrastructure, not the destination for these artifacts. SysML may supply explicitly selected source information through an adapter; its separate modeler does not need to change for the first release. Findings about SysML below identify integration constraints, not a mandate to expand this feature into that area.

## Recommendation

Make generated engineering documents **typed modules composed of editable, linked design objects**, with Outline, Table, Trace and a new Document view over the same accepted content. Keep documents in Natural Language Design’s existing folder/module navigation. Add generation and maintenance workflows to that model; do not make a second Markdown library the authoritative design repository.

Reuse the Reports presentation and generation infrastructure selectively. Existing Reports already offers System Design Document and Subsystem Design Document templates, but produces standalone Markdown from hazard/functional-analysis inputs. It does not create maintained Design Management objects. Adding more report types alone would not fulfill this request.

Start with one complete vertical slice: generate a system specification into a selected design folder, review the proposed objects, accept/save them durably, view a polished document, edit a clause, change an upstream source, and review a targeted update without losing the edit. The first capability release should extend this foundation to **ConOps, system and subsystem specifications, system/subsystem design documents, and interface specifications**. A coherent program set follows from those dependency-aware templates, rather than a one-shot prompt producing unrelated documents.

This review does not change application behavior. Recommendations below are proposed behavior, not capabilities already implemented.

## 1. Current implementation and evidence

### Natural Language Design is an object editor, not an artifact-generation service

- `src/features/design-management/DesignManagementView.js:6` composes Natural Language Design and SysML v2 modes. It labels the workspace “Local Workspace,” retains the selected design context in React state, and passes `projectId={null}` into SysML. App mounts it at `src/App.js:21007` without an explicit engineering-program scope.
- `NaturalLanguageDesignPanel.js:3` wraps the existing editor. Its visible actions are **Generate SysML v2 Model** and **Analyze Model Gaps**. There is no artifact type picker or generate-program workflow here. Analyze Gaps changes mode; it is not a general document adequacy review.
- `src/components/RequirementsManager.jsx:53` defines the base module types System, Subsystem, Interface, Requirement and Test. Folders contain module metadata; modules contain row objects. This is an object-oriented authoring structure in the sense of individually identified editable records and relationships. It is **not yet a comprehensive systems metamodel** with explicit program, system, subsystem, interface-endpoint and document semantics.
- Folder records have `id`, `parentId`, `name`, `modules` and roles. Module records have `id`, `name`, `type`, description, typed attribute templates and view templates. See `RequirementsManager.jsx:505–624`, `:1875` and `src/features/requirements/actions/requirementsState.js:153–240`.
- Rows have stable-looking application IDs, titles, `heading`, `parentId`, `order`, status, attributes, links, version/history, timestamps and optionally content. Link types include derives, verifies, refines, satisfies and blocks (`RequirementsManager.jsx:42`). Headings and child rows drive the outline and numbering. Image and table objects render specially (`:3704`, `:3952`, `:4303`); narrative content is largely a title/description rather than a typed document section AST.
- Outline/Table/Trace, selection, inline editing, drag/drop, saved views and module attributes are already useful foundations. Module context exposes only the selected folder/module and its visible rows (`:1482–1503`); that is a UI context, not a complete program source inventory.
- Row edits create versioned previous snapshots (`:1814`); module baselines save full rows under folder/module/name (`:1746`). These are not controlled document revisions with immutable release metadata, a source manifest, and a shared section/object revision set.
- JSON export serializes all requirements; XLSX exports row attributes/links/content; CSV takes a folder context (`:2613`). These are data interchange mechanisms, not a polished document publishing pipeline. New documents must make the export scope explicit.

### Scoping and persistence need attention before generation

| Finding | Evidence | Consequence for this feature |
| --- | --- | --- |
| Folder and engineering-project identities are conflated. | Migration stamps `projectId: root.id`; shared save/populate stamp `projectId: folderId` in `requirementsState.js:93`, `:287`, `:350`. | Do not use that value to collect an actual workspace project's engineering evidence. Require an explicit ownership mapping. |
| Parent component and editor do not share the passed requirement state. | `DesignManagementView.js:47` passes `requirements`/`setRequirements`; `RequirementsManager.jsx:1098` does not destructure them and creates its own state at `:1117`. | Fix the integration contract; an App-level source array cannot be assumed to match the visible module. |
| UI and unmounted action paths have different storage/row behavior. | Editor `Storage.save` at `RequirementsManager.jsx:539`; shared helpers in `requirementsState.js:67`; App switches paths depending on provider availability at `App.js:6901`. | Generation/maintenance must use one mount-independent domain service. |
| Editor save failures can look successful. | `RequirementsManager.jsx:539–558` prunes images/history, falls back to sessionStorage, then logs failures without rejecting; `updateRequirements` publishes React state at `:1118`. | Never announce an accepted document as saved on this path. No silent pruning or session-only fallback for canonical artifacts. |
| Module population can break object identity and content. | `requirementsState.js:350–423` generates new IDs, retains supplied parent references without remapping, and omits `content`/provenance. Synthetic reproduction below confirms this. | Prerequisite for hierarchical generated documents and durable source links. |
| Mounted population does not return the exact objects it persists. | `RequirementsManager.jsx:2132–2157` calls the row builder separately inside the state updater and for its returned result; builder generates IDs when absent (`:1980`). | Returned IDs cannot be trusted when the caller omitted IDs. Generate/validate once, persist once, return the persisted result. |
| Module selection still uses names in important places. | `moduleByName` at `:1114`; module rows filter on `row.module === selectedModule` at `:1490`; other paths accept ID-or-name. | Make IDs authoritative for generated-document scope; names are display labels. |
| Quality rules treat every non-heading as a requirement. | `validateModuleQualityAction`, `RequirementsManager.jsx:1943–1980`, warns on absent “shall” and verification attributes. | Add artifact/object-type-aware rules; ConOps scenarios and rationale are not malformed requirements. |
| UI access checks are not a shared mutation contract. | `canEditModule` at `:1674` controls UI affordances; registered mutation actions at `:2387` expose direct functions without a common guard. | Authorize source reads, destination writes and review/apply in the service too. This is a source-inspection risk, not a demonstrated remote exploit. |

There is also an IndexedDB requirements repository in `src/components/utils/requirementsStore.ts:19–80` with Projects, RequirementFolders and Requirements. The current editor mainly uses localStorage but imports link helpers from that repository. For example, `getAllReqs` calls the asynchronous `listRequirementsByFolder` without awaiting it (`RequirementsManager.jsx:1161`). Do not assume this repository and localStorage are already synchronized, or choose one as the new canonical store without an explicit compatibility adapter and migration.

### Generation/action infrastructure exists, but not the requested workflow

`RequirementsManager.jsx:2387–2434` registers create/open/rename/populate/append/rewrite/delete/section/snapshot/quality actions. The registry is in `src/features/app/actionRegistry.js:12`; registration disappears when the editor unmounts. `getState().visibleModuleRows` is capped at 80, which is appropriate for compact UI context, **not complete source coverage**.

`src/features/requirements/actions/` provides unmounted module creation/population/append/focus helpers. `saveRequirementModule` only focuses a module: it is not a durable transaction committing a generated document. `App.js:6879–6932` already converts workflow requirements into specification-shaped rows and chooses the mounted or unmounted path. This is the closest integration seam, but it inherits the row-identity, content, persistence and scope gaps above.

The governed Collaborator path separately validates action plans and presents Apply changes (`workspaceActionPlan.js:111`; `XHandleCopilotView.jsx:2851`, `:6427`). Reuse that proposal/apply concept. The mere presence of editor action methods does not demonstrate a visible end-to-end generator for ConOps, specifications or maintained documents. Generic record mutation is not a full artifact planner.

### SysML is a related projection, not a complete artifact source

`SysMLV2ModelerView.js:141` derives parts/requirements/relationships heuristically from rows. It limits inputs to 120 rows, requirements to 50, generated verification cases to 16; Generate requirements limits model elements to 30 (`:312`). It infers system boundaries, part containment and satisfaction links. Those are generated suggestions, not verified architecture allocations or executed verification results.

`sysmlV2Store.js:18–110` stores the entire model array in localStorage. Null scope includes all models, and scoped reads also admit unowned models (`modelBelongsToProject`). `saveSysMLV2Model` falls back to the current active project when model ownership is missing. Because the Design Management view passes a null scope, model provenance must be corrected before automatic artifact maintenance uses it.

Retain SysML navigation, element identities and traceability as an adapter. Mark inferred relationships as proposed. Do not silently take these capped heuristics as a complete program architecture or regenerate SysML from newly generated prose and then cite that generated model as independent evidence.

## 2. Reports: what to reuse and what to separate

| Layer | Actual implementation | Recommendation |
| --- | --- | --- |
| Types/templates | `App.js:5811` includes System/Subsystem Design Document, Functional Architecture Definition, Test Plan and other report types. `generateAgenticReport.js:599`, `:667` contain SDD/SSDD structures. | Extract reusable outline ideas and template definitions; add a versioned engineering template registry with explicit inputs and object schemas. Existing coverage does not include first-class ConOps/system/subsystem/interface specification types. |
| Entry and sources | `App.js:8313` refuses generation without `analysisResult.Summary`; supplies hazard summary, method, functional decomposition and diagram. | New generation must work from stakeholder notes/design objects even before hazard analysis. Capture the chosen project/system/interface scope at job creation. |
| Orchestration | `generateAgenticReport.js:1162` plans, summarizes chunks, audits/revises and synthesizes Markdown; architecture-only reports take a special path. | Reuse backend auth/provider routing and audited request conventions. Build an artifact-specific section planner with durable section outputs; do not repurpose the hazard report loop unchanged. |
| AI requests | `generateAgenticReport.js:71` uses `/api/chat`, settings-based auth, schema contracts, bounded retry/continuation and partial drafts. | Reuse tested behavior through a shared request adapter. Top-level report generation does not accept/propagate a cancellation signal; the lower diagram helper does. New jobs need end-to-end cancellation and stale-result checks. |
| Rendering | `SafetyReportViewer.js:43` supplies attractive headings, tables, images, source anchors and graphical blocks; `ReportGraphicalDiagram.jsx` and `reportDiagramModel.js` supply diagram contracts. | Extract a scope-neutral document body renderer and object/source navigation. Stable anchors must use object IDs, not row positions. |
| Rich document shell | `ArchitectureReportViewer.jsx:105` has title metadata, table of contents, section review/comments, action items, image zoom and scroll restoration. Its IDs/review keys use repo/branch/report metadata. | Reuse presentation patterns, not its repository-specific identity or localStorage review persistence. Provide document/object/revision keys. |
| Safety of rich output | Both viewers use `rehypeRaw` (`SafetyReportViewer.js:163`, `ArchitectureReportViewer.jsx:554`). | Define an allowlisted rendering/sanitization policy before broadening generated content. This review did not perform a renderer exploit assessment. Validate diagram endpoints and labels against actual source objects. |
| Persistence/library | `generatedReportStorage.js:12–97` has metadata/body separation, project-indexed reads, immutable saved versions and atomic report+metadata writes. `ReportLibrary.jsx:5` guards delayed cross-project reads and hydrates bodies on selection. | Reuse these storage/lifecycle patterns. A report Markdown blob is insufficient as the document object database. |
| Review | Architecture report comments/actions are localStorage state; report-library draft/complete is an output completeness flag. | Add persisted review/acceptance/baseline states. Do not interpret report `complete` as engineering approval. |
| Publishing | `exportUtils.js:6` writes PDF as plain `doc.text`; Word as line paragraphs; filenames are Safety_Report. Google Docs copies Markdown and opens a blank document. | Export quality does not match the on-screen experience today. Build pagination, real headings/tables, figures/captions, cross-links, metadata and artifact-aware names. Do not advertise current Google Docs behavior as synchronized publishing. |

The current report-library tests are a strong pattern for atomic saves, separate metadata reads, snapshot diagrams, version isolation, missing-source navigation, partial drafts and late responses. They do not establish that generated documents can be edited as design objects or maintained as sources change.

## 3. Proposed canonical model

### Ownership, content and placement

Keep the existing folder/module interaction. Introduce a Design Artifact repository whose canonical records are:

- **ProgramScope:** explicit workspace kind and workspace project ID, with system/subsystem/interface object IDs. A folder's ID remains a folder ID. A user maps legacy folders to this scope; unowned legacy data stays unassigned until mapped.
- **ArtifactModule:** the typed document object: artifact ID, template/version, scope, destination folder, title/document number, current revision pointers and maintenance policy. The module appears alongside existing modules. A program is a collection of these modules with dependency relationships.
- **DesignObject:** an individually editable section, paragraph, operational scenario, requirement, interface, allocation, rationale, decision, figure or table. Each has stable identity, validated structured content, scope, ownership and object revisions. Keep requirement/interface semantics separate from narrative.
- **DocumentNode:** placement/order/parent information referencing a design object or a versioned external source object. Reuse an existing requirement by reference rather than clone it into several competing normative requirements. Freeze referenced revisions for a baseline; show current accepted revisions in working views.
- **ArtifactRevision:** an immutable accepted object/placement revision manifest, source manifest, template revision and review metadata. Working drafts and generated proposals are separate from the accepted revision.
- **GenerationJob / Proposal / Dependency:** restartable section-level job checkpoints, a proposed patch keyed by object ID, and source-object/revision dependencies. Attachments/diagrams are stored separately by content identity.

Illustrative proposed records (IDs/fields are design proposals, not existing APIs):

```json
{
  "module": {
    "id": "artifact:sys-spec:flight-control",
    "type": "engineering-document",
    "artifactType": "system-specification",
    "folderId": "folder:flight-control",
    "scope": {
      "workspaceType": "code-architecture",
      "projectId": "project:aircraft",
      "systemObjectId": "system:flight-control",
      "subsystemObjectId": null,
      "interfaceObjectId": null
    },
    "template": { "id": "system-specification", "version": 1 },
    "acceptedRevisionId": "revision:12",
    "proposalRevisionId": null,
    "maintenance": { "mode": "detect-changes", "state": "current" }
  },
  "object": {
    "id": "object:status-requirement",
    "kind": "requirement",
    "title": "Status indication",
    "content": { "format": "engineering-blocks-v1", "blocks": [
      { "kind": "paragraph", "text": "The system shall indicate its operating mode." }
    ] },
    "revisionId": "object-revision:7",
    "authorship": { "origin": "generated", "editedByUser": true },
    "sourceRefs": [
      { "adapter": "design-object", "objectId": "need:operator-awareness", "revision": "need-revision:3" }
    ],
    "reviewState": "proposed"
  },
  "placement": {
    "id": "node:spec-status",
    "artifactId": "artifact:sys-spec:flight-control",
    "parentNodeId": "node:functional-requirements",
    "order": 4,
    "objectRef": { "adapter": "design-object", "id": "object:status-requirement", "revision": "object-revision:7" }
  }
}
```

Outline, Table and Document are projections over this model, not separate copies of the prose. Existing fields (`id`, title, parent/order, attributes, links) remain useful adapter shapes. Extend content to a validated, versioned block representation for paragraphs, lists, figures, tables, citations and embedded object references. Do not overload `title` with entire paragraphs or encode the full document as a single requirement row.

Hierarchy rules: placement parents must exist in the same document; reject cycles; separate object composition from semantic relationships; distinguish generated inferences, authored requirements, approved allocations and verified results. Interface records need endpoint object references and structured contracts rather than a prose heading alone. Multiple document placements can reference one canonical object without giving it multiple conflicting owners.

### Durable storage and compatibility

Proposed named IndexedDB database `xhandle-design-artifacts`: stores for modules, objects/object revisions, placements, artifact revisions, dependencies, proposals, jobs and attachments. Index by scope, artifact, object and dependency source. Keep compact catalog records separate from content/attachments. Save accepted module/content/revision/manifests atomically; save large generation results incrementally to a staging job and publish by an atomic revision-pointer update. Use bounded reads and transaction waits, not full-program serialization on each edit.

Do not copy full documents into `xhandle:requirements` as a second authority. Add a shared repository adapter used by RequirementsManager, generation and background maintenance. Legacy modules continue reading their existing repository; new typed modules read the artifact repository through the same UI. Merge legacy and new module catalogs in the sidebar using IDs; keep new artifact metadata/content in one database transaction rather than split a commit across localStorage folder metadata and IndexedDB bodies.

Migrate legacy modules explicitly and idempotently: preview source-to-destination mappings, preserve IDs or record a deterministic remap, rewrite parents/links as one operation, verify counts and links, mark completion only after durable verification, and leave the legacy source available until success. Do not guess ownership from names. No wholesale destructive rewrite is needed for the first slice.

Integrate the named database with backup/restore, transfer, graph/source navigation and project deletion. `localBackupService.js:285` currently reads whole stores into a snapshot, so “named database” alone does not establish scalable backup: test large document/attachment collections and bound that path before promising full program bundles. Extend the existing immediate-deletion marker/cleanup integration so a canceled/deleted artifact or project cannot be resurrected by a late generation result or maintenance job.

## 4. Artifact coverage and dependency order

Templates below are standards-neutral starting points. A tailored program artifact set is not a claim of compliance or that every industry needs every document. Each template defines required inputs, optional inputs, allowed object kinds, quality checks and missing-input behavior.

| Artifact family | Scope and inputs | Editable output and key dependencies | Phase |
| --- | --- | --- | --- |
| ConOps | Program/system; mission, stakeholders, operational environment, actors, constraints, notes and agreed scenarios. | Purpose/boundary, actors, operational scenarios/modes, lifecycle/support concept, assumptions and unresolved questions. Can begin before architecture or hazards exist. Missing operational facts stay questions. | 1b |
| System requirements/specification | Named system; accepted needs/ConOps, constraints, architecture references, safety/security requirements where available. | Scope, functional/performance/quality/interface constraints, rationale, verification method and trace references. Normative requirements remain proposed until reviewed. First vertical slice. | 1a |
| Subsystem requirements/specifications | Explicit subsystem and allocations; accepted parent requirements, subsystem boundary and relevant interfaces. | Allocated/derived requirements, budgets, behavior, environmental constraints, parent trace and verification intent. Missing allocations are gaps, not permission to invent them. | 1b |
| System/subsystem design descriptions | Named system/subsystem; accepted architecture, behavior/state/data models, requirements, decisions and constraints. | Architecture/allocations, behavior, data/state, interfaces, trade rationale, safety/reliability/security provisions, requirement realization and open decisions. Distinguish design proposal from as-built evidence. | 1b |
| Interface specification / ICD | Selected interface and both endpoint owners; actual ports/signals/messages, data schemas, timing, units, protocols, failure/compatibility assumptions. | Interface identity and ownership, contracts, schemas, timing/error behavior, dependencies and verification intent. Missing endpoint/schema details produce explicit unresolved fields. | 1b |
| Architecture description | System/subsystem plus accepted functional/logical/physical views and allocations. | Viewpoint narratives, object-backed diagrams, boundaries, allocations and known limitations. Reuse architecture reporting presentation; never present inferred links as verified. | 2 |
| Verification plan / test specification / procedures | Requirement baselines, verification methods, test environment, configuration and acceptance criteria. | Coverage, responsibilities, cases/procedures, setup, steps and expected results. Expected results are separate from observed results; no fabricated pass/fail evidence. | 2 |
| Validation plan / scenarios | ConOps, stakeholder acceptance criteria and representative operations. | Operational scenarios, validation methods, environments, participants and success criteria. A plan is not evidence of stakeholder acceptance. | 2 |
| Traceability and coverage | Authoritative object relationships and source inventories, including completeness diagnostics. | Primarily deterministic matrices and gap summaries with links to stable IDs; optional generated explanation. Do not let AI invent relationship edges to fill cells. | 2 |
| Risk, assumptions, issues and decisions | Actual hazard/risk registers, operating assumptions, trade studies, choices and owners. | Structured registers and decision rationale with status, dependencies and review notes; reports summarize these objects. Do not create an independent conflicting risk register merely to publish a document. | 2 |
| Engineering/program plans | Project-provided lifecycle, responsibilities, schedules, configuration/change process, assurance approach and deliverables. | Tailored engineering-management, configuration-management and review plans. Populate known facts; missing owners/dates/processes are draft placeholders, not commitments. | 3 |
| Qualification/readiness/acceptance summaries | Baselines, executed verification, approved waivers, review outcomes and release configuration. | Evidence-backed summaries and readiness gaps. Generation cannot award approval, certify compliance or turn planned tests into executed results. | 3 |
| Operations, maintenance, installation and training artifacts | Approved operational design, constraints, procedures, support assumptions and audience. | Object-linked procedures, limits, troubleshooting/support and training outline. Require suitable reviewed sources before instructions are treated as released operational guidance. | 3 |

Program-set generation uses a dependency DAG: needs/ConOps → system requirements → allocations/subsystem requirements → design/interfaces → verification/validation planning → evidence/readiness reporting. Design/interface decisions can feed changes back to requirements, so graph cycles become reviewable proposals rather than automatic rewrite loops. Users can generate available artifacts independently; dependency gaps should not block useful draft work, but must remain visible.

## 5. User experience and document quality

1. **Generate artifact** in the Natural Language Design toolbar and module menu. Choose one type or a program set, source scope, destination folder, title and available source objects. Start with explicit project/system/subsystem/interface selectors; do not use whichever project happens to be active later.
2. Show a source/coverage summary, missing inputs, intended output modules and estimated generation scope. Ask essential questions or allow a clearly incomplete draft. Permit pasted stakeholder/design notes; do not assume current image/table insertion is a general document-ingestion pipeline.
3. Generate a draft into staging. Show section-level progress through Activities; allow cancellation and navigation. The existing editor remains usable. Partial output stays an explicitly incomplete draft and can resume after restart without rerunning completed sections.
4. Open a proposed typed module with **Outline / Table / Document / Trace**. The folder/module/row structure remains recognizable. Document view adds a cover/title block, document number and revision, contents, numbered sections, restrained typography, good tables, captions, diagrams, references, review state, page/print styles and useful empty/TBD states. No detached second library is required.
5. Preview the proposed changes before accepting them into the module. Show source links on clauses/figures, coverage warnings, inferred statements and unresolved questions. Accepted drafts are still not Approved/Baselined. A newly requested document can open immediately as a generated draft; regeneration of existing accepted content always opens as a proposal.
6. Edit an object or selected section and immediately see the corresponding document projection. Reuse/select existing canonical requirements rather than silently duplicating them. Regenerate a section, compare revisions, accept selected changes and preserve rejected/manual edits.
7. Baseline/export one document or a tailored program set. Include source/revision manifests and an honest draft/review watermark where appropriate. Exports use the same structured representation as preview, with real Word headings/tables and paginated PDF figures/contents; Markdown/JSON remain additional portable formats.

Empty-state design should explain how to generate the first useful artifact. Folder/module badges can show artifact type, draft/current/stale/review state. Keep the browser and authoring model; add targeted navigation and document controls rather than replace Design Management with a dashboard of downloads.

## 6. Maintenance while the area is closed

Default policy: **detect source changes automatically; propose updates when requested; never silently rewrite accepted or manually edited content**. Offer optional background draft proposals with explicit cost/rate controls. No provider calls should happen merely because a user opened or edited a source unless the relevant policy is enabled.

Proposed maintenance flow:

1. A source adapter emits stable identities, field-level semantic revision hashes, scope and read/coverage status. Sources include design objects, accepted requirements, model elements, interface definitions, architecture/hazard results, verification plans/results and user notes. Hash relevant accepted fields and attachment content identities; exclude scroll/selection timestamps and generated history to avoid noise.
2. A dependency index maps source revisions to affected sections/objects. App-level runtime records change notices even while Design Management is unmounted. It performs debounced, scope-bounded comparison; startup replays pending notices and compares persisted source manifests. Do not start a workspace-wide payload scan on every render or keystroke.
3. Mark only affected objects/documents stale, identifying why. An unreadable source produces “source unavailable” and suspends dependent proposals; it must not be treated as deletion or an empty authoritative inventory. An incomplete adapter cannot establish complete coverage.
4. A generation job fixes scope, template revision, source manifest and base accepted revision at creation. Complete inventories are paged and budgeted; the editor's top 80 rows or SysML's first 120 are not adequate inputs for a completeness claim. A bounded selection is allowed only when labeled as such.
5. Generated updates are patches over stable object IDs. Apply by three-way comparison of base, current accepted/manual state and proposal. Preserve user edits; mark conflicts. Generated-only, unchanged objects can be eligible for automatic draft proposals, but approvals/baselines remain human actions.
6. Reject or rebase a stale proposal if sources, target objects, template, ownership or base revision changed while the job ran. Source deletion proposes removal or an obsolete marker; it does not silently delete authored content. Exclusions/snoozes must survive restart.
7. Reconcile per-scope queues with deduplication and bounded concurrency, retries, cancellation and provider budgets. Successful commits emit one origin-tagged event. Output changes must not re-trigger the same source-generation job; hash/version dependencies and distinguish upstream sources from generated projections.
8. Preserve accepted documents when generation or persistence fails. Save and show partial drafts honestly. Resume storage publication separately from AI generation when the AI result already exists. Closing the app may pause work; no promise of closed-process AI execution is required.

The existing requirements-data-changed and SysML events are useful seams (`RequirementsManager.jsx:1152`, `sysmlV2Store.js:40`), and workspace freshness has source snapshots (`workspaceGraphFreshness.ts:5`). Those are not already a maintained-document dependency service. Normalize commit notifications across UI, unmounted actions, imports, restore and accepted generation. A relevance-oriented workspace graph can aid navigation; it must not substitute for complete source adapters or dependency manifests.

## 7. Implementation plan and acceptance criteria

### Phase 0: reliable domain boundary and explicit scope

- Extract one shared Design repository/mutation layer from `RequirementsManager.jsx` and `features/requirements/actions/requirementsState.js`. Define folder/module/object scope, schema validation, ID allocation/remapping and permissions outside React.
- Repair population/append/save content preservation and hierarchy/link remapping. Construct records once and return committed identities. Replace name-based mutations with ID-based APIs; legacy name lookup may remain only as an explicit adapter.
- Reject unsuccessful persistent writes, preserve unsaved drafts, and remove silent canonical-content pruning/session-only success semantics.
- Add legacy-folder ownership mapping and clear contracts between App, DesignManagementView and the Natural Language Design editor. Define a read-only SysML source adapter only if a selected template needs it; separate modeler changes are outside this scope. Keep “unassigned” explicit rather than infer actual project ownership from a folder name.
- Acceptance: identical results with Design Management mounted or closed; no cross-folder/project mutation; valid object references; a failed commit cannot be reported as saved; existing manual modules/imports/baselines still work.

### Phase 1a: system-specification vertical slice

Proposed additions under `src/features/design-management/artifacts/`:

| Component/service | Responsibility |
| --- | --- |
| `artifactTypes`, `artifactTemplates`, `artifactValidation` | Versioned object/document contracts; required inputs, allowed kinds, coverage and artifact-specific quality rules. |
| `designArtifactRepository` | Named IndexedDB metadata/content/revisions/jobs/proposals; scoped pagination, transactions and concurrency checks. |
| `artifactSourceAdapters`, `artifactSourceManifest` | Complete scoped inputs, stable source references and semantic revision hashes. |
| `artifactGenerationPlanner`, `artifactGenerationService` | One artifact or dependency-ordered program plan; typed section output, validation, retries/cancellation and durable checkpoints. |
| `artifactProposalService` | Three-way object changes, diff, accept/reject and conflict handling; common UI/Collaborator API. |
| `DesignArtifactGenerationDialog`, `DesignArtifactReviewPanel` | Scope/source/destination selection, missing inputs, draft preview and acceptance. |
| `DesignDocumentView`, `designDocumentProjection`, `designDocumentExport` | Same canonical objects rendered in polished preview, print, Markdown, Word and PDF. |

Proposed APIs:

```text
planArtifactSet({scope, templateIds, sourceSelection, destinationFolderId})
startArtifactGeneration({planId, sourceManifestRevision, policy, signal})
readGenerationJob({jobId, scope})
proposeArtifactUpdate({artifactId, sectionIds, baseRevisionId, sourceManifest})
acceptArtifactProposal({proposalId, expectedRevisionId, selectedChanges})
commitDesignObjectEdit({objectId, expectedRevisionId, patch})
baselineArtifact({artifactId, expectedRevisionId, reviewMetadata})
exportArtifact({artifactId, revisionId, format})
```

Acceptance: a system specification can be generated **without hazard-analysis results**, saved as linked editable objects, opened through its existing folder/module, previewed beautifully, edited, baselined and exported. Missing facts stay visible. Source changes produce a targeted update; manual text survives. Failure, cancel, navigation and reload retain recoverable state. Large documents do not hydrate every attachment/body merely to list modules. Document and repository integration must land together; a Markdown viewer alone is not this slice.

### Phase 1b: the other requested artifact families

Add ConOps, subsystem specifications, system/subsystem design descriptions and interface specifications on the same contracts. Add system/subsystem allocation and interface endpoint/contract selectors. Introduce program-set preview, explicit source dependency order, cross-document references and per-artifact accept/retry. Reuse shared template blocks; do not fork five independent generator pipelines. These types are part of the requested core capability, not optional long-term ideas.

### Phase 2: maintenance, evidence links and verification/validation artifacts

Add `artifactDependencyIndex` and an App-level `artifactMaintenanceRuntime` with mount-independent events, startup catch-up, staleness summaries, proposal scheduling, conflicts, exclusions and budgets. Add the architecture/verification/validation/traceability/decision families from the matrix. Integrate graph/source navigation and use real verification records for evidence-backed sections. Include the maintenance contract early in schemas; do not retrofit provenance after documents have already lost their sources.

### Phase 3: tailored program bundles and advanced publishing

Add program-specific template packs, release/review packages, engineering/configuration/operations/support artifacts and standards profiles only with explicit tailoring and verified applicable source requirements. Improve publication options and scalable portable bundles. Keep connected authoring/synchronization and fully unattended rewriting outside the initial scope.

### Required tests

- Scope: two projects with equal module/subsystem names, nested folders, null/unassigned legacy ownership, actual system/interface selection, numeric/string IDs, and switching scope during generation.
- Identity/content: rich narrative/table/image round trips, heading/parent/link remapping, canonical reuse in multiple documents, stable IDs across regeneration, mounted/unmounted parity, cycle rejection and no lost provenance.
- Persistence: atomic module/object/revision commit; quota/blocked/aborted writes; staged large output; interrupted migration; resume after restart; no false durable success or silent body pruning.
- Sources: inventories larger than 80/120 rows; paginated completeness; absent, failed, unreadable, removed and changed sources; immutable source baselines; diagram endpoint validation.
- AI jobs: malformed/truncated typed output; partial result checkpoints; bounded retry/cost; cancellation; provider/auth failures; late source/project changes; no provider request on ordinary render/default stale detection.
- Maintenance: debounced changes, closed-view events, startup catch-up, manual/approved-content preservation, three-way conflicts, snoozes/exclusions, idempotence and no self-generation loops.
- Presentation: preview/outline/table reflect the same objects; source anchors remain valid after reorder; accessible navigation; valid sanitized content; diagrams/tables; paginated print/PDF and structured Word snapshot tests; correct filenames and draft/revision labels.
- Lifecycle: baseline/export/import/backup/restore; module/program duplication with remapped references; deletion while a job is running; no resurrection from late saves or queued maintenance.

## 8. Validation performed and limits

Executed the prompt against the current working tree, including existing unrelated uncommitted changes. Only the prompt and this review were added for this request. No application implementation, personal database inspection, live-provider call, deployment or commit was performed.

Ran six existing focused suites:

```text
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath
  src/components/generateAgenticReport.test.js
  src/components/ReportLibrary.test.jsx
  src/components/SafetyReportViewer.test.js
  src/components/ReportGraphicalDiagram.test.jsx
  src/features/project-hazard-analysis/generatedReportStorage.test.js
  src/components/utils/exportUtils.test.js
```

Result: **6 suites, 67 tests passed**. These tests use mocked providers and synthetic storage, and support reuse of Reports behavior; they do not demonstrate the proposed Design Management feature. No dedicated Design Management/RequirementsManager/SysML test files were found in the searched source filenames. This is a coverage gap, not proof that no indirect test exercises those paths. A new production build was unnecessary for a documentation-only investigation; no new visual-quality or end-to-end artifact-generation claim is made.

A synthetic, in-memory probe loaded the current `requirementsState.js` through Babel's CommonJS transform and called `replaceModuleRequirements` for one heading and one child requirement with supplied IDs, a parent reference, rich content and source references. It used no real workspace data. Observed output:

```json
{
  "rowCount": 2,
  "inputIdsPreserved": false,
  "parentResolves": false,
  "contentPreserved": false,
  "sourceRefsPreserved": false,
  "projectIdIsFolder": true
}
```

This demonstrates an actual prerequisite defect in that shared path, not just a hypothetical concern about generated documents. A separate mounted-component behavioral reproduction was not performed; the separately built/returned IDs finding is from source inspection.

No external standards or versioned provider documentation was needed: this is a repository architecture review, with standards-neutral template recommendations rather than a standards-compliance assessment.

## 9. Product choices and defaults

These choices can be resolved during implementation without blocking this review:

- **Confirmed location and layout:** this update belongs specifically in Natural Language Design. Retain its folder/module/object model and add typed modules, Document view and generation/maintenance controls there. A wholesale redesign, a separate Reports destination, and SysML modeler UI changes are not prerequisites.
- **Maintenance autonomy:** default to automatic stale detection and user-approved update proposals; optional budgeted background proposals. Treat unattended acceptance/approval of generated changes as outside the initial capability.
- **Program scope:** support explicit existing workspace ownership plus an unassigned legacy state; if standalone engineering programs are required, add a first-class program identity rather than borrowing folder IDs.
- **Publishing priority:** polished on-screen Document view plus correct PDF/Word output for the first full release. Existing plain-text exports are not sufficient to satisfy visual parity.
- **Template tailoring:** ship neutral configurable outlines first. Domain/contract-specific packs and compliance mappings need their own reviewed requirements.

The recommended next implementation task is **Phase 0 plus the Phase 1a end-to-end system-specification slice**, with the remaining explicitly requested artifacts following on the same model in Phase 1b.
