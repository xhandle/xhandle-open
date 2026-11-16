# Code-Based Architecture HARA field parity

Code HARA previously generated only a combined S/E/C rationale and one safety-goal statement. Its default table omitted the separate rationales, safe state, FTTI, goal ASIL and assessment completeness fields available in Projects.

The generation schema, actual results-first prompt, saved sheets and default table now share the Projects HARA field inventory. Code labels retain Function, Malfunctioning Behavior and Verification as aliases for the equivalent Projects fields. All new fields use the existing column visibility, resizing and searchable multiselect controls.

Event ASIL and safety-goal IDs/ASIL use the Projects calculator. Finalization runs after imported/user-owned fields are reconciled, across the entire run, so a goal's highest linked-event ASIL is independent of the 100-row result batches. The saved Safety Goals sheet and summary row records agree with the main table.

Safe state, FTTI, its timing rationale and item boundary must come from supplied evidence. Missing values stay blank and are identified in Assessment Gaps/Status. The existing assumption-based recovery path labels its rating premises and does not invent timing bounds. No Item definition text box was added.

Older saved HARA tables expose missing columns with blank cells without rewriting their saved values. Regeneration is necessary to assess the new fields. Existing STPA tables and legacy FHA results retain their own schemas.

Validation:

- Related HARA, storage, query, worker, recovery, table, downstream software-requirement and Projects tests: 107 suites / 970 tests passed.
- Focused final helper/table checks after preserving case-insensitive legacy aliases: 17 tests passed.
- Integration covers a safety goal spanning 112 events across the result-batch boundary, highest ASIL, new fields, real storage reload and CSV roundtrip.
- Real Electron checks use a fresh production renderer and isolated synthetic profile. Projects generation controls the remote AI response; Code HARA fixtures use the production sheet builder and storage/paged-table implementation. Live provider output quality is outside these deterministic checks.
- Final focused Electron gate passed build, fixtures, native protocol/preload/backend/persisted-reload smoke, and 16 HARA interaction assertions. The source fingerprint was unchanged. This was a focused macOS run, not the complete cross-platform release gate.

Electron report: `/private/tmp/xhandle-cba-hara-final-20261115/report.json`.
