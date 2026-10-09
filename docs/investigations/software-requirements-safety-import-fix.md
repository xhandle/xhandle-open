# Software requirement safety import and fallback diagnostics

The supplied export contains 463 Functional Decomposition Fallback rows and zero hazard-derived rows; all three safety columns are empty. This establishes the output, not the provider error or the saved hazard eligibility state.

Implemented the prompt in `docs/codex-prompts/fix-software-requirements-safety-import.md`:

- Resolve the scoped saved hazard run at derivation time using repository configuration and source identity aliases. Select the newest matching run together with the in-memory run; storage read failures stop the operation rather than silently omitting hazards.
- Normalize wrapped spreadsheet headers/cells and punctuation/spacing in hazard field names. Accept object-based summaryRows when no matrix summary is available.
- Preserve Safety Significant Yes/No/Needs Review filtering and existing blank-tag legacy compatibility. No safety values are invented for functional rows. Safety requirements remain separate hazard-derived rows with hazard-run references.
- Report hazard summary count, imported requirements, safety-filter exclusions, and eligible rows lacking requirement text.
- Record failed AI batches, reject empty/unusable model requirement responses as failures, and show the first error plus fallback count. Runs with fallback drafts are marked as an activity error rather than successful AI derivation; useful rows are still saved.
- Correct merge provenance so a newly AI-generated replacement is no longer mislabeled by a previous fallback row's source.

Files: artifactAI.js, EngineeringArtifactPanel.js, new softwareHazardSource.js and regression tests.

Validation: 33 focused tests passed in the initial five-suite run, plus the additional panel diagnostic test passed in its targeted suite (34 distinct tests total). Tests cover source isolation, saved-run lookup with an unloaded panel, read errors, wrapped headers/cells, field aliases, exclusion diagnostics, Functional input selection, persistence/reopening, and visible fallback warnings. Model calls are mocked; customer browser storage was not accessed. No claims are made that the specific customer's AI provider failure was reproduced or repaired: the run's actual provider response was not available. The new completion message exposes that failure rather than masking it.

If a saved hazard run has no eligible requirement text, generation cannot import safety requirements; the UI now explains this. The detailed hazard CSV is still necessary to determine whether the customer's run has that condition. These changes do not automatically rewrite existing generated requirements.

Production build passed with lint warnings; git diff --check passed. Changes remain local and uncommitted.
