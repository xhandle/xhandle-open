# Final-save recovery review

## Verdict
The original destructive timeout, lack of bounded automatic transient retry, and hidden initial error are addressed on the normal final-save path. Two remaining lifecycle defects prevent a clean regression signoff.

## Findings

### High: superseded writes resolve as successful without persistence
`codeArchitectureHazardStore.js:162,170,183,188` returns the input run when ownership changes. A newer same-ID save can supersede a first save while its database open is pending. The first promise resolves without any put; the newer save has not committed and can still fail. Existing callers interpret resolution as durability (runner reports saved; App retry clears registry/UI flags). The write queue prevents stale database writes but does not preserve the success contract. Return an explicit superseded outcome handled by all callers, or wait for and propagate the replacement outcome without publishing the old revision. Deletion invalidation must likewise not report successful persistence.

Reproduced with a delayed database open and two revisions: first promise resolved before any put call.

### Medium: Stop during final save can retain a permanently pending UI record
`fastHazardRunner.js:191` suppresses save-state callbacks after run cancellation. App cancellation settles the outer task immediately and `hazardRunRegistry.finish` retains the finalSavePending record. Storage continues independently and may successfully commit. The emitted change event cannot refresh this record because App's loader (`App.js:7960`) returns the retained registry run before consulting storage. The recovery notice disables Retry save for pending status. Thus the current UI can remain "saving" after durable success; a later actual failure can likewise leave the retained record pending without its error.

Reproduced the App/registry cancellation sequence with delayed storage: storage committed finalSavePending=false while the registry retained finalSavePending=true/status=saving. UI consequence verified by reading the loader and recovery notice. Repair final-save lifecycle synchronization separately from generation cancellation, scoped by run ID/revision, without permitting stale progress updates.

## Verification and scope
545 existing tests passed plus two temporary reproductions asserting the observed defects: 547 total across 54 suites. Temporary tests removed after review. No application code changed during this review. Prompt and this report added only. No live Safari reproduction performed. These tests do not establish the exact cause of the user's historical save failure. A genuinely nonsettling browser operation still remains pending; no durable-save guarantee is possible in that case.
