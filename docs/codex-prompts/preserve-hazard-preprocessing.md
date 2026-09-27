# Preserve user preprocessing during hazard generation

Implement in both project and code-based architecture hazard analysis:
- Record explicit manual/CSV assessment edits as user-owned fields, separate from AI-generated values. Do not infer ownership merely because a generated field is populated.
- Before generation, supply user-owned assessments as constraints and complete the remaining fields. A partially assessed row must not be skipped as complete.
- Preserve substantive decisions and rationales after generation. Applicability Yes enables downstream analysis; No uses the existing Not Applicable policy; blank/Needs Review/Unknown/TBD are not fixed decisions.
- Keep stable row IDs. Match by ID or unambiguous architecture/interface, guide phrase and context, never row position alone.
- If the architecture/context supporting a decision changed, flag Needs Review rather than silently accepting or replacing it. Surface conflicts between generated results and user-owned assessments.
- Persist ownership through save/reload/regeneration, undo imports, and retain existing governed review behavior.
- No preprocessing must leave the existing inputs, generation, reconciliation, and completion behavior unchanged. Do not treat old AI rows as human decisions.
- Use shared helpers, add focused regression tests for both generation paths and the no-preprocessing case, and run the relevant existing suites.
