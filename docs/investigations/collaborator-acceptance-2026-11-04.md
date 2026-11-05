# Collaborator acceptance and greeting latency

Executed [remaining-work prompt](../prompts/collaborator-acceptance-2026-11-04.md), then the user's report that even “hey” takes minutes in every surface, with Haiku 5.5/medium selected. The user explicitly required model-independent behavior. Executed the [greeting-latency prompt](../prompts/collaborator-greeting-latency-2026-11-04.md) as part of the same work.

## Concrete defect found and fixed

Ordinary questions unconditionally called `buildWorkspaceLLMContext` before deciding whether scoped read tools were necessary. That call waits for source migration/indexing. A plain greeting therefore waited for unrelated workspace indexing even though its answer needed no saved records. The larger synthetic workload demonstrated why this could amount to minutes.

The shared conversation route now recognizes a deliberately narrow set of unmistakable greetings/thanks. Those turns skip graph preparation, read planning/execution, legacy workspace merging and workspace prompt hydration. A small social-message context explicitly says workspace facts were not loaded; it must not imply an empty workspace. Ordinary chat history is retained. Attachments, engineering questions, decisions, review prompts and ambiguous follow-ups keep their established routes. Selected provider/model/effort are preserved. There is no model or provider check in the routing rule.

This removes a demonstrated local wait. It does not guarantee a real provider's speed. No paid provider calls were made.

## Reproduction and whole-App validation

The acceptance driver serves the actual optimized production App, creates disposable synthetic projects/report storage, blocks external requests, and supplies deterministic local provider responses. It does not patch the measured App bundle or read installed profiles.

The greeting regression holds the workspace mutation Web Lock for 3.5 seconds, changes a source snapshot, then submits `hey` through the actual composer. The old build took 3,938 ms and failed the assertion that the greeting completed before that lock was released. The rebuilt App passed that assertion in both Chrome and Electron. Initial observations were 573 ms in Chrome and 587 ms in Electron with a controlled 350 ms mocked provider response. A later Chrome run under concurrent startup load took 3,084 ms while still completing before lock release; these are individual observations rather than latency guarantees or real-model benchmarks.

The complete journey also validates:

- a requirements-count question sends complete count evidence and one answer request;
- selected model and effort reach each request;
- automatic naming waits until answer generation finishes;
- a source citation opens the exact retained report;
- Stop during thread switching does not write the response into the newly selected thread;
- that new thread can answer another question;
- saved report bodies survive full reload;
- confirmed whole-report deletion persists after reload.

Fixture setup exposed races in the test driver (seeding after App mount, debugging-port readiness, asynchronous library metadata and reload execution contexts). The driver was corrected; these are not recorded as product defects. Tests use a temporary blank setup document before loading the production App. No private desktop source was modified.

Reproduce:

```sh
node scripts/diagnostics/collaborator-acceptance/full-app.cjs chrome
XHANDLE_ACCEPTANCE_PROVIDER=anthropic XHANDLE_ACCEPTANCE_MODEL=claude-haiku-5-5 XHANDLE_ACCEPTANCE_EFFORT=medium node scripts/diagnostics/collaborator-acceptance/full-app.cjs electron
```

These environment variables select synthetic preferences only inside the disposable fixture. They do not change the user's preferences or invoke the named provider. The server adapter regressions separately cover OpenAI, Claude and Gemini streaming and the Haiku 5.5/medium payload.

## Larger native workload

Actual IndexedDB and workers, local Apple M2 with 8 GiB RAM:

- 5,500 source records with 629,248,390 ASCII content bytes (approximately 600 MiB);
- 27,125 current hazard rows and two historical runs of 5,000 rows each;
- 5,500 software requirements;
- current/history count isolation and a deep excerpt from the final source file.

| Observation | Electron | Chrome |
| --- | ---: | ---: |
| Cold indexing | 191.8 s | 236.1 s |
| Current hazard count | 1.54 s | 1.53 s |
| History-inclusive hazard count | 1.41 s | 1.34 s |
| Exact deep source read | 11 ms | 13 ms |
| Warm context preparation, five samples | 348–383 ms | 344–401 ms |
| Sampled main-window JS heap peak | 66.2 MiB | 60.3 MiB |
| Largest observed 50 ms heartbeat interval | 52.2 ms | 97.6 ms |

Both workloads passed all expected counts and final-file evidence checks, with no renderer crash. The values above include fixture seeding for heap/timer observations; they are not formal frame-time or leak measurements. The Chrome run overlapped some independent regression activity, so timing differences cannot be attributed solely to runtime.

A second Electron run captured whole-process working sets every 250 ms, including worker memory within the renderer process. Observed per-process peaks were approximately 320.9 MiB for the renderer, 266.9 MiB for the main/browser process, 59.7 MiB for GPU and 42.1 MiB for network utility. Individual peaks may occur at different times and must not be summed as a measured simultaneous total. That run indexed in 206.6 s and also passed.

