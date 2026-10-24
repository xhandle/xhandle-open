# Review of the C++ indexing fix

Prompt executed: `docs/codex-prompts/review-cpp-source-indexer-fix.md`.
Scope: uncommitted scanner, source-index integration, tests, and diagnostic harness against public baseline `68c856b`. Review included new adversarial fixtures and comparison with the original regex, rather than simply rerunning the implementation's tests.

## Result

The demonstrated catastrophic-backtracking defect is removed. The exact local route_manager.cpp file completes in isolated Chrome/Electron/JavaScriptCore probes, retaining all eight definitions and inspected ranges. The first implementation did contain correctness gaps; the review reproduced and corrected the findings below. The result warrants an end-to-end application retest, not a claim that every browser crash or C++ construct is covered.

## Findings corrected during review

1. **P1 — Template defaults and packs dropped valid functions.** The prefix rejection treated `=` and the dots in `...` inside template parameters as assignment/member-access expressions. Real Autoware examples included `wait_for_service`, `print`, `makeAdapter`, and `Guarded`. The scanner now skips template heads independently while preserving the declaration's start line. Added tests failed before the correction and pass afterward. Nested type defaults and parenthesized comparison defaults are covered. A subsequent valid numeric comparison default (`template<bool B = 1 < 3>`) exposed an angle-counting error that could consume following functions; this also has a passing regression test. This fixture was independently checked with the installed C++ compiler.
2. **P2 — CRLF continuations could introduce fake definitions.** A backslash followed by CRLF was not recognized as a continued comment/directive, so the next line could appear as a real function. Tokenization now supports both LF and CRLF continuations. Red/green regression test covers both comments and macros.
3. **P2 — Parenthesized return types could hide the actual name.** `API_TYPE(Value) make()` and `decltype(factory()) create()` now retain the actual function name and complete declaration range. The old regex sometimes labeled the return macro or `decltype` as the function. Red/green tests cover both forms.
4. **P2 — Call-operator definitions were omitted.** Added bounded handling for `operator()` and its parameter list; verified const-qualified bodies and subsequent methods. Unsupported conversion operators are no longer mislabeled as ordinary functions such as `bool`. Other overloaded/conversion-operator syntax remains outside this lightweight indexer's comprehensive support.

These fixes preserve the monotonic scan: template heads, parenthesized specifiers, signatures and bodies are advanced over rather than repeatedly searched with a whole-file regex.

## Comparison and validation

- A time-limited comparison checked 872 local Autoware C/C++ files against the baseline regex. The old expression exceeded its 30 ms per-file limit on 63 files; those are excluded from parity conclusions, not counted as successful comparisons.
- Initial comparison found differing names in 51 files. After fixing templates, 39 files still differed. Inspected representative match text across all remaining files: most differences were old false positives (`return std::visit(...)`, calls with lambdas, `if constexpr`, thread/variable constructors and condition expressions). Macro-return names and `decltype` were old mislabels; actual call-operator definitions prompted the additional fix above. The comparison is by name, not a compiler AST or proof of all overload/range parity.
- The final-source replay completed all 872 files in approximately 573 ms total parser time, finding 4,008 definitions; the slowest file took approximately 24 ms. This exercises local indexing only, not full AI analysis.
- Cross-engine review replay of route_manager.cpp: Chrome 5 ms, Electron 7 ms, system JavaScriptCore 36 ms; eight matches in each. Timings are single-run and influenced by concurrent build load. JavaScriptCore is the system shell, not a full Safari UI run. The original regex had timed out in Chrome/Electron on this same file.
- **150 tests passed in 10 suites**: C++ scanner, source-analysis component, Functional generation/model/hierarchy/performance, request recovery, source acquisition, storage cancellation, and run recovery. The scanner includes an externally timed child-process stress regression, and metadata/source URL integration checks.
- Production build passed with repository warnings. Its source map was checked to confirm the bundled scanner matches the final source exactly.
- Focused ESLint passes for the new scanner/tests; `git diff --check` passes.
- The source-index persistence path still writes the same key and record through `idbPut`, closes its database connection, and propagates storage errors. Fresh analysis passes the existing record; resume rebuilds when no record is supplied. This was reviewed in source and supported by existing recovery/cancellation tests; a full real-browser database migration was not exercised or required by this change.

## Remaining limitations and release boundary

This is a lexical index, not a full C++ compiler or preprocessor. Complex ambiguous template expressions, requires clauses, unusual declarators, macro expansion, non-call overloaded operators/conversions, conditional-compilation semantics, and local-class methods inside skipped function bodies are not comprehensively supported. Large inputs still need linear temporary memory and synchronous CPU time. No claim is made that all memory pressure or all prior error-code-5 events are resolved.

No paid AI calls, personal database mutations, user-session restarts, commits, pushes, or releases occurred. The full 928-file AI-backed workflow, installed Desktop package, updater, and long-duration end-to-end behavior still require testing. Installed Desktop will not contain these local changes until a shared commit is published and a new Desktop release is built.
