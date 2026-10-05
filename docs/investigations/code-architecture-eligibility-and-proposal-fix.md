# Remaining source-analysis gaps: implementation and validation

Implemented the prompt in `../codex-prompts/fix-code-architecture-eligibility-and-proposal-reconciliation.md` against the findings in `alpy-latest-workbook-comparison.md`.

## Changes

- New analysis version: `source-equivalence-v3-eligibility`. New generated rows use eligibility policy 2; existing policy-1 and legacy rows keep their interpretation until rerun. Checkpoint identity includes the analysis version.
- Imported and receiver call expressions are no longer rejected merely because dispatch is unresolved. Source symbols and module roles screen operational relevance independently of target resolution. Eligibility rationales explicitly preserve that uncertainty. Generic utilities and model-only proposals still need review; static structure and test/example calls are excluded. The test-path rule now also recognizes `test_inference.py` outside a tests directory.
- Raw placeholder endpoints are rejected before normalization, including `N/A`. Empty package initializers remain valid analyzed files with zero relationships.
- Unique repository-module matching reconciles imported destination proposals with caller-file evidence. Absolute and relative imports are supported. Ambiguous repository roots, shadowed/conditional bindings, wrong files, and ambiguous caller names are not merged. A final cross-file pass also handles proposals emitted while analyzing the destination file. Canonical IDs and persisted syntax evidence are unchanged; this is not runtime dispatch proof.
- Proposal counts are calculated from published, reconciled rows, with pre-deduplication counts and count semantics exported separately. Old manifests explicitly retain legacy count semantics. Eligibility policy and rationale are exported alongside the decision.
- Both node-identity helpers recognize policy 2. Existing reconciliation retains trace IDs, node/edge IDs, row references, manual descriptions, and analyst overrides on unchanged evidence. Removed proposals remain historical rather than deleting their downstream records. Hazard generation, remediation, requirements, design, and traceability mechanics were not redesigned.

## Verification

195 tests passed across 25 suites: source context, proposal reconciliation, code architecture assurance, hazard analysis, safety remediation, diagram navigation, and the analysis generator. Coverage includes the six downstream areas, save/reload, historical evidence, reviewed edits, policy upgrades, ambiguous imports, raw placeholders, and exported counts.

The browser harness `code-source-convergence-v3-check.cjs` exercised all 22 Python files in the local Alpamayo checkout through both adapters and a repeated GitHub run. GitHub and AI responses were intercepted in an isolated browser; no customer source was transmitted and no paid AI was used. The model fixture deliberately omitted relationships on one run and supplied import aliases, the observed destination-file proposal, and an empty-file placeholder on another.

Results:

| Check | Result |
| --- | --- |
| Canonical relationships | 909 on both adapters |
| IDs versus prior real GitHub workbook | All 909 identical |
| Local/GitHub canonical facts and eligibility | Identical |
| Comparison fingerprints | Identical |
| Repeated-run trace identities | Preserved |
| Source hashes and selected-file coverage | Present for all 22 files |
| Parse errors | 0 |
| Empty-file placeholder | Rejected |
| Imported-function duplicate | Reconciled into source relationship |
| Published proposal count in controlled fixture | 0, matching published rows |
| Include / Exclude / Needs Review | 446 / 252 / 211 |

Before the fix, the same 909 source-backed relationships were 9 Include / 232 Exclude / 668 Needs Review. The additional 20 exclusions are calls in `src/alpamayo_r1/test_inference.py`.

The production build passed with existing lint warnings. `git diff --check` passed.

## Limits and applying the fix

Reload the updated app and rerun architecture analysis to apply the new policy to an existing project. Existing analyses and historical records are not silently rewritten. Genuine unverified model proposals may still differ between paid AI runs; the convergence guarantee covers the canonical source-supported inventory, not arbitrary generated prose or unresolved proposals. The 446 inclusions are assessment candidates, not 446 proven hazards. The syntax inventory remains bounded and does not prove a complete semantic call graph or runtime behavior. Live provider output was not rerun in this validation.