Synthetic content compresses in IndexedDB; measured storage usage was roughly 285–302 MB. This is not equivalent to the customer's 634 MB archive, potentially much larger uncompressed historical payloads, concurrent live derivations, a packaged application's full native overhead, or a 16 GiB M4 machine. The tests expose a remaining cold-index performance cost rather than establishing a capacity ceiling. A greeting now bypasses that cost; a data question needing a first index still has to await preparation.

Reproduce:

```sh
node scripts/diagnostics/collaborator-acceptance/large.cjs chrome
node scripts/diagnostics/collaborator-acceptance/large.cjs electron /path/to/Electron
```

Each runner prints its evidence directory. External requests are blocked. Profiles contain synthetic data only.

## Regression and release review

- Final combined Reports/Collaborator/graph/archive/backup/cleanup run: 414 passed across 35 suites; one existing optional 520 MiB checksum test remains skipped. An earlier run exposed a cancellation integration test exceeding Jest's five-second default under concurrent stress. Its persistence/retry workload is not a latency benchmark: its deadline is now 30 seconds. The follow-up and the final combined run both passed; no production timeout was relaxed.
- After the greeting change: 129 focused tests passed across six suites, including greeting classification, attachment/decision exclusions, small context formatting, transport, scoped reads, current component helpers and thread naming.
- Desktop shared-boundary tests against the pending public source: 39 passed across nine suites.
- Unchanged private desktop shell host tests: 44 passed.
- Shared server/provider/startup regressions: 44 passed.
- Actual installed Markdown parser/report rendering checks: 21 passed.
- Optimized production build passed with existing warnings. Focused lint has no errors and retains the two existing Collaborator warnings. Whitespace checks passed.

No additional production data-loss or project/thread contamination defect was reproduced in this tested set. This is not a zero-regression guarantee. The new greeting route is exercised in the production App rather than only by a classifier unit test.

## Concrete remaining gates

| Gate | Status / action |
| --- | --- |
| Model-independent greeting no longer waits on indexing | Local implementation and controlled browser/Desktop validation complete. |
| Large source/hazard/history module capacity | Synthetic 8 GiB checks complete; cold indexing remains roughly 3–4 minutes on this fixture. |
| Grounded read, source navigation, Stop/thread isolation, report persistence | Deterministic full-App checks and focused regressions complete within the fixture scope. |
| Real-provider quality and response latency | Not executed. Fixed question/scoring set is in `scripts/diagnostics/collaborator-acceptance/questions.json`; needs an approved provider/request or spend budget. Mock responses cannot satisfy this gate. |
| Customer archive, full live analysis concurrency, 16 GiB hardware | Not available in this isolated test environment; must be exercised on representative hardware/data. |
| Every import/restore path through the complete UI | Storage-level backup/archive/edit/delete regressions passed; the full UI fixture does not exercise every import/restore interaction. |
| Shared source release provenance | Public working tree still contains pending changes. Commit/review/publish shared changes first, then update the desktop submodule pin. The current desktop pin is `8e124122ddd926b9f62429725e516d1ef37a4c55`, which excludes these uncommitted changes. |
| Packaged smoke, signed artifact, upgrade and updater feed | Not executed for a new release; no new package exists. Run after the reviewed source pin/version/build are concrete. Keep stable app ID/origin/data paths and use a disposable installation/profile for upgrade testing. |
| Publication | Not authorized by this acceptance task and not performed. The distributed 0.2.14 app is unchanged. |

Primary evidence logs: `/private/tmp/xhandle-acceptance-{regressions,cancellation-followup,shared-boundary,desktop-host,server,report-parser,large-electron,large-chrome,large-electron-memory}.log`, plus `/private/tmp/xhandle-acceptance-greeting-{before,tests,final-tests,build,lint,chrome-after,electron-after}.log`. Final sequential full-App results are recorded in the accompanying completion note below.

The clean final 35-suite run is `/private/tmp/xhandle-acceptance-final-regressions.log`.

### Final full-App completion

The complete journey, including confirmed deletion/reload, passed with no recorded runtime errors for OpenAI/high in Chrome, Haiku 5.5/medium in Electron, and Gemini/medium in Chrome, all using deterministic local mocks. Sequential final greeting observations were 575 ms for the Haiku-selected Electron fixture and 566 ms for the Gemini-selected Chrome fixture, both before the 3.5-second index lock was released. Data questions continued to carry complete count evidence. Logs: `/private/tmp/xhandle-acceptance-greeting-electron-final.log` and `/private/tmp/xhandle-acceptance-greeting-gemini-final.log`; OpenAI completion is in `...greeting-chrome-after.log`.

The optimized build contains the greeting runtime fix. The subsequent edit to a component regression test adds a guard against touching legacy workspace bodies on that route; it does not change runtime source.
