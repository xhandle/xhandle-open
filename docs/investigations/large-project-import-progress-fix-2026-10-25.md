# Large project import progress fix

Executed `docs/codex-prompts/fix-large-project-import-progress.md`.

Resolved the P2 progress finding from the large-project export review. Each validation/import pass now reports physical bytes consumed independently of completed records. Large streamed records therefore emit intermediate percentages instead of appearing stalled until assembly finishes. Integer percentage changes bound callbacks to at most 100 per pass; updates yield to the UI and recheck cancellation. Percentages are capped at 99 until the project is successfully published. These percentages describe bytes read within each labeled stage, not remaining elapsed time.

The existing archive format, checksum, ownership and schema validation, destination conflict checks, and rollback behavior remain in place. The review reproduction test now requires intermediate, monotonic, bounded progress in both passes. Additional tests cancel during streamed validation and import, verify no project is published or hazard records left behind, and ensure corrupt archives never report success.

Validation:
- 63 transfer tests pass across seven suites.
- Full suite: 2,477 passed, 8 failed, 2 skipped. The eight failures remain in hazardEvalRunner.test.js and match those previously reproduced on unchanged HEAD.
- Production build passes with existing lint/Browserslist warnings.
- git diff --check passes.

No release, commit or push was performed. The actual large project still needs a packaged desktop export/import/continuation test. Full-record IndexedDB allocation and archive Blob memory limits documented in the preceding review remain; this progress fix does not remove them. Legacy v1 imports remain supported, though an individual legacy line must still be read as a whole before its progress is reported.
