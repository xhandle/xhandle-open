# Functional input for software requirements

Implemented `docs/codex-prompts/prefer-functional-software-requirements.md`.

The shared software requirement source selector now uses `buildFunctionalModelRows` when the saved Functional model passes its existing readiness/currentness checks. Otherwise it selects current CSU rows. The panel uses the same selector for its source count and displays “Functional table” or “CSU table.” Already-projected Functional rows are accepted without expanding back to detailed calls. All Functional table rows are used, including node-only responsibilities; UI column filters do not alter the input.

Generated requirement references retain the Functional relationship ID plus supporting source trace IDs, row references, and indices. Exact projected trace lookup now precedes raw-source lookup, allowing both Functional and detailed datasets to resolve correctly. Existing saved requirements are not automatically regenerated; the next derivation uses the selected source. Hazard requirement import, storage, and hazard-generation logic remain unchanged.

Files: `softwareRequirementSource.js`, `artifactAI.js`, `EngineeringArtifactPanel.js`, `artifactUtils.js`, and `softwareRequirementSource.test.js`.

Validation: 68 distinct focused tests passed across the two runs (the selector tests overlapped), including GitHub/local parity, reload, missing/stale models, imported Functional CSV, actual mocked-model request content, supporting trace preservation, panel/persistence regression suites, and Functional model regression coverage. Production build passed with lint warnings; `git diff --check` passed. No live AI requests or customer data changes were performed.
