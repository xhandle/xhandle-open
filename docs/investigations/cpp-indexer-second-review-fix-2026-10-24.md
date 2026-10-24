# Second-review corrections

Executed prompt: `docs/codex-prompts/fix-cpp-indexer-second-review.md`.

Both confirmed second-review fixtures now pass:

- Template defaults with identifier comparisons recover at declaration boundaries, using a candidate closing `>` rather than scanning unrelated bodies or the rest of the file. Coverage includes comparisons between identifiers, multiple comparisons, prototypes, templated return types, class/member templates, and default lambdas. Recovery remains lexical and conservative; this is not a full C++ grammar.
- Recognized function bodies are traversed with executable-scope markers. Ordinary expression parentheses are skipped using precomputed pairs; block/class braces are visited so local-class methods and constructors can be indexed. Nested methods receive their own complete source ranges without promoting ordinary calls to definitions. Bodies are not recursively rescanned from scratch.

Validation:

- Standalone `cpp-indexer-second-review-check.cjs`: both cases pass (previously exit 1).
- 155 tests pass in 10 focused suites, including five new tests for the corrections and adjacent cases, plus acquisition/storage cancellation/recovery/model tests.
- Focused scanner/test ESLint and `git diff --check` pass.
- Final-source replay: route_manager.cpp returns eight definitions in Chrome (6 ms) and Electron (4 ms). System JavaScriptCore also passed earlier in this change (21 ms). Single-run timings, not guarantees or a full Safari UI test.
- Final-source local corpus replay: 872 C/C++ files, 4,008 definitions, approximately 809 ms total parser time while the production build was running. No stalls.

Remaining scope: complex C++ grammar/preprocessing and local-class declarations hidden inside skipped expression/argument subtrees are not comprehensively supported. The full paid AI analysis, installed desktop package, and updater were not run. No user storage, AI prompt behavior, concurrency limits, persistence format, or desktop release configuration changed. No commit/push/release was performed.

Production build passed with repository warnings. The generated source map was verified to contain the exact final scanner source.
