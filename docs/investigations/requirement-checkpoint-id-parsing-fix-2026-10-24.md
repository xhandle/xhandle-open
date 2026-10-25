# Requirement checkpoint ID parsing fix

Executed `docs/codex-prompts/fix-requirement-checkpoint-id-parsing.md`.

Coverage validation now imports the existing `splitIds` parser from artifactUtils, eliminating the separate parsing implementation. Cache acceptance and requirement processing therefore agree on commas, semicolons, line feeds, carriage returns, CRLF, case-insensitive “and”, and array values.

The previous reproduction probes now require full checkpoint reuse after project export/import with no provider calls. Added negative coverage checks ensure supported separators cannot make incomplete source coverage appear complete. Existing ordered-coverage and consolidation tests remain in place.

Focused validation: 50 transfer tests passed. Broader validation: 130 suites / 1,130 tests passed across transfer, assurance, source context, and hazard analysis. `git diff --check` passed. Production build passed with warnings.

Large-project Safari-to-packaged-Electron validation remains outstanding. This fix does not change the archive memory or crash-recovery limitations documented previously. No commit, push, or release was performed.
