# Latest Alpamayo GitHub/local workbook comparison

Reviewed 2026-10-05. Original workbooks and application code were not modified.

## Inputs

- /Users/Nick/Downloads/alpy-1_git-project-workbook-2026-10-05.xlsx
- /Users/Nick/Downloads/alpy1-local-project-workbook-2026-10-05.xlsx

## Confirmed convergence

Both runs used source-equivalence-v2-syntax and report selected-files-analyzed. All 22 analyzed paths have identical byte hashes, text hashes, definition counts, call-expression counts, source-relationship counts, and zero parse errors. Requested/effective provider, model and effort match. Comparison fingerprint: 430fb3ad088f3656c6dc71fdd1de0b0bfe17c21db09c1d67cbf84c655205a63d.

Both workbooks contain exactly 909 unique canonical relationships, with no missing or extra canonical identities on either side. For every canonical relationship, endpoint labels/paths, action label, hierarchy allocation, evidence kind/version, target-resolution status, source lines/hash and hazard eligibility match. Project-specific trace IDs/run fingerprints differ as expected across separate projects. Row numbers differ because additional model proposals are interspersed.

Canonical kinds: 81 class members, 23 inheritance relationships, 39 lexical direct calls, 307 imported calls and 459 call expressions with unresolved runtime targets. Syntax evidence is not proof of runtime dispatch or a complete semantic graph.

## Remaining differences

| Measure | GitHub | Local |
| --- | ---: | ---: |
| Total architecture rows | 946 | 962 |
| Canonical source-backed rows | 909 | 909 |
| Exported unverified proposals | 37 | 53 |
| Hazard eligibility Include | 9 | 9 |
| Hazard eligibility Exclude | 232 | 232 |
| Hazard eligibility Needs Review | 705 | 721 |

Descriptions differ for 167 From Details cells, 143 Control Action Details cells and 169 To Details cells among matched canonical rows. These fields are model enrichment; this comparison establishes identity/classification consistency, not correctness of every description.

The GitHub Runs sheet reports 38 model-only proposals although 37 remain in the Architecture sheet. The generator counts these in the per-file ledger before final deduplication. The metric should be labeled pre-deduplication or accompanied by the published count.

Full coverage inventories differ in unselected/adapter-excluded paths (including .github templates), but the 22 analyzed source paths and hashes match.

## Open issues

### Hazard eligibility remains restrictive

Among the 909 canonical rows, 232 are Exclude, 668 Needs Review and only 9 Include. The 668 comprise 397 unresolved call-expression rows, 250 imported-call rows, and 21 lexical direct-call rows. All additional unverified proposals are Needs Review.

The current hazard input builder filters with isCodeArchitectureHazardEligible, which admits only Include rows and excludes historical rows. Consequently only nine architecture relationships currently proceed automatically into hazard analysis, before expansion into guide phrases and operational contexts. Source-inventory convergence does not establish broad downstream hazard coverage. Eligibility needs to distinguish structural/test exclusions from operational imported/member calls requiring evidence or review; it should not simply bulk-include every unknown call.

### Empty-file placeholder accepted

GitHub architecture Row 299 is N/A → N/A, action none, for src/alpamayo_r1/diffusion/__init__.py. Its own details say the file has only a license header and no functional content. This is a no-results placeholder, not a relationship, and should not enter the architecture table as a review item. The local workbook has no equivalent placeholder.

### Cross-file aliases can remain separate proposals

GitHub Row 139 represents UnicycleAccelCurvatureActionSpace._v_to_a → alpamayo_r1.action_space.utils.solve_xs_eq_y with canonical imported-call evidence. Row 180 separately proposes _v_to_a → solve_xs_eq_y with the actual target module path. These appear to describe the same source interaction. Matching currently requires both endpoint file fields to agree with the inventory's source-reference path, so resolved destination paths can prevent an enrichment match. Any repair should resolve imports using verified repository paths and preserve ambiguous cases instead of merging by short name alone.

## Assessment

The previously missing/inconsistent source-backed inventory is now demonstrably convergent in these real analysis exports. The overall workflow is not yet fully resolved: eligibility coverage, placeholder rejection, and source-verified alias/proposal reconciliation remain actionable. These files contain no generated hazard/remediation/requirements/design results, so actual downstream execution was not validated by this workbook comparison.
