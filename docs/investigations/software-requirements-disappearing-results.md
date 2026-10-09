# Software requirements disappearing after generation

Date: 2026-10-09

The user's exact browser run was not available for inspection. The following failure paths were reproduced against the prior implementation and fixed in `EngineeringArtifactPanel.js`.

- Initial asynchronous storage loading unconditionally replaced displayed rows. If it resolved after generation, an old/empty snapshot erased the new requirements.
- A storage change event also reloaded rows unconditionally, including responses started before generation or before switching scope.
- Every loaded row array triggered autosave, which emitted another storage event, which loaded another array and triggered another autosave. This feedback loop performed unnecessary writes and allowed stale loaded state to be persisted.
- An empty generation response was treated as success, replaced existing rows with an empty array, and cleared downstream artifacts.

Changes:

- Track row revisions and ignore stale read results after a local update/generation.
- Track the loaded/saved row snapshot; loading results is no longer considered an edit requiring autosave.
- Catch autosave failures and show them in the panel.
- Publish generation only into its original project/repository view; save remains associated with the original project/repository.
- Reject empty generated results while retaining previous requirements and downstream artifacts.

Validation:

- Five panel regression tests cover initial-read races, change-event races, empty-output preservation, absence of load/autosave feedback, and leaving/reopening the panel after generation.
- Running these tests against the original panel produced four failures (the simple reopening test already passed).
- The updated panel passes all five tests; the existing artifact AI suite also passes (19 tests across both suites).
- No changes to AI requirement derivation, hazard reasoning, or requirement content.

This does not retroactively recover data already overwritten by the old implementation. No customer browser storage was modified during this investigation.

Production build passed with lint warnings. `git diff --check` passed.
