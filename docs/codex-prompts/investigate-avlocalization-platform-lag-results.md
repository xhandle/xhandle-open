# Investigation results — October 18, 2026

Baseline: main, a8a4301. Production code and saved data were not modified. No provider requests or analysis regeneration were performed.

## Conclusion and limits

Multiple scaling defects are present and reproducible in the current source. They can block interaction and increase memory/storage pressure at this project's scale. This investigation did not attach to the user's Safari session or load its saved IndexedDB dataset. It therefore does not establish the exact contribution of each defect to that session, nor prove a persistent idle loop or memory leak. Synthetic timings below are local Node measurements, not Safari timings or full UI benchmarks.

## Ranked findings

### 1. Diagram construction performs a full relationship scan for every node

`src/components/LiteSummaryDiagramReactFlowGitHub.js:388` implements `inferFunctionGroupForFile`, scanning all rows and splitting endpoint file strings. The generated-node loop calls it at line 3440 even when explicit endpoint architecture is present. Complexity is proportional to nodes multiplied by rows. Existing-node lookup also uses `nodes.find` per generated node.

Measured the actual extracted source functions using Node vm, with N relationships in a cycle, N distinct function nodes and files, and one inference call per node:

| Relationships / nodes | Inference loop | Architecture aggregation with shared hub |
| --- | ---: | ---: |
| 500 | 97 ms | 11 ms |
| 2,500 | 1,486 ms | 216 ms |
| 4,981 | 5,857 ms | 911 ms |

Fixture fields: fromFile=`src/file{i}.cpp`, toFile=next file, fromFunction=`calculate position {i}`, toFunction=next function, rowRef=`row{i}`. Hub test changes every toFunction to `shared hub`. Extracted helpers: primaryFile, tokenizeFunctionLabel, humanizeToken, inferFunctionGroupForFile, cleanArchLabel, archPath, computeArchitectureByFunction plus FUNCTION_GROUP_STOPWORDS. These are synchronous paths in the browser and can prevent clicks/paint while executing. Actual node count/topology is unknown; 4,981 relationships does not necessarily mean 4,981 nodes.

`computeArchitectureByFunction` (line 452) repeatedly copies growing row-reference and file arrays for shared functions. The build effect (3389–3531) depends on nodes and computes the signature, preferred-file index and architecture aggregation BEFORE its unchanged-structure early return. Consequently node changes can repeat expensive work even without a structural change. Not proof of an infinite render loop.

Recommendation: one-pass per-file grouping, mutable sets during aggregation then finalize once, node lookup map, and cached structural preprocessing independent of node position/selection changes. Avoid computation when explicit endpoint architecture already supplies the result.

### 2. Review persistence rewrites the entire global collection

`src/features/results-review/reviewStore.js:55` loads all review records, across projects/runs. `saveReviewItems` (line 74 onward) calls put on EVERY supplied item, despite its difference-write comment. `ResultsReviewProvider.js:67–80` queues whole collection snapshots serially and updates global context state before persistence completes. Rapid updates can queue multiple large saves; an actual queue backlog was not measured.

Executed the actual store source against an instrumented mock database. Saving 26,278 items issued 26,278 puts. Changing only item zero and saving again issued another 26,278 puts. This proves write amplification, not real IndexedDB throughput. Each stored table-row item embeds its columns and row. In memory, originalContent/currentContent initially share one object; do not count them as two independent deep copies. Separate records nonetheless carry their own content when stored/read.

Run-specific IDs preserve prior runs unless explicitly deleted. Global loading means navigating away from the large project does not unload its review collection. This is a credible application-wide memory/IO contributor, rather than only a diagram concern.

Recommendation: persist changed/deleted records, scope/paginate review loading, store table schema once, and coalesce queued updates without losing edits. Measure actual database bytes, loaded item count, queue depth and save duration before deciding on migration.

### 3. Hazard review matching serializes all rows into full-text map keys

