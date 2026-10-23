# Renderer stability review — October 23, 2026

## Scope and conclusion

Reviewed shared source at `2bea396` (the full-workspace-transfer revert), plus desktop source at `c0d0cc1`. Executed the adjacent review prompt. No production behavior, workspace data, releases, or databases were changed. The customer's precise source revision, machine memory, browser crash dump, and project are unavailable.

The strongest source-supported explanation to investigate is cumulative renderer memory pressure plus repeated serialization during large hazard analyses. Three synthetic probes establish concrete scaling costs. They do **not** reproduce Chrome error 5, establish out-of-memory as its cause, or show that Safari and Chrome failed for the same reason. Safari's earlier screenshot explicitly reports a memory-triggered reload during the now-reverted full-workspace export, a different operation.

## Findings, ordered by investigation priority

### 1. High: full serialized evidence survives as run-long cache keys

`hazardEvidenceChunking.js:46-50,118-150`; callers `resultsFirstHazardPipeline.js:112` and `fastHazardApplicability.js:138-144`.

`evidenceItems` stores `JSON.stringify(payload)` as its key. Planning registers all oversized inputs before execution, so network concurrency limits do not bound this storage. `preparations` separately keys on the entire serialized input; `memo` keys on `[target,value,focus]` and retains successful promises/results; `summariesCache` keys include serialized evidence fragments. These maps have no byte limit or eviction within a run. Changing focus or target can create further variants. Evidence escalation also groups using full serialized source definitions.

**Measured:** planning 202 unique inputs containing 128,000-character evidence strings retained **25,872,656 characters** in `evidenceItems` keys alone. The test observes the actual map insertions. This is a count of retained key characters, **not measured browser heap bytes**. It excludes other caches, original objects, prompts, parsed copies, and runtime overhead. Inputs with identical packed payloads deduplicate; these results apply to distinct payloads.

**Trigger:** many distinct large relationships, especially with full-evidence applicability recovery and multiple contexts. This aligns with the screenshot's evidence-preparation stage and 202 identified inputs, but its actual evidence sizes are unknown.

**Recommended fix:** key caches using stable evidence identities/digests computed once, retain originals in one authoritative representation, and cap completed in-memory summaries by bytes. Persist provenance and load it when needed. Do not truncate safety evidence to fit a memory target.

### 2. High: checkpoint backpressure does not bound unsaved memory

`resilientHazardCheckpoint.js:9-12,24-31,53-78,119-149`.

`maxCleanEntries=96` limits only clean entries. Dirty entries retain their `basis` and result until saved; a stalled write keeps the original operation attached, while subsequent writes continue to enter `dirty`. `writeMany()` resolves after enqueueing, not after persistence. Permanent failures stop draining but do not reject further enqueueing. A single evidence lineage basis can include a full parsed input. Retention is finite for a finite run, but there is no configured entry/byte ceiling or producer backpressure.

**Measured:** with a stalled backend and the default clean-entry limit of 96, 300 writes were accepted and `flush()` reported `{unsaved:true,pending:300}`. No database was opened. This demonstrates queue growth, not a leak after cancellation.

**Recommended fix:** bound pending bytes and pause producers when storage falls behind, with cancellation-aware waiting and an actionable UI. Preserve unsaved accepted work; never silently evict dirty checkpoints. Continue observing the original transaction rather than racing duplicate writes.

### 3. Medium: checkpointing repeatedly serializes and hashes full source/context

`resultsFirstHazardPipeline.js:69-70,88`; `fastHazardApplicability.js:44`; `resilientHazardCheckpoint.js:15-21,83-90,124-130`; `codeHazardGenerationCheckpoint.js:22-25,71-78`.

Every fresh checkpoint basis embeds full context/source. Both checkpoint layers compute identities separately. WeakMap memoization helps only when the exact same basis object is reused; callers construct new basis objects for reads and writes. The underlying layer also serializes a version/scope wrapper. Cryptographic hashing is asynchronous, but `JSON.stringify()` and `TextEncoder.encode()` run synchronously before it. Batches can have 48 digests in flight.

**Measured:** reading and writing 48 sources sharing a 128,000-character evidence string caused **96 full-basis serializations totaling 12,291,724 characters in the resilient layer alone**, with Web Crypto enabled. The real underlying IndexedDB checkpoint layer was mocked, so this excludes its additional hashing and storage costs. This is cumulative allocation/work, not simultaneously live memory.

**Recommended fix:** compute source/context content digests once and share canonical versioned checkpoint identities between layers. Preserve invalidation when source, context, provider/model, or prompt contracts change.

### 4. Medium: prompt building does substantial repeated main-thread work

`hazardPromptPayload.js:5-27`; `resultsFirstHazardPipeline.js:17-37,112,125-126,152-153`; `codeArchitectureHazardUtils.js:682-713`; `fastHazardRunner.js:146`.

The lossless interner stringifies nested objects at each traversal level, then traverses again to encode. Prompt-size checks repeatedly build complete candidate prompts while growing batches. Generation planning builds one full prompt per source before dispatch. Input rows expand as relationship × guide phrase × operational context, and the compact sources retain access to evidence. Request byte budgets constrain outgoing prompts, not allocations needed to construct them.

The CSV draft has a worker with termination cleanup (`useHazardDraft.js`); the active generation/prompt path reviewed here still runs in the renderer. This can produce stalls and transient allocation spikes even when persistent caches fit in memory. No GPU fault or specific rendering loop was reproduced.

