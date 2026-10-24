# Chrome / Electron source-analysis stall review

Reviewed public commit `68c856b` and private desktop main `5e8dd77` on 2026-10-24. Both working trees were clean before this investigation. Only this report and a standalone diagnostic probe were added; no production code, personal storage, running user sessions, or release artifacts were changed.

## Conclusion

**Confirmed implementation defect: catastrophic backtracking in the synchronous C++ function-indexing regex.** The exact expression from the application stalls on the local Autoware `common/autoware_lanelet2_utils/src/route_manager.cpp`, matching the file displayed in the Electron screenshot. Isolated Chrome and Electron reproduce the stall; macOS JavaScriptCore completes the expression in approximately seven seconds. This is strong evidence for the observed engine difference, though an unsymbolicated historical sample cannot conclusively identify its JavaScript call site.

This defect exists before the recent memory/concurrency changes: the same expression is present at public commit `1bca574`. It does not require AI calls, database contents, a large workspace, or a large file. A 221-character valid C++ constructor is enough to reproduce severe delays. Raising the heap limit is not the appropriate fix for this demonstrated issue.

## Findings

### P1 — Ambiguous repeated regex groups can monopolize the renderer

`src/components/generateFunctionalDecompositionFromGitHub.js:255–273`, especially line 258:

```js
/(?:^|\n)\s*(?:[A-Za-z_][A-Za-z0-9_:<>,*&\s~]*\s+)+([A-Za-z_][A-Za-z0-9_:~]*)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?{/g
```

The repeated return-type group contains both a greedy character class accepting whitespace and another whitespace repetition. The outer `+` permits many partitions of the same text. It can also cross lines and consume commas, pointer/reference markers, and identifiers. When the remaining function pattern cannot match, backtracking tries enormous numbers of partitions.

In the local route_manager.cpp probe, five matches complete; the next `exec`, starting at offset 12068 (line 315), does not return within the Node timeout. The remaining text contains a multiline constructor and initializer list. A synthetic constructor with multiple `const Type & valueN` parameters reproduces independently. Single-line checks did not reproduce the same delay; testing the multiline shape matters.

`buildSourceFileIndexRecord` invokes this on the renderer thread at line 310. `analyzeFile` calls it at line 3313, immediately after the source fetch and before emitting the “analyzing file” message. A frozen “fetching file” label can therefore represent local indexing after a successful fetch.

The scheduler runs four asynchronous file tasks on the same JavaScript thread (`functionalWorkScheduler.js:9–28`, invocation at generateFunctionalDecompositionFromGitHub.js:3465). Another task's completed-file status can be the last painted message. Neither status identifies the exact current CPU instruction. Synchronous regex execution prevents normal UI work and pending console evaluation from executing.

**Recommended fix:** replace this whole-file, ambiguous regex with a bounded token/scanning approach for candidate signatures and balanced delimiters. Handle comments, strings, multiline parameters, constructors/initializer lists, templates, and qualifiers explicitly. Preserve source line references and document unsupported syntax. Do not merely add an await around the same expression or move an indefinitely running expression to a worker.

### P2 — Source indexing repeats for every supported file

At lines 3313–3333, `analyzeFile` builds `currentFileRecord`, then `indexSourceFileToIDB` (lines 340–345) builds it again before saving. `.cpp` is included by `shouldIndexFunctionalAnalysisSource` at line 437. This doubles parsing on the successful normal path. Completed files also rebuild their indexes on resume (line 3277), so restarting does not guarantee bypassing problematic indexing.

**Recommended fix:** persist the already-built record, preserving the existing key, provenance, and storage-error handling. This removes duplicate work but cannot fix a pathological first parse by itself.

### P2 — Request timeouts and concurrency caps do not protect local parsing

The fetch deadline wraps only acquisition (line 3298); indexing happens afterward. The timeout implementation uses JavaScript timers (`functionalAnalysisResponse.js:79–96`), which cannot preempt synchronous renderer execution. Cancellation checks also occur outside the regex.

The cap of eight in `functionalRequestRuntime.js:112` controls the later model request preparation. `processResumableFunctionalModel` is called after extraction at line 3508. It does not govern this source-indexing operation.

**Recommended fix:** first bound the parser's work; add elapsed-phase diagnostics and cooperative yields between bounded processing units. If hard preemption is needed, isolate parsing in a worker with a deadline and explicit failure handling. Do not silently omit source evidence on timeout or announce a completed analysis with missing files.

## Measured reproduction

`cpp-indexer-engine-probe.py` extracts the exact regex from the checked-out source. It runs each test in a separate process; Chrome/Electron get temporary profiles and do not load xHandle, user databases, or AI providers. Timeout cleanup targets only the test process group. Electron additionally has a main-process watchdog. The expression is measured directly, not an alternative parser.

