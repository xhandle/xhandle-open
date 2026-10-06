# Repository-neutral code analysis implementation

Implemented `docs/codex-prompts/remove-repository-specific-analysis-bias.md` on 2026-10-05.

## Changes

- Removed named Alpamayo function rewrites, filename fallbacks, source-audit row injection, and the model instruction favoring a particular tensor operation. The shared inventory remains responsible for Python call coverage.
- Removed the robotics-filename priority bonus from capped source-file planning.
- New runs use classification policy 3. Source-evidenced production calls are screened regardless of domain vocabulary; structural and test-only relationships remain excluded. Inclusion does not assert lifecycle, safety significance, severity, or guide-phrase applicability.
- Model-extracted calls in languages without a syntax inventory remain available and can enter hazard screening with explicit evidence limitations. Unmatched Python proposals remain held for review. Ordinary excluded language helpers remain outside the published call view.
- New-policy hazard postprocessing preserves supplied hazard wording and safety assessment instead of inferring safety from robotics keywords. It distinguishes call-syntax evidence from evidence of a hazard or mitigation. The source relationship evidence is carried into hazard table rows.
- The analysis version changed to prevent reuse of checkpoints with the old behavior. Canonical relationship identity did not change. Existing policy 1/2 screening and saved analyst decisions remain compatible; policy-only reruns preserve node/edge/trace IDs and overrides when evidence is unchanged. Existing customer projects were not regenerated or migrated.
- Run metadata, the code architecture UI, and workbook coverage sheets distinguish Python syntax inventory, model-only extraction, empty model output, parse errors, missing records, and unresolved targets. Unsupported syntax coverage is not exported as zero known source calls.

## Validation

`CI=true npm test -- --watchAll=false --runInBand src/components/generateFunctionalDecompositionFromGitHub.test.js src/features/code-architecture-context src/features/code-architecture-hazard-analysis src/features/code-architecture-assurance src/features/code-architecture-review src/components/codeArchitectureNavigation.test.js`

Result: **28 suites / 220 tests passed**. Includes generic localization, billing, infusion and helper fixtures; retained Alpamayo regression fixtures; function renaming; mixed Python/C++ coverage; source acquisition; call publication scope; stable IDs and overrides; hazard CSV/preprocessing; software/system/subsystem requirements; design; traceability; review export; and navigation. Downstream model calls in the compatibility tests are mocked.

ESLint on the changed production files, including App.js: **0 errors**, 15 warnings in App.js and the existing generator component. `git diff --check` passed.

## Remaining limits

No new C++ or other-language parser was added. Those languages still use model extraction, without Python-equivalent syntax completeness checks. Python syntax evidence also does not prove runtime dispatch, reachability, implicit/operator calls, or a complete semantic call graph. More calls may now enter hazard screening because generic names are no longer a reason to hold them out.

No paid/live model run, customer localization repository, Safari session, or production build was exercised in this task. The regression suite establishes the tested mechanics, not complete coverage of an unseen customer repository. Changes are uncommitted and have not been pushed.
