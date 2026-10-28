# Hazard review save-failure recovery — 2026-10-28

Executed `docs/codex-prompts/fix-review-save-failure-recovery.md`.

## Implementation

- Code-architecture hazard review edits persist a pending operation in the review record before changing source data. This includes the intended content/action and one approval-history entry, while retaining the previous finalized review content and original audit snapshot.
- A source publication stores an operation receipt with the row change. Recovery checks that receipt and the committed row, so a source-applied/review-not-finalized operation can finish without publishing the source twice. Receipts retain the latest operation per review item.
- Review preparation/finalization requires a successful IndexedDB write. Failed or thrown writes reject the action and restore that operation's optimistic replacements where they have not been superseded. An existing pending operation is confirmed durable again before retry, including after reopening.
- Source recovery can explicitly read committed data instead of the retained unsaved proposal. Ordinary edits retain the prior resolver path to avoid an unnecessary full reread. Unrelated pending hazard saves remain protected. Exact row matching, project/run checks and atomic source revision checks remain in force.
- The drawer displays an unfinished-save notice and a dedicated “Retry review save” action after failure or reload. Further edits are disabled while that operation remains pending. Errors do not advance approval, and successful retries finalize history only once. Review normalization preserves the pending operation.

The protocol is scoped to code-architecture hazard source edits and their pending recovery. It does not change table first-view loading or analysis scheduling.

## Verification

- Broad hazard-analysis, transfer, Results Review, collaborator, functional decomposition and diagram coverage: 119 suites / 1,132 tests passed; one suite/test skipped. `/tmp/review-recovery-fix-tests.log`.
- After the final recovery/read-path refinements: 11 focused suites / 58 tests passed. `/tmp/review-recovery-fix-final-focused.log`.
- Tests used a 60-second test timeout because the preceding review demonstrated machine-sensitive five-second timeouts. No production timeouts were raised.

The former failure reproductions now assert successful recovery. Tests exercise actual provider callbacks, App handlers and IndexedDB-backed source/review stores with publication failures injected. They cover source failure and reopening, review finalization failure and reload, no duplicate source publication, preserved independent edits, approval-history finalization once, failed preparation before any source write, and the pending-save retry UI. Tests do not make live AI calls.

## Limits

Source and review records remain in separate databases; durable pending operations and source receipts provide explicit recovery rather than a cross-database transaction. Genuine source conflicts still reject and require reconciliation. Existing large-record hydration costs for explicit edits/continuation are not eliminated. Actual customer-project testing in packaged Desktop and Safari remains outstanding. No customer data was changed, unrelated working changes were preserved, and nothing was committed or released.

Final checks: production build passed with warnings (`/tmp/review-recovery-fix-build.log`); all four server project-transfer tests passed (`/tmp/review-recovery-fix-server.log`); `git diff --check` passed. Nothing was committed, pushed or released.
