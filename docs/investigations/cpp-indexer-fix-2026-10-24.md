# C++ source-indexer stall fix

Implementation prompt: `docs/codex-prompts/fix-cpp-source-indexer-stall.md`.

Replaced the whole-file ambiguous signature regex with `cppSourceFunctions.js`: one lexical pass records line numbers and excludes comments, directives and quoted/raw-string contents; one delimiter pass pairs parentheses/brackets/braces; the declaration scan advances past inspected signatures and function bodies. This removes the exponential backtracking path and repeated line-prefix/brace scans from C++ indexing. It handles multiline signatures, templates, constructors with parenthesized or braced initializers, destructors, const/ref/noexcept qualifiers and trailing return types. C++ numeric separators are distinguished from character literals.

`buildSourceFileIndexRecord` still constructs the same provenance, source URLs and record shape. Its C++ range adapter calls the scanner. `indexSourceFileToIDB` now accepts the already-built record on the normal analysis path, avoiding a second parse; resume still builds a fresh record when needed. Storage errors continue through the existing fatal error path. No worker scheduling, AI prompt policy, concurrency settings or user storage was changed.

## Verification

- 99 tests passed across the scanner, source-analysis component, Functional model and Functional performance suites. Tests include metadata/source URLs, precise line ranges, constructor initializers, raw strings/comments, numeric separators, incomplete input, 2,000 arguments and long nonmatching input. A separate child process checks 4,000 constructor arguments under a five-second deadline.
- Local replay: 872 Autoware C/C++ files indexed without stalling; 3,895 definitions found, approximately 390 ms total scanner time, slowest file approximately 13.5 ms. This is a local parser replay, not the AI-backed 928-file workflow.
- Actual `route_manager.cpp`: eight definitions with correct inspected ranges, including both ref-qualified methods and the constructor. Old regex found five in JavaScriptCore and timed out in Chrome/Electron.
- Isolated engine measurements on this Mac (single-run timings, not stable benchmark thresholds):

| Input | Chrome | Electron | System JavaScriptCore |
| --- | ---: | ---: | ---: |
| route_manager.cpp, 13,438 characters | 4 ms | 1 ms | 14 ms |
| Constructor with 2,000 arguments, 50,927 characters | 19 ms | 8 ms | 25 ms |

The engine tests use temporary profiles, no existing application databases or paid AI calls. The script now defaults to the new scanner; `--legacy` loads the original regex from commit `68c856b` to reproduce the historical problem. The original review's reproduction commands require that flag to obtain old-code behavior.

## Scope and limitations

This remains a lightweight lexical index, not a full C++ parser/preprocessor. Macro-generated declarations, overloaded operators, complicated declarators (including function-pointer returns), some decltype/requires forms, and preprocessor branch semantics are not comprehensively supported. Tests do not establish complete C++ language coverage. Function ranges now start at the first declaration token, without leading blank lines.

Scanning is synchronous with linear auxiliary storage; very large files can still cause a bounded CPU pause or consume substantial memory. This eliminates the demonstrated backtracking stall, not every possible renderer freeze or memory issue. The full paid analysis workflow and packaged desktop update/install were not exercised. Desktop must consume a published shared commit and receive a new build before installed users get the fix.

No commit, push, or release was performed.

Final checks: production build completed successfully with repository lint warnings; focused ESLint on the new scanner and its tests passed with no warnings. The final scanner unit suite passed again after lint cleanup. Additional local Node scaling check: 1,000 arguments / 18,921 chars: 5 ms; 10,000 / 198,921 chars: 29 ms; 100,000 / 2,088,921 chars: 164 ms, each producing one function. These are single-run observations, not performance guarantees.
