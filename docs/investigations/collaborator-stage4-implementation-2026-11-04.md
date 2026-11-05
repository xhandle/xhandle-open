# Collaborator Stage 4: response delivery and latency attribution

The remaining implementation stage was Stage 4 of the coverage/latency audit. Stages 1–3 already had local implementations for coverage/correctness, incremental worker indexing, and scoped read tools. This change implements Stage 4 locally. Customer-scale acceptance and release work remain.

Executed prompt: [Stage 4 task](../prompts/collaborator-stage4-2026-11-04.md).

## Changes

- Ordinary answers now carry a random trace ID through context preparation, read-policy resolution, optional model planning, read execution, prompt formatting and provider requests. Renderer traces correlate response headers, provider timing metadata, first text, displayed-content callbacks and completion. Server timings distinguish configuration/preparation offset, provider first text and completion. A displayed-content callback is a proxy for visible output, not a browser-paint measurement.
- Gemini now uses incremental `streamGenerateContent?alt=sse`. The existing request payload builder, model resolution and effort settings remain in use. Visible text is forwarded incrementally; thought parts are excluded. The protocol is documented in Google's [REST streaming example](https://raw.githubusercontent.com/google-gemini/cookbook/main/quickstarts/rest/Streaming_REST.ipynb).
- Streaming requests flush a connected event immediately and use lightweight waiting comments while the provider is silent. Existing Collaborator progress shows waiting/receiving stages. OpenAI and Claude retain their adapters. All three return correlated numeric timing summaries at completion, including in production where info logging is disabled.
- The shared client transport handles split UTF-8, multiline SSE, cancellation, deadlines, explicit provider failures, malformed data, empty answers, incomplete streams and bounded output. A JSON compatibility response is consumed once; an HTTP error never silently triggers a second provider request. Existing provider compatibility retries remain limited to their recognized unsupported-parameter cases. OpenAI EOF without a completion reason is now an error, consistent with the other adapters.
- Complete read results can reuse a renderer-local revision cache: at most four entries and 200,000 estimated bytes including keys, with a 30-second TTL. Exact source snapshots and the durable graph mutation revision invalidate it. Incomplete and oversized results are excluded. Returned results are cloned so caller modifications cannot poison later reads. Supported save/import/delete writers retain their freshness contracts.
- Thread naming waits until answer generation is idle, then starts after a short delay. New work cancels scheduled/active title generation; late titles cannot overwrite manually renamed/deleted threads. The title request uses current provider preferences rather than a hardcoded model.

No model/effort preference, table navigation, diagram interaction, review-prompt behavior or mutation/undo contract was intentionally changed. Retired review UI remains retired.

## Memory and privacy

Performance traces retain the latest 30 completed operations in renderer memory, with at most eight request summaries each. Fields are allowlisted: durations, counts, workflow, provider/model/effort and random correlation IDs. Prompts, responses, project/record identities, paths, credentials and raw provider errors are excluded. The exported `getCollaboratorPerformanceReports()` helper is available to development/test code; this change does not add a performance export control to Help. These timings do not create warnings/fatal diagnostic entries.

The read-result cache intentionally contains bounded excerpts/citations in local memory, as ordinary prompt preparation already does. It is not persisted. Its entry-byte limit excludes the source snapshot used to check freshness; that snapshot follows the existing localStorage/indexing design. No workspace body cache or unbounded history was added.

## Native measurements

Actual IndexedDB, Web Workers and native ReadableStreams in disposable Electron 45 and headless Chrome 156 on the local M2/8 GiB Mac. Synthetic records only; native harnesses block external requests. The retained Stage 3 fixture validates scope, citations, late-field search, grouping and warm retrieval. Stage 4 adds streaming, cancellation, repeated reads and mutation invalidation.

| Stage 4 check | Electron | Chrome |
| --- | ---: | ---: |
| Uncached count, 27,125 records | 642 ms | 550 ms |
| Identical count, valid cache | 1.3 ms | 0.8 ms |
| Count after inserting a record | 583 ms; 27,126 records | 549 ms; 27,126 records |
| First text with a synthetic 30 ms provider delay | 37 ms | 36 ms |
| Completion with a synthetic 150 ms provider delay | 159 ms | 157 ms |

