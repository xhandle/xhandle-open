# Cumulative release readiness — November 5, 2026

Subsequent layout adjustment: the user requested document-panel-only scrolling
in sidebar Reports. That change passed the targeted report tests and isolated
Electron layout checks in [report-scrolling-2026-11-05.md](report-scrolling-2026-11-05.md).
The cumulative build/journeys below preceded that CSS/JSX adjustment; the final
production artifact still requires the release checks listed below.

Reviewed the pending shared changes on `8e12412` and the clean desktop checkout
on `968f4b4` (version 0.2.14). The source is ready for commit and production
release preparation. No new blocking product defect was identified. This is
not verification of a signed release artifact or an actual native upgrade.
No commit, push, desktop source-pin update, or publication occurred.

The review covered report generation/library/diagrams/scrolling, Collaborator
context routing and streaming, scoped graph indexing and cleanup, navigation
storage lifetimes, hazard options/filtering/counts/virtualization, archive
compatibility, and downstream derivation memory/persistence. The bounded
viewport, outline, option-index and artifact caches remain in place. Explicit
retrieval can still incur cold reads, legacy projection repair, or reconciliation
costs; these changes do not promise that every workload opens instantly.

## Newly executed validation

- 2,321 distinct shared tests passed across 241 suites. Two optional tests were
  skipped: the supplied-archive benchmark and the opt-in 520 MiB parser check.
  The first run had two stale assertions expecting counts without thousands
  separators. They were updated to the existing displayed text; the affected
  two suites then passed all 13 tests. No runtime code changed during this review.
- 69 server and installed-Markdown rendering tests passed, including the real
  chat route with mock streaming responses for all three provider adapters.
- All 44 native desktop tests passed.
- A fresh optimized production renderer build passed with existing repository
  lint/Browserslist warnings. Whitespace validation passed.
- The fresh build passed 15 context-routing scenarios in Chrome and 15 in
  Electron, including direct questions under a deliberately held storage lock,
  scoped technical retrieval, exact-count evidence, and pasted project overviews.
- The fresh build passed the full App journey in both Chrome and Electron:
  direct conversation, saved report lookup, count evidence, delayed automatic
  titles, source navigation, cancellation across thread switches, report reopening
  after reload, and confirmed report deletion surviving reload. No recorded
  renderer exceptions occurred. Profiles and data were disposable; providers
  were local mocks and external requests were blocked.

The first server attempt was denied loopback listeners by the sandbox; all
checks passed with local listeners enabled. An initial Electron routing fixture
selected a model whose configured capabilities omit reasoning effort while its
assertion expected the header. Repeating with the previously validated supported
model fixture passed; no product change was required. Mock settings propagation
does not establish current external-provider capabilities or live answer quality.

## Large-data evidence

The current runtime code also has the earlier same-day isolated Electron
26,278-row hazard / 4,000-artifact contention test, downstream derivation memory
comparison, aged-profile navigation/rapid-scroll validation, and six report-layout
checks. Those results are documented in the corresponding investigation reports;
they were not remeasured in this cumulative review. This review does not prove
crash freedom for Offer's workload or long-running sessions.

## Remaining release steps

1. Commit and publish the shared source, review/update the private desktop
   submodule pin, choose a version newer than the published feed, and commit the
   desktop release metadata. Keep exact source provenance and license notices.
2. Build/sign/notarize the production macOS artifacts and run full and packaged
   smoke checks against those exact artifacts. Include destination-platform
   validation for any additional platform actually being released.
3. Verify the real update from 0.2.14 using a disposable installation/profile,
   including saved-project persistence. Publish the complete verified asset set
   and updater manifest, then verify the public feed.

Compact results: [cumulative-release-readiness-2026-11-05.json](cumulative-release-readiness-2026-11-05.json).
Detailed logs use `/private/tmp/cumulative-release-review-*.log`; the optimized
renderer is `/private/tmp/xhandle-cumulative-release-review-build`. The source
fingerprint and exact shared test list are retained in the same temporary prefix.
