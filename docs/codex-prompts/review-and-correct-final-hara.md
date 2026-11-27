# Review and surgically correct completed Projects HARA

Historical implementation prompt. The current replacement is [review, correction and independent verification](replace-project-hara-review.md).

Implement an automatic final quality review of the complete Projects HARA results, modeled on a spreadsheet review. Review structured saved results directly; CSV remains an export artifact. Also allow the user to review an existing completed HARA without regenerating STPA or HARA.

Preserve the shared Item, generic core losses/hazards, STPA evidence and identities, applicability, user-authored cells, existing unrelated edits and saved work. Use deliberately synthetic fixtures only. Do not include private exports or incident records in tracked source.

Review the entire completed table for contradictions between S/E/C classes and their reasoning, failure probability used as exposure, hazardous stopping/steering restrictions, invalid timing units or detection deadlines substituted for FTTI, interface templates substituted for vehicle-level hazardous events, and safety-goal abstraction/consistency. C0 means generally controllable, not zero ability to control.

Return reasoned, field-specific proposals tied to unique stable row IDs and an exact input snapshot. Apply only permitted HARA output fields. Reassess affected decisions from the Item, operating context and source evidence; never mechanically flip every C0/C1 or rewrite generic source hazards. Check dependent fields together, then deterministically recalculate event ASIL and shared-goal ASIL/links. Keep table, saved drafts, CSV and workbook outputs synchronized.

Use the same practical acceptance bar as the primary analysis. All primary and post-review results are final: one usable best-supported decision per applicable event, with bounded effort. The review improves final results and never acts as another acceptance or validation gate. Use one review pass and at most one correction attempt for each bounded batch, with capped concurrency and durable caching. No indefinite/per-row repair loops, repeated STPA, provisional/incomplete results, blocked assessments, or Needs Review/status columns. Retain the existing final assessment when no sound correction is available. Preserve cancellation/account/storage errors and save the original results before reviewing. A review service/storage error must not reclassify saved primary results as failed or incomplete.

Record an undoable change history containing original and replacement cells, stable IDs and reasons. Undo must preserve subsequent analyst edits and recalculate derived artifacts. Persist review history with the workbook and expose review/undo actions without changing existing clear/restore semantics. Do not mark the review complete until its outcome has been durably saved.

Validate synthetic cases covering inverse controllability reasoning, legitimate C0, late emergency-stop rejection, timing dimensions, event specificity, immutable source fields, user-protected cells, stale/duplicate IDs, reordered rows, patch atomicity, derived ASIL/goal propagation, draft synchronization, cancellation/storage failures, bounded retries/cache reuse and undo/reload/export behavior. Run relevant regression tests and a production build; validate the final renderer in isolated Electron. Preserve any active preview analysis when staging the update.