Both runtimes made one answer request, exposed matching numeric server timing, preserved UTF-8, canceled an active pending stream without late tokens, and excluded the synthetic question from telemetry. Warm context preparation at 27,125 artifacts had p95 115.5 ms in Electron and 146.8 ms in Chrome over 30 samples per runtime, with zero full artifact-body reads during ordinary sampled retrieval.

These are module-level native checks, not full-window user-interaction measurements. Count/cache/stream values are individual observations, not latency percentiles. Provider delays are controlled synthetic timers and do not predict real model latency or answer quality.

The production Express route was also exercised with isolated mocked provider adapters, a temporary working directory/database, synthetic keys and an outbound-request guard. First text arrived before completion for Gemini, Claude and OpenAI; model/effort headers were preserved, request IDs correlated, thought text was excluded, truncated streams failed and client cancellation reached the upstream signal. Real provider traffic and customer credentials were not used.

## Verification

- Broad frontend regression run: 346 passing tests across 30 suites; one existing opt-in 520 MiB checksum parser test skipped. After the final cache-budget test and planner-failure timing adjustment, all 19 affected tests passed across three suites. Together these cover 347 distinct passing frontend tests.
- Server regression run: 44 passing tests, including the actual production route, provider payloads/compatibility, transport errors, stream parsing, metrics and development startup.
- Native Electron and Chrome checks passed.
- Focused lint has no errors. Existing Collaborator unused-import/effect-dependency warnings remain.
- Optimized production build passed with existing application warnings; no compile errors.
- `git diff --check` passed.

Reproduce native checks:

```sh
node scripts/diagnostics/collaborator-stage4/run.cjs chrome
node scripts/diagnostics/collaborator-stage4/run.cjs electron /path/to/Electron
node --test server/collaboratorStreaming.integration.test.js
```

Evidence logs are in `/private/tmp/xhandle-stage4-{electron,chrome,regression,followup,server-final,lint-final,build}.log`. Each native runner also prints its disposable fixture directory. Tests/builds were run with bounded Node heaps; the optimized build ran after the native fixtures and larger frontend suite.

## Remaining acceptance work

Follow-up: [acceptance testing and the model-independent greeting fix](collaborator-acceptance-2026-11-04.md) now provide full-App and larger native workload evidence. That work found and removed a greeting's unnecessary wait for workspace indexing; its report records the live-provider/hardware/release gates still outstanding.

The four planned implementation stages now have local code and regression coverage. This does not establish best-in-class quality or complete access to every possible capability/schema.

1. Test the full application against representative large workspaces: roughly 634 MB, 5,500 source files, requirements, hazards and multiple historical runs. Measure peak renderer/main/worker memory and UI responsiveness during concurrent analysis on 8 GiB and 16 GiB machines.
2. With explicit authorization for paid requests, evaluate a fixed question set against the selected providers/models: correctness, evidence coverage, source-link navigation, ambiguity, first useful answer and completion. Synthetic provider tests verify delivery and failure handling, not generated-answer accuracy or real network/provider latency.
3. Exercise rapid project/thread changes, Stop/follow-up behavior, imports/restores/deletions and title cancellation in the complete browser/Desktop UI. Existing targeted regressions pass, but module-level native fixtures do not replace this acceptance.
4. Review the combined pending Reports and Collaborator changes and follow the normal desktop release/upgrade checks before publishing.

Stage 3 limitations still apply: bounded excerpts/pages, no numeric sum operator, complete-run semantic diffs, vector retrieval or persisted multi-turn paging cursors. Unknown ownership, missing schemas, oversized legacy records, partial indexing and exhausted budgets remain explicit limitations. Raw database writes that bypass the supported revision/event contracts cannot be treated as supported writers. Legacy action/repair paths outside ordinary answer/read/functional generation are not all correlated by the new trace.

Nothing was committed, pushed, packaged or published by this task.
