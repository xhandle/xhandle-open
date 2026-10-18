# Review delayed restoration of completed hazard results

Investigate why the 26,278-row STPA run for avLocalizationWithOutHDMap appeared absent after reload, then reappeared without a confirmed recovery operation. Review startup scope selection, IndexedDB metadata/payload reads, state-reset effects, cancellation and request ordering, context reconciliation, and global review loading. Compare with the implementation before recent performance edits.

Reproduce delayed opening/reads, transient failures followed by recovery, overlapping requests, navigation cleanup, context changes and large result restoration using isolated mocks. Distinguish pending, failed and absent states. Do not modify production code, write to real browser storage, regenerate analysis, delete data, commit or push.

Report confirmed findings with references, hypotheses, a plausible event timeline, recent-change attribution, recommended fixes/tests, and missing evidence needed to establish the incident's precise cause. Save a reproducible diagnostic and findings.
