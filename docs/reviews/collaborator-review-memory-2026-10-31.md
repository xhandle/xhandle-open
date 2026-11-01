The main workspace now runs the ResultsReviewProvider in Collaborator mode. It does not preload the historical review collection, render the retired review drawer, or register generated table rows as Review Center items. The Review Center navigation/settings entry and row badges are disabled in this mode. Existing standalone read-only review packages retain the legacy provider for compatibility.

Collaborator prompt-based review remains active. Its source-table actions, decision engines, session persistence, resume and undo paths are preserved. Evidence is saved using a targeted IndexedDB read-modify-write transaction. A first decision can copy matching legacy evidence into the stable Collaborator record while leaving the differently keyed historical record untouched; subsequent decisions update only that record. Persistence errors are surfaced instead of being treated as successful saves.

Project hazard regeneration loads only the current project's decision bases. The small workspace cache excludes histories, original snapshots and session ledgers, retains the row and reviewer rationale needed for regeneration, handles project-switch races, and refreshes after explicit import/reset/undo. Regeneration reads fresh evidence before proceeding and stops if it cannot be loaded. Exports and historical recovery explicitly read stored evidence rather than exporting the provider's intentionally empty in-memory collection. No database schema upgrade, bulk deletion or destructive migration was added.

Validation includes 432 targeted tests across 34 suites, including the new storage/provider/cache regressions and existing Collaborator intent, decision engine, resume, undo, regeneration, table, archive and recovery coverage. New cases check concurrent writes, transaction rollback, failed writes and retry, history preservation, no startup database access with 15,000 artifact rows, stable context during successful evidence writes, standalone-package compatibility, project-switch races, invalidation, and session-ledger exclusion. The production build succeeds with existing repository lint warnings; `git diff --check` passes.

The production diagnostic is `scripts/diagnostics/verify-collaborator-review-memory.cjs`. It runs the actual app with disposable profiles and fixture-only network responses. It seeds 15,000 rows in each of the four requirements/design collections, 15,000 hazard rows, a 100-node architecture diagram, and 5,000 inactive historical review records with 16,384-character original payloads. It cycles the tables, traceability, hazards and diagram three times; scrolls tables with wheel input and scrollbar jumps; verifies virtualized row bounds; and edits a requirement before reloading the application. It checks historical record count plus first/last history sentinels and captures runtime errors.

Measurements use an Apple M2 with 8 GiB RAM. Retained JavaScript heap is sampled after explicit CDP garbage collection at equivalent milestones. It is not total application memory and excludes separate workers, GPU and native allocations. Sampled peaks are diagnostic observations, not a guaranteed memory ceiling. The baseline is the production build of `ff30b61` in `/tmp/xhandle-cba-review-ready-build`; the final build is `/tmp/xhandle-review-retired-final-build`.

The final Chrome and Electron runs passed with no page errors. Both preserved the requirement edit after reload, kept all 5,000 historical records with unchanged first/last history sentinels, and showed neither the retired navigation nor drawer. Chrome was 156.0.8078.79; Electron was 45.0.0 (Chromium 156.0.8078.48).

| Measurement | Baseline Chrome | Final Chrome | Final Electron |
| --- | ---: | ---: | ---: |
| Review collection `getAll` calls at startup | 1 | 0 | 0 |
| Review writes across three navigation cycles | 65,000 | 0 | 0 |
| Stored review records after reload | 65,000 | 5,000 | 5,000 |
| Retained heap after third cycle, MiB | 397.6 | 207.7 | 207.6 |
| Runtime page errors | 0 | 0 | 0 |

The matched Chrome run reduced retained heap after the third cycle by about 48%. The baseline's 65,000 writes include the 5,000 seeded records plus 60,000 automatically registered artifact reviews. The final app did not read or write the review store during the measured CBA navigation; the diagnostic's explicit history checks occur afterward. Both final runs used build manifest SHA-256 `78d8635246668cfa99ec336c91f779ee4c196a732cc560d864df5ecc3e41c117`. JSON reports and screenshots are under `/tmp/xhandle-review-memory-final-{chrome,electron}.json` and `.json.png`.

Reproduction commands (the existing fixture seeder and local Playwright/Electron installations are required):

```sh
node scripts/diagnostics/verify-collaborator-review-memory.cjs --build /tmp/xhandle-cba-review-ready-build --out /tmp/xhandle-review-memory-baseline-chrome.json --browser chrome --rows 15000 --artifacts 15000 --nodes 100 --verify 1 --baseline 1
node scripts/diagnostics/verify-collaborator-review-memory.cjs --build /tmp/xhandle-review-retired-final-build --out /tmp/xhandle-review-memory-final-chrome.json --browser chrome --rows 15000 --artifacts 15000 --nodes 100 --verify 1
node scripts/diagnostics/verify-collaborator-review-memory.cjs --build /tmp/xhandle-review-retired-final-build --out /tmp/xhandle-review-memory-final-electron.json --rows 15000 --artifacts 15000 --nodes 100 --verify 1
```

This verifies the shared production UI in Chrome and a disposable Electron shell, not the installed desktop updater/package. It does not reproduce the customer's 634 MB archive or call a live AI provider. Collaborator prompt routing and decision behavior are covered by the targeted automated suites; an end-to-end live-provider review with the customer's data remains a useful acceptance check. Explicit exports/recovery and active review sessions can still require substantial memory proportional to their requested data. This change removes the identified obsolete review overhead; it does not establish that every possible crash or memory limit is eliminated. Nothing was committed, pushed, packaged, installed or released during this task.
