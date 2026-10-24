# Second implementation review — historical findings

Update: both fixtures are now corrected; see `cpp-indexer-second-review-fix-2026-10-24.md`. The findings below describe the reviewed pre-fix state.

Prompt: `docs/codex-prompts/review-cpp-source-indexer-second-pass.md`.

Verdict: the demonstrated regex freeze is fixed, but the current implementation should not receive a clean regression review. Two compiler-valid cases demonstrate lost definitions relative to baseline commit `68c856b`. This pass changes only review artifacts, not production code.

## P1: Template expression can hide the rest of a file

Location: `src/features/code-architecture-context/cppSourceFunctions.js:77–92`.

```cpp
constexpr int limit = 3;
template<bool B = limit < 5>
void work() {}
void after() {}
```

Expected/baseline names: `work`, `after`. Current result: no definitions.

The special case only distinguishes numeric tokens before `<`. After an identifier, the relational operator increases template depth. The real closing `>` leaves depth nonzero, and the scan consumes the function bodies and remaining file. This is broader than merely failing to understand the templated function: unrelated later evidence disappears.

Recommended correction: distinguish expression operators from template delimiters in supported template heads and add bounded declaration-boundary recovery so an uncertain head cannot swallow subsequent definitions. Preserve the non-backtracking design and test identifier-based expressions as well as literals.

## P2: Local-class methods are dropped

Location: `src/features/code-architecture-context/cppSourceFunctions.js:143–147`.

```cpp
void outer() {
  struct Local {
    void run() {}
  };
}
void after() {}
```

Expected/baseline names: `outer`, `run`, `after`. Current names: `outer`, `after`.

Advancing directly to the outer function's closing brace skips declarations inside it. Local classes and their methods are valid C++. The earlier report listed this as a scope limitation; this pass confirms that the baseline actually indexed the method, so it is a compatibility regression.

Recommended correction: retain a bounded traversal of declaration scopes within bodies, distinguishing local-class methods from ordinary calls/lambdas. Reuse paired delimiters; do not restore the whole-file regex or repeated body scans.

## Evidence and checks

- Both fixtures passed installed `clang++ -x c++ -std=c++17 -fsyntax-only -` (exit 0).
- The original expression from commit `68c856b`, run in a timeout-bounded VM, finds the expected names in both cases.
- `node docs/investigations/cpp-indexer-second-review-check.cjs` reproduces both current failures and deliberately exits 1. It is a standalone diagnostic, not a passing regression test; no personal data is needed.
- Existing focused tests: 150 pass in 10 suites. These passing tests did not cover the newly discovered cases and do not override the failing diagnostic.
- Repeated actual route_manager.cpp probe: Chrome 4 ms, Electron 1 ms, eight definitions each. The original catastrophic-backtracking case remains fixed.
- Existing successful production build's source map matches the current scanner source exactly. No rebuild was necessary because production source was unchanged during this pass.
- Storage paths, record reuse, provenance and error propagation remain unchanged from the first review. No new defect was identified there; this is not a real-browser database migration test.

The full AI-backed 928-file workflow and installed Desktop release remain untested end to end. No commit, push, release, personal data change or user-session restart was performed. Resolve the findings and promote these fixtures into regression coverage before publishing this scanner change.
