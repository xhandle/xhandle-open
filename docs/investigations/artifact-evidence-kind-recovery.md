# Artifact evidence-review type recovery

The reported System Requirements Specification generation stopped during an evidence review with an unsupported draft-item type. Previously saved Architecture and ConOps documents were already complete; the failure prevented the requirements sequence from continuing.

The screenshot does not include the provider's raw response, so its exact rejected type is unknown. The implementation contained a reproducible prompt/schema mismatch: the evidence-review instructions requested facts and constraints, while validation accepted only `narrative`, `requirement`, `decision`, `gap`, and `interface`. The JSON example also used the entire pipe-separated enumeration as its sample kind value.

The generation prompt now uses a real `narrative` example and explicitly assigns each content category to its supported kind. A shared kind list governs validation. Case and surrounding whitespace are normalized for supported labels. During intermediate evidence reviews only, `fact` maps to `narrative` and `constraint` maps to `requirement`; text, conditions, identifiers, and citations are preserved. This does not create a new obligation, supply missing evidence, or bypass downstream requirement-writing checks.

Unknown types still receive a bounded correction request identifying the rejected label and its original array position, including in reviews with more than 60 items. They are not silently accepted, dropped, or recast as approved content. Citation validation, missing-evidence handling, field bounds, and duplicate-key checks remain in force.

No saved-data migration is required. After this code is available in the user's running app, resume the existing proposal. Its source manifest, token, completed evidence reviews, and completed sections remain reusable.

## Verification

- The Design Management artifact and project integration suites passed: 505 tests in 54 suites covering validation, generation retries, checkpoint reuse, requirement derivation, safety inheritance, acceptance, and persistence. The production renderer build, focused lint, diagnostic syntax checks, and whitespace checks also passed.
- A provider-boundary regression reproduces an unknown type on review four, preserves reviews one through three, reloads the stored job, resumes using the supported evidence aliases, and accepts all six specification sections with their original source citations.
- `scripts/diagnostics/verify-artifact-evidence-kinds.cjs` repeats this flow through real UI controls and fetch requests in Electron using a freshly compiled production renderer, a disposable profile, synthetic sources, and a local provider fixture. It checks persisted acceptance after another reload and records screenshots and a JSON result.
- The reusable Electron regression runner includes this check as the `artifact-generation` suite.

Run the focused renderer check with:

```sh
XHANDLE_PLAYWRIGHT_MODULE=/path/to/playwright-core node scripts/diagnostics/verify-artifact-evidence-kinds.cjs --electron /path/to/electron --build build
```

These tests exercise controlled provider responses. They do not certify arbitrary live model output quality or alter a customer's workspace. The fix is included in [desktop 0.2.18](../testing/desktop-release-0.2.18.md); previously published packages remain immutable.