`src/App.js:9562–9595` serializes every summary row with JSON.stringify, retains these strings as map keys, and serializes every candidate review row again to match it. This memo is not gated on the hazard tab being visible. It reruns when summary or review-item dependencies change, not on every unrelated click.

Reproduced the loop with 26,278 rows × 73 columns. Cells were `row{i} field{j} ` plus repeated padding:

| Padding per cell | Total key text (ASCII MiB) | Build index + match all rows |
| --- | ---: | ---: |
| 40 characters | 109 | 1,071 ms |
| 160 characters | 328 | 2,848 ms |

These sizes describe synthetic serialized text, NOT measured JavaScript heap or the user's dataset. Allocations for rows, temporary strings and maps add further pressure. Recommendation: join by stable row/run identity; retain compatibility checks without using full narrative strings as persistent keys.

### 4. Canvas work remains broad

The diagram uses `onlyRenderVisibleElements={false}` at line 4248, and derived view nodes/edges depend on geometry, highlighting and comments. The generator passes preserveLayoutOnMount only for focused navigation (line 4461); normal tab remounts can repeat arrangement. This is a confirmed implementation characteristic, but its render/layout cost was not measured here. Profile before selecting culling, layout caching or worker changes; preserve grouped-node and focus behavior.

## What the completion warning means

`src/App.js:14612–14625` reports analysis completion before creating review items from every generated summary row. Review registration is wrapped in a five-second `boundedHazardStorage` call. `resilientHazardCheckpoint.js:1–4` implements Promise.race; timing out does not cancel the original work. Thus review creation/persistence can continue after the warning and after the analysis appears complete.

The screenshot warning is consistent with a slow full review registration. It does not identify whether IndexedDB, serialization, queued saves or event-loop delays consumed the deadline, and does not by itself prove that the main hazard result save failed. Review storage uses a separate database from diagram positions; direct same-transaction contention between those stores was not established.

## Checks that narrow the diagnosis

- Hazard rows are windowed: CodeArchitectureHazardSummaryTable.js:339 calls useHazardRowWindow. Do not attribute this to rendering all 26,278 rows into DOM without evidence. Full-data grouping/filtering still exists.
- The saved architecture loader explicitly reloads only on scope/reload dependencies (App.js:4338 onward), not every review metadata update.
- Normalization shares content references initially; no blanket claim of duplicated deep objects.
- Review state is global and the review drawer remains mounted when closed; it displays one selected item, not the entire queue.
- Thousands of console messages are a plausible DevTools overhead contributor, but no open/closed DevTools comparison was performed.
- No exact current Safari heap, long-task profile, storage latency, background timer census, or real project interaction timing was available. These remain necessary to attribute residual lag after the confirmed defects are fixed.

## Prioritized implementation and validation

1. Remove repeated diagram scans/copying and preprocessing on node-only changes. Benchmark chain, hub and repeated-file graphs at 500/5,000/10,000 rows; assert positions/selection do not rebuild structural indexes.
2. Change review persistence to incremental writes and scoped loading. A one-item edit should write one item. Preserve history, deletion, retry correctness, and saved results under storage errors. Prevent unbounded queued snapshots.
3. Replace full-row string matching with stable identities. Test edits, duplicate content, imported rows, legacy records and project/run isolation.
4. Profile real browser opening, abstraction switching, hazard-tab switching, navigation away and 60 seconds idle, with DevTools closed/open. Record long tasks, retained heap, DOM counts, pending writes and queue depth. Target no multi-second synchronous tasks and no growing queue/heap during idle; define hardware-specific timing budgets from a baseline.
5. Only then optimize canvas layout/culling where profiling warrants it, with focus, grouping, saved positions and cancellation regression coverage.

Avoid a broad rewrite or another bundle of unmeasured optimizations. These results justify targeted fixes, not a claim that all current lag has one proven cause.
