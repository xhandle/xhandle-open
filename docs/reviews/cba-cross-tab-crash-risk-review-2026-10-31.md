# Code-Based Architecture cross-tab crash-risk review

Date: 2026-10-31

Scope: review only. No application source, tests, dependencies, configuration, or build artifacts were changed. The investigation prompt is in `docs/codex-prompts/review-cba-tab-crash-risk-2026-10-31.md`.

## Executive conclusion

The Software Requirements behavior is unlikely to be the same React recursion that previously produced `Maximum update depth exceeded` while scrolling Hazard & Remediation. The requirements tables use `VirtualTableBody`, whose row-measurement update is deferred through `requestAnimationFrame`; the hazard table uses separate windowing hooks. Neither Chrome nor Electron reproduced a nested-update exception or renderer crash under the synthetic stress run.

The review did identify a high-confidence, shared resource-pressure defect in Software Requirements, System Requirements, Subsystem Requirements, and System / Subsystem Design. Opening any of these surfaces automatically creates a review record for every artifact row, 50 records at a time, every 50 ms. Each batch rebuilds the global review-item collection, updates provider state, rerenders consumers, and performs IndexedDB collection work. With large projects this creates sustained CPU, allocation, persistence, and renderer-memory pressure even when the user is idle. This is a credible explanation for an Electron renderer becoming unresponsive or being terminated, although the customer's exact crash was not reproduced and cannot be classified without its error/crash evidence.

The risk is therefore present across several tabs, but not uniformly across every Code-Based Architecture tab.

## Findings

### 1. High: eager review registration causes sustained whole-app work and memory pressure

- `useArtifactReview.js:7` sets a batch size of 50.
- `useArtifactReview.js:49-84` walks every artifact row, copies the row into `originalContent` and `currentContent`, creates review items, and schedules the next batch after 50 ms.
- `ResultsReviewProvider.js:71-82` replaces the global review collection in React state and persists it for every batch.
- `ResultsReviewProvider.js:128-140` reconstructs a map from the entire existing collection on every batch.
- `reviewStore.js:72-95` obtains every existing IndexedDB key and calculates collection differences for each persistence operation.
- `ResultsReviewProvider.js:47-58` and `reviewStore.js:54-58` load the complete retained review collection into application memory at startup.

For 15,000 rows, one artifact tab schedules roughly 300 batches over at least 15 seconds. The workload is additive across Software, System, Subsystem, and Design artifacts. Because the collection lives in a top-level provider, batch updates also cause work outside the currently registering component.

Runtime evidence matched the 50 ms cadence. After scrolling stopped, Software Requirements continued for five seconds with 127 React commits in Chrome and 119 in Electron. The other artifact tabs showed 78-112 commits over the same idle interval. Traceability, which uses the same virtual table but not this artifact-review registration path, settled to zero commits.

### 2. The earlier hazard nested-update failure is not shared by the requirements table

- `VirtualTableBody.jsx:47-60` observes row height but defers `setMeasurement` with `requestAnimationFrame`.
- The requirements and design tabs use `EngineeringArtifactTable` and `VirtualTableBody`; hazard uses separate hazard-window hooks.
- During aggressive wheel scrolling and scrollbar jumps, table widths remained stable and only 11-18 body rows were mounted for 15,000 logical rows.
- No `Maximum update depth exceeded`, page error, console error, or renderer-gone event occurred.

This makes the exact synchronous layout-effect recursion a low-probability explanation for the Software Requirements report. The customer's word “crashing” could instead describe an unresponsive renderer, renderer termination, an out-of-memory event, or a different exception.

### 3. Medium: engineering table width is less explicit than the corrected hazard geometry

`EngineeringArtifactTable.js:310` gives the fixed-layout table `minWidth` but not an explicit `width`. This is structurally less robust than fixing both dimensions and could allow browser-dependent geometry feedback as column content or controls change. It did not oscillate in either stress run: Software, System, Subsystem, and Design widths stayed at 3960, 2900, 3200, and 3440 px respectively. Treat this as a latent geometry risk, not a reproduced crash cause.

### 4. Cross-tab scope

- **Software/System/Subsystem Requirements and Design:** high exposure to eager review registration and global persistence amplification.
- **Traceability:** uses the shared virtual table and may have expensive full-data derivation, but settled after loading and did not show the continuous update pattern.
- **Hazard & Remediation:** separate virtualization implementation; the previous nested-update signature was not observed in the current implementation.
- **Architecture Diagram:** large React Flow graphs can still create independent CPU/GPU pressure. This review exercised a 100-node graph, so it does not clear extremely large customer graphs.
- **Safety Remediation:** no error was observed during repeated switching, but it was not populated to the same 15,000-row scale as the requirements fixtures.

## Runtime investigation

Production-build stress fixtures contained 15,000 rows in each of Software, System, Subsystem, Design, and Hazard, plus architecture and traceability data. Each runtime received 240 trusted wheel inputs per table, scrollbar jumps, five-second idle observation, and 15 cycles across seven Code-Based Architecture surfaces (105 transitions).

### Chrome

- Page errors: 0
- Console errors: 0
- Renderer crashes: 0
- Tab-cycle JS heap: first 283 MB, peak 878 MB, last 587 MB
- Final JS heap: approximately 587 MB

### Electron

- Page errors: 0
- Console errors: 0
- Renderer crashes: 0
- Tab-cycle JS heap: first 367 MB, peak 1.31 GB, last 826 MB
- Final Electron tab working set: approximately 1.20 GB
- Final browser/GPU/utility working sets: approximately 137/78/33 MB

The heap was oscillatory because garbage collection reclaimed large amounts, so this is not proof of a monotonic leak. The allocation rate and peak working set are nevertheless operationally significant on a 16 GB customer machine, particularly alongside a 634 MB project and other desktop applications.

Raw diagnostic outputs:

- `/tmp/xhandle-cba-crash-review-chrome-final.json`
- `/tmp/xhandle-cba-crash-review-electron-final.json`
- `/tmp/xhandle-cba-crash-review-tests.log`

## Verification

The targeted suite passed: 5 suites, 70 tests. It covered `VirtualTableBody`, engineering artifact table/panel behavior, traceability loading, and functional decomposition behavior. Existing unit coverage does not model the full persistence and memory cost of tens of thousands of automatically registered review records.

## Evidence needed from the customer

To classify the reported crash, collect the timestamp and exact visible outcome, the Electron renderer error/console output, app logs, and the macOS `.ips`/DiagnosticReports entry if one exists. The decisive distinctions are:

- a red React overlay with `Maximum update depth exceeded`: nested React update;
- renderer disappearance/reload with `oom` or very high memory: resource termination;
- beachball without termination: long main-thread or persistence work;
- a deterministic JavaScript stack: a separate exception.

## Recommended next implementation task

Prioritize redesigning artifact review registration so opening a table does not materialize and persist a duplicate review object for every row. Review state should be sparse/lazy or derived on demand, persistence should operate on deltas without repeatedly scanning the whole collection, and provider updates should not rerender unrelated application surfaces. Add large-data browser and Electron regression tests with idle-settlement, heap/working-set, renderer-gone, and rapid-scroll assertions before changing lower-confidence geometry risks.
