# GitHub analysis and checkpoint reliability review

Status: local regression review passed. The user confirmed the same repository completes in Chrome and explicitly excluded Safari from this update's scope. Safari confirmation is no longer a release blocker. The changes are committed and published in [Desktop 0.2.19](desktop-0.2.19-publication-2026-11-20.md); the later publication record supersedes the preparation status below.

The subsequent [detailed architecture/hazard review](code-architecture-hazard-review-2026-11-20.md) records additional fixes and the final comprehensive verification of the expanded changeset. Use that report and its final source fingerprint for current release readiness.

## Evidence and corrections

The customer reported a GitHub API rate-limit error on a repository containing approximately 6,000 files. The current source flow reads selected files for its manifest and again during analysis. Repository file count is not necessarily selected-file count.

The implementation coordinates GitHub cooldowns within a renderer per host/credential. It recognizes rate-limit responses, honors future reset/Retry-After values, supports consecutive quota windows and uses bounded backoff when no usable reset is supplied. Quota waits occur outside individual network deadlines. The active operation retains its selected commit, file progress and completed work. Authentication/permission failures are not automatically treated as quota errors. The application must stay open for automatic continuation; closing or restarting it still uses the existing explicit checkpoint-retry workflow.

Review identified and corrected additional issues:

1. Repository verification/context lookup could wait silently without cancellation. These operations now display progress, receive cancellation signals, and discard results for a closed or changed source dialog.
2. The recovery panel displayed only file-level failure counts. Fatal run-level failures could leave an unfinished run showing zero failed files with no persistent cause. A small separate interruption record and a scoped live message now retain the cause without copying large checkpoints or replacing publication-ready data.
3. The user supplied a Safari console screenshot showing `AbortError: The operation was aborted` after a 24-file run stopped itself at 13 completed files. The screenshot does not identify the aborted API. A reproducible storage path existed: chunk staging retries aborts, but the final checkpoint pointer transaction and analysis reads did not. The source-storage adapter now retries those transient aborts using fresh transactions, with a finite allowance. It preserves the original write baseline across retries so a competing edit is rejected rather than overwritten. Real user cancellation and storage-quota failures are not retried as transient aborts.
4. Storage-error handling attempted to assign to the read-only `DOMException.code`. It now wraps the cause in a normal error with a stable code.
5. A source-section checkpoint callback passed its state object into the checkpoint writer's phase argument. An explicit callback now preserves the phase string.
6. HARA synthetic provider fixtures assumed the original contract was the first prompt line. They now also recognize repair-prefixed prompts, retaining the exact event envelope.
7. The full frontend suite caught a checkpoint archive round-trip regression from adding an empty interruption property. Readers now preserve the original object shape when no interruption exists; the existing archive test passes without weakening its equality check.

The Safari report occurred in a localhost development session while application source was being edited. React development refresh can remount App and activate its existing analysis-cancellation cleanup. This is another plausible explanation for a run-level AbortError without a Stop click; the screenshot alone cannot distinguish it from an IndexedDB abort. Application source is frozen during the final verification and user retry. Packaged desktop apps do not use development hot reload. Do not claim the original specific abort cause is proven without a stable-version reproduction or saved failure reason.

Existing authorized changes to traceability layers/panning and HARA reasoning repair remain part of the pending shared-source changeset.

## Verification

- GitHub tests cover hour-long waits, repeat quota windows, shared-worker gating, cancellation, permission errors, clock skew, network timeouts, private pinned-blob retry and a simulated 6,000-file/two-pass run.
- Source-storage tests inject a real fake-IndexedDB transaction abort after 13 completed files and verify that all 24 complete. They cover competing edits, bounded persistent aborts, non-retryable quota failures, DOMException preservation and cancellation.
- Setup-handler tests execute the actual App handlers with synthetic network boundaries to verify progress, cancellation and stale-result protection.
- Recovery/storage tests cover durable interruption reasons, live storage-failure messages, save-only recovery, scoped data isolation and successful publication cleanup.
- Final frontend: 4,393 passed, four existing skips, zero failures; backend: 126 passed; capacity: 13 passed; desktop native Node: 49 passed; native Python release validators: 19 passed.
- Production build, native startup and every GUI regression category passed on the same unchanged source fingerprint: workspace, HARA, hazard/organization profiles, design/traceability, artifact generation, derivation, safety inheritance, collaborator and worker responsiveness.
- Native IndexedDB fault-injection checks passed in WebKit 27.2 and Chromium 157.0.8103.80: 24-file completion after a checkpoint-commit abort at file 14, read-abort recovery, bounded persistent aborts, original-checkpoint retention, DOMException wrapping, competing-edit protection and cancellation.
- The initial GUI launch attempts could not load an incomplete temporary Playwright package. Restoring the cached package allowed every GUI category to execute and pass; this infrastructure failure is retained in its original report.
- Evidence: `/private/tmp/xhandle-0.2.19-verified-review-20261120/report.json` (complete frontend/backend/capacity/native checks), `/private/tmp/xhandle-0.2.19-native-gui-review-20261120/report.json` (all GUI categories), `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-native-storage-q4HndI/result.json` (WebKit/Chrome), and `/private/tmp/xhandle-0.2.19-release-preparation/readiness.json` (combined readiness and source-fingerprint equality).
- Live providers/customer repositories, full Safari application analysis, signed new-version installers and native Linux runtime remain separate from controlled local tests. The user confirmed the repository completes in Chrome; that does not prove the specific original Safari abort cause.

## Desktop preparation

The current desktop version is 0.2.18. Prepare 0.2.19 for macOS arm64 and Linux x64, preserving the Windows 0.2.16 channel. Shared application changes remain in this repository; Electron/native code remains in the private desktop repository.

Prepared publication sequence:

1. Commit and publish the reviewed shared source. Record the exact clean, published SHA.
2. Update the private desktop submodule to that SHA; bump package.json/package-lock.json to 0.2.19 and include the new regressions in desktop shared checks.
3. Review and commit the desktop pin/version change, then run destination-OS CI for Mac and Linux. Do not substitute cross-built Linux artifacts for Linux validation.
4. Build/sign/notarize/finalize Mac artifacts using the established local release tooling; obtain the matching Linux archive/AppImage validation receipt.
5. Run the selected-platform publisher in validation-only mode with the retained Windows tag. Public promotion remains a separate step; never publish an incomplete updater asset set.

Build provenance must identify matching desktop/shared commits. No production signing, notarization, feed publication or customer native replacement is established by a working-tree regression run.

An unapplied desktop version/shared-test patch, commit text and publication sequence are prepared in `/private/tmp/xhandle-0.2.19-release-preparation/`. The desktop checkout remains unchanged; its exact new shared submodule SHA must come from the reviewed, published shared commit. No changes are staged in the shared repository. Chrome and native Electron are the verified application targets for this update; the original Safari-specific interruption remains an unconfirmed follow-up, rather than a reason to hold this preparation.
