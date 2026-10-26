# Analysis-results export implementation

Implemented the prompt in `limit-project-export-to-analysis-results.md`.

New exports use explicit store/key selection for architecture decomposition, hazard analysis, software/system/subsystem requirements, and design. Saved partial results, continuation responses/checkpoints, trace identities, source descriptors, operational/analysis context, and diagram layout remain portable. Missing analysis categories are not generated. Repository identity/name aliases used by older projects remain supported.

Full source indexes and repository snapshots, separate historical architecture revisions, reports, remediation, general review/workspace/recovery databases, arbitrary project properties/settings, and unrelated projects are excluded. These excluded stores/keys are filtered before payload reads. Immutable architecture chunks follow only included roots; requirements chunks follow their manifests and are checked for missing records and row-count mismatches. Existing source records are unchanged.

The importer still accepts older broad archives, including their original conflict checks. Existing streaming/compression, checksum verification, cancellation, and fixed export status area remain in place. The modal describes the narrower scope and the possible need to reconnect original source repositories/folders to continue source-dependent work.

Validation:

- 121 tests passed across 15 transfer, recovery, storage cancellation, and diagram trace suites.
- Regression coverage includes six analysis categories; absent optional results; partial continuation without repeated provider calls; excluded databases never opened/payloads never read; legacy repository aliases; omitted history; missing requirement chunks; and older broad-archive import conflicts.
- Isolated download/import roundtrips passed in installed Chrome, Playwright WebKit, and Electron 45. Checks exercised gzip disk transport, partial hazards/decomposition checkpoints, requirements, cancellation, UI yielding, and exclusion of source indexes/history. These are synthetic fixtures, not the user's MANPADS data.
- Production build succeeded with existing unrelated warnings. Targeted ESLint and `git diff --check` passed.

Limitations: Playwright WebKit is not a test against the user's installed Safari profile. Actual project file sizes have not been measured. Inline evidence/context and continuation data can still make large analyses exceed a few MB; this change does not promise a fixed maximum size. Source-dependent continuation may need the original files reconnected. No user project data was altered, and no commit, push, or desktop release was performed.