**Recommended fix:** precompute canonical relationship/context payloads and sizes, group guide phrases without rebuilding evidence, and move expensive preparation to a worker using bounded messages. Measure structured-clone overhead before moving entire input graphs to workers.

### 5. Medium: existing backup path can amplify memory and overlap itself

`localBackupService.js:267-342,372-390,407-416,494-505,616-625`.

The remaining older backup implementation loads entire stores with `getAll()`, retains the complete snapshot, pretty-prints all data into another string, and creates a Blob for downloads. `backupNow()` sets a busy status but has no single-flight guard. Automatic backup uses a 1.5-second debounce, which does not prevent a new backup starting while an earlier asynchronous backup is still active. The queue requires a configured, permitted folder for automatic execution; this should not be assumed on the customer's machine. Manual downloads also use the whole-snapshot path.

`getAllKeys()` is queued only after awaiting `getAll()` in the same transaction. This leaves a browser transaction-lifetime risk, consistent with the user's earlier Safari transaction error, but it was not reproduced in this review. The Blob URL is revoked immediately after the click, which is a separate download reliability concern, not an established crash cause.

**Recommended fix:** serialize backup operations, coalesce pending changes, use cursor/bounded-record export, queue dependent store requests while the transaction is active, and defer URL cleanup until safe. Verify Safari with an isolated large fixture. The reverted full-workspace feature remains removed.

### 6. Medium: Electron lacks explicit renderer-failure diagnostics and recovery

Inspected `/Users/Nick/xhandle-desktop/electron` at `c0d0cc1`: no explicit `render-process-gone`, `unresponsive`, `child-process-gone`, or `crashReporter` handler was found. Backend failure handling is distinct from renderer failure handling.

Electron packages the same hazard implementation, so the source-level memory risks also apply there. Production optimization may reduce overhead; this review did not benchmark browser versus desktop or establish a failure threshold for either.

**Recommended fix:** record renderer termination reason/exit code and app/source versions, offer explicit recovery, and resume only from validated durable checkpoints. Record bounded metadata rather than source code, API keys, or full prompts. Avoid unconditional reload loops.

## Important counterevidence and limits

- Hazard table rendering already uses row virtualization (`CodeArchitectureHazardSummaryTable.js`, `useHazardRowWindow.js`), including incremental initial preparation for larger datasets. It is not correct to attribute the screenshot to 14,483 fully mounted table rows without measurement.
- Provider work is bounded: three screening/evidence scheduler slots and four generation workers, with an evidence extraction limiter. There is no demonstrated unbounded provider-request fan-out in the active pipeline. These limits do not bound cached payloads or dirty storage queues.
- Current hazard diagnostics predominantly log compact metadata and token usage, not entire evidence graphs. Traceability schema logs also show small schema summaries. DevTools overhead is a possible amplifier, not a confirmed cause; older helpers logging full sheets are not sufficient evidence that the screenshot's active pipeline does so.
- Cancellation listeners/worker cleanup and the runner's final checkpoint abort exist. The main cache finding is retention throughout a live run, not proof of a cross-run leak.
- Current fast-run checkpoints intentionally remain available for continuation; explicit regeneration clears a scope. Automatic historical retention policies warrant separate storage-growth testing, but disk growth alone does not establish renderer memory exhaustion.
- React StrictMode is enabled at the root. Its development-only checks can add overhead; there is no evidence here that it launches duplicate analyses.
- The removed full-workspace exporter cannot explain a new failure in this reverted tree. The customer's revision must be recorded before applying findings to their installation.

## Validation

Added `browserMemoryReview.test.js`: three isolated probes with synthetic strings, mocked persistence, and no provider requests. Node Web Crypto and TextEncoder are supplied only within the serialization probe and restored afterward. No personal browser profile is accessed.

Executed six suites: browser memory probes, evidence chunking, resilient checkpoints, IndexedDB checkpoint behavior, results-first pipeline, and fast runner. **111 tests passed, six suites passed.** These establish the described behaviors and existing functional contracts; they are not browser crash or heap-profile tests. A first Web Crypto probe needed a TextEncoder test-environment shim; the corrected final run passes.

Command:

```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath \
  src/features/code-architecture-hazard-analysis/browserMemoryReview.test.js \
  src/features/code-architecture-hazard-analysis/hazardEvidenceChunking.test.js \
  src/features/code-architecture-hazard-analysis/resilientHazardCheckpoint.test.js \
  src/features/code-architecture-hazard-analysis/codeHazardGenerationCheckpoint.test.js \
  src/features/code-architecture-hazard-analysis/resultsFirstHazardPipeline.test.js \
  src/features/code-architecture-hazard-analysis/fastHazardRunner.test.js
```

## Evidence needed to identify the customer's actual crash

Capture their source SHA, browser/OS version, machine RAM, exact operation, relationship/phrase/context counts, and crash report. Reproduce using an isolated copy or synthetic fixture with similar input sizes. Sample renderer memory and allocation profiles across planning, chunking, checkpoint reads/writes, and finalization; record pending checkpoint bytes and cache bytes. Compare the same workload in development Chrome, production Chrome, Safari, and packaged Electron, first without DevTools and then with it. Test slow storage and cancellation independently. A termination reason/dump establishing OOM, or a reproducible stack for another failure, is needed to move from plausible code causes to an actual diagnosis.
