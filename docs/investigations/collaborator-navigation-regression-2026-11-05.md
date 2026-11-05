# Project navigation regression — 2026-11-05

The App mounted a global Collaborator indexing scheduler even when the user had not asked a question. Every 1.5 seconds it scheduled another source domain; source-change notifications restarted the sequence. These passes scanned across projects and could compete with project loading, diagrams and tables for IndexedDB, CPU and memory.

## Change

- Removed the startup/background scheduler. Governed Collaborator reads and explicit edits retain their on-demand indexing paths.
- Kept lightweight source-change tracking at App startup. Edits/imports before the first question still mark persisted index checkpoints stale, without reading source bodies or opening databases.
- Added a native navigation regression mode to the existing acceptance harness and a focused source-tracking test.

## Verification

The previous optimized build failed the new navigation invariant. It launched 2 indexing passes by startup sampling, 4 after opening an ordinary project, 6 after opening a code architecture project, 8 after returning, and 10 after a source-change event. Those passes had no project scope.

The updated production build launched **zero** indexing passes across all five stages in both Electron and Chrome. Both runs confirmed source changes were still tracked, no AI requests were made while browsing, and no runtime exceptions occurred.

The existing 15-case Collaborator journey passed in both runtimes with a local mocked provider. It covers general questions, project overviews, technical evidence, exact counts, scope isolation, saved reports and cancellation/queue behavior. These runs start with disposable synthetic profiles, so they also exercise retrieval without a prewarmed background index.

Relevant regression tests: 249 tests in 11 suites passed; the new tracking test and two overlapping indexing suites passed (27 tests). This is 250 distinct tests across 12 suites. Production build succeeded with existing lint/Browserslist warnings; `git diff --check` passed.

Reproduce navigation check:

```sh
XHANDLE_NAVIGATION_ONLY=1 node scripts/diagnostics/collaborator-acceptance/context-on-demand.cjs electron /absolute/path/to/build
XHANDLE_NAVIGATION_ONLY=1 node scripts/diagnostics/collaborator-acceptance/context-on-demand.cjs chrome /absolute/path/to/build
```

Omit `XHANDLE_NAVIGATION_ONLY` for the Collaborator acceptance journey. Compact results are in `collaborator-navigation-regression-2026-11-05.json`.

## Limits and follow-up

This demonstrates removal of unsolicited indexing during navigation; it does not quantify load-time improvement on the customer's largest projects. An existing preview diagnostic also recorded a slow projection-repair phase during an explicit question. That is a separate remaining retrieval-performance concern, not evidence that all project-loading costs are resolved. No live provider calls were made for these checks.

The idle local Electron preview was reopened as `0.2.14-preview.20261105.6` using the existing preview profile and the fixed build. No desktop update was published.