| Input | Node 20.20.2 / V8 11.3 | Installed Chrome 155 | Electron 45 / Chromium 156 | System JavaScriptCore |
|---|---|---|---|---|
| 11-character control (`a ` × 5 + `;`) | Not recorded | 0 ms regex time, exits | 0 ms regex time, exits | Not recorded |
| Actual route_manager.cpp, 13,438 characters | Exceeded 4 s; separate tracing test exceeded 5 s | Exceeded 15 s process deadline | Exceeded 15 s process deadline after printing engine versions | 5 matches; 7,221 ms first run, 6,983 ms repeat |
| Synthetic valid constructor, 8 arguments, 221 characters | Exceeded 2 s | Exceeded 12 s process deadline | Renderer watchdog fired at 16 s | 0 matches; 3,159 ms |

Timeouts are lower bounds, not measured completion times; Chrome/Electron process deadlines include startup. Successful controls establish that both harnesses launch and evaluate scripts. Electron's watchdog directly confirms the renderer expression failed to finish within its evaluation window.

Node constructor scaling (one measurement per size, indicative rather than a statistical benchmark): 2 args / 83 chars: 0 ms; 3 / 106: 0 ms; 4 / 129: 5 ms; 5 / 152: 70 ms; 6 / 175: 1,071 ms; 8 / 221: exceeds 2 seconds. This dramatic growth on tiny inputs supports pathological backtracking rather than workspace memory capacity.

Example commands from the public repo:

```sh
python3 docs/investigations/cpp-indexer-engine-probe.py --engine chrome --constructor-args 8 --timeout 12
python3 docs/investigations/cpp-indexer-engine-probe.py --engine electron --constructor-args 8 --timeout 18
python3 docs/investigations/cpp-indexer-engine-probe.py --engine jsc --constructor-args 8 --timeout 12
python3 docs/investigations/cpp-indexer-engine-probe.py --engine jsc --source /path/to/autoware_core/common/autoware_lanelet2_utils/src/route_manager.cpp --timeout 20
```

`--executable` overrides engine paths. The private desktop dependency supplies the default Electron executable. No customer's source is committed with the probe. Results above were gathered before the final diagnostic-only addition of a catch handler to suppress the watchdog's intentional renderer-disposal rejection.

## Why Safari can finish

The same expression completes in the system JavaScriptCore test while V8-based processes exceed the test limits. This directly demonstrates different behavior for this input. It does not establish the precise internal optimization or backtracking safeguard responsible. JavaScriptCore still takes seconds on very small input, so Safari success does not make the algorithm acceptable or guarantee correctness.

This was an engine-shell comparison for JavaScriptCore, not an automated test of the user's Safari tab. A full Safari/Chrome application comparison still needs identical app commits, source bytes, settings, and checkpoint states. The Electron sample was from app 0.2.2; the isolated test used the currently installed development Electron 45 dependency. We did not equate those versions.

The old sample files show sustained unresolved main-thread execution: Chrome 1,789 samples and 1.0 GB footprint; desktop 1,867 samples and 3.3 GB footprint (4.6 GB peak). Neither proves out-of-memory or names the offending JavaScript function. The Chrome inspected target also remains uncertain because its DevTools showed warmup.html. The independent reproduction removes that uncertainty for the identified code defect, but does not prove every historical freeze/crash has the same cause.

## Other reviewed paths and limits

- Desktop window configuration enables isolation/sandboxing and has no custom heap flag or parser override. The same source-indexer implementation is shared.
- Checkpoint snapshots still clone in-flight progress and serialize accumulated state (lines 3254–3270). This can add pressure, but is unnecessary for the reproduced stall.
- `lineNumberAt` rescans/copies prefixes for each match (line 116); brace scans can revisit text. These may amplify large-file costs, but are not needed for this reproduction.
- IndexedDB errors, networking, AI provider latency, and timer throttling cannot explain the isolated expression's CPU behavior. They can still cause separate failures elsewhere.
- Later hazard-analysis cache pressure and later Functional request preparation are different stages. This finding does not resolve all prior memory-pressure reports or Chrome error-code-5 crashes.

## Fix validation plan

1. Add timeout-isolated regressions for the synthetic constructor, long nonmatching token sequences, multiline templates, missing delimiters, nested comments/string-like text, and ordinary C++ definitions.
2. Assert expected names and source line ranges, not just elapsed time. Include constructors and ref-qualified methods; the current regex misses such forms.
3. Compare scaling across increasing inputs and verify near-linear behavior under a generous CI deadline. Keep dangerous old-code reproductions outside the main test runner so a regression cannot hang the suite.
4. Verify each file is indexed once; successful save/reload and resume preserve provenance and evidence references.
5. Replay representative Autoware files locally without paid AI calls in Chrome, Electron, and Safari; verify UI heartbeat and cancellation remain responsive.
6. Then run the complete 928-file workflow under controlled versions/settings, including resume and storage-failure tests. Measure CPU and heap separately. This full workflow was not run during the investigation.

If historical causal confirmation is still needed, capture the correct renderer's JavaScript CPU profile or paused call stack and a file/stage marker immediately before indexing. Expected evidence is `extractFunctionRangesCpp`/`RegExp.exec` beneath `buildSourceFileIndexRecord`. Native nearest-export symbols in the supplied samples are insufficient to establish that call chain.
