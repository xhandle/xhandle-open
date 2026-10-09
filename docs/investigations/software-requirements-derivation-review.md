# Software requirements derivation review

Executed 2026-10-09 against the current working tree, including the previous uncommitted panel fix. Review only: no production code or customer data changed, and no live AI requests made.

## Outcome

The previous panel race fix is insufficient. Two storage defects were reproduced through the production artifact storage adapter with an injected IndexedDB fixture. One directly reproduces a successful save followed by an empty reload. Neither proves which failure occurred in the user's alpamayo session; that session's storage records and logs were not inspected.

## Findings

### High: successful fallback save can immediately reload stale or empty results

`artifactUtils.js:250`, `saveArtifactRowsAsync`, catches an IndexedDB write failure and accepts localStorage persistence as success for smaller results. It emits the normal change event. However, `loadArtifactRowsAsync` (`artifactUtils.js:208`) always prefers any array read from IndexedDB, including an older empty array, over the fresh localStorage/cache value. No revision or timestamp comparison resolves the conflict.

`EngineeringArtifactPanel.js:302` handles the save notification by reloading the same scope. The previous revision guard does not reject this read: it begins *after* the newly generated rows were published. Thus the new rows can be replaced by the old empty array, followed by the generation success message.

Reproduction: seed an empty IndexedDB result, inject a write failure, save one SWR row. Save resolves successfully and localStorage contains that row; the subsequent production async loader returns `[]`. Audit test reproduces this without mocking the storage functions themselves.

Minimal remedy: define an authoritative committed revision across storage backends. A successful fallback write must supersede older IndexedDB data on reads, including after reload. A later successful IndexedDB write must clear the fallback override. Do not fix this by always preferring localStorage, which may itself be stale. Test save notification, reload, repeated failure, and recovery with real browser storage as well as fault injection.

### High: missing chunks masquerade as a legitimate empty analysis

`artifactUtils.js:124`, `readArtifactRowsFromDb`, substitutes `[]` for absent or malformed chunks and never verifies the root record's `rowCount`. A manifest claiming one saved row whose chunk is missing loads as `[]`, without an error or fallback. The same defect can silently return partial results if some chunks remain.

Minimal remedy: validate every referenced chunk and total row count. Surface incomplete storage as a recoverable load error; only use a validated complete fallback. Do not overwrite a valid in-memory result or autosave an empty substitute. This review does not establish that the customer's chunks were missing.

### Medium: generation remains sequential, unbounded in request duration, and not checkpointed

`artifactAI.js:2257`, `deriveFunctionalSoftwareRequirements`, awaits batches of five rows sequentially. `repairCodeEchoSoftwareRequirements` (`:824`) may add another sequential model pass. `callAssuranceModel` (`:62`) supplies neither an abort signal nor a client deadline. Partial generated requirements live only inside the derivation until the full result returns to the panel and is saved.

Consequences: a stalled request can prevent publication indefinitely; a reload before completion loses that work. The activity's source-row progress does not represent durable saved rows. This is a separate reliability/performance finding, not evidence that a successfully committed result disappears.

Proposed follow-up: explicit cancellable request deadlines, bounded recovery, and durable draft checkpoints separated from published requirements. Preserve existing approved results. This is broader than the smallest storage correction.

### Medium: source selection still uses detailed architecture rows

`App.js:17568` supplies `cbaTableData` to the software requirements panel. The panel's `activeArchitectureRows` invokes `currentArchitectureRows`, which only removes historical lineage records (`codeRelationshipEvidence.js:6`). It does not select the processed Functional model. The software generator requests approximately one requirement per source relationship, plus hazard-derived requirements.

Consequences: having generated a simplified Functional view does not automatically reduce software derivation input or model work. Selecting a different input model requires an explicit traceability-aware decision; it should not be folded silently into the missing-results fix.

## Additional paths inspected

- Generated IDs are normalized to SWR identifiers before persistence. The panel filters saved rows by that prefix; ordinary generated IDs should survive this filter.
- Empty derivation now reports failure and preserves existing results, as implemented in the previous fix.
- Model/parse failures generally produce local fallback rows. The completion summary includes fallback counts. Therefore model failure alone does not normally explain a completely empty result table.
- Downstream clearing after software generation targets system requirements, subsystem requirements, and design—not software requirements. It is a separate persistence operation, so downstream cleanup failure can still mark the overall activity failed after software was saved.
- The main App requires an active repository, nonempty architecture rows, and no architecture loading state to mount the panel. The general data-change handler schedules a render; it does not itself clear requirements.
- Table column filters can hide rows, but the table shows match counts and a Clear filters action. No evidence established filtering as the cause here.
- Project-package restore and collaborator mutation are additional writers. No evidence established a concurrent import or collaborator edit during this user's run.
- Storage keys use artifact kind plus project ID and repository configuration ID. The panel save/read paths use the same computed key.

## Validation and limitations

Command:

```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/features/code-architecture-assurance/artifactStorageAudit.test.js src/features/code-architecture-assurance/EngineeringArtifactPanel.test.jsx src/features/code-architecture-assurance/artifactAI.test.js
```

Result: 3 suites, 21 tests passed. Two newly added audit tests assert the **current defective behavior**, not the desired invariant. Convert them to protection tests when implementing the correction.

The new audit tests exercise real storage adapter functions with a minimal fault-injected IndexedDB implementation. The existing panel tests mock storage, AI, and table rendering; the AI tests mock network responses. This is not an end-to-end Safari/customer database reproduction. No production build was needed because only the review prompt, report, and diagnostic tests were added.

Next implementation priority: correct backend authority/fallback reload and chunk validation, then test the entire generated-result → save event → table → reopen sequence with real IndexedDB. Capture scoped generation and persistence outcomes without dumping customer requirements. Those observations are still needed to identify the exact failure in alpamayo if it differs from the reproduced cases.
