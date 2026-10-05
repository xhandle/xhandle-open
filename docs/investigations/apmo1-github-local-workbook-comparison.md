# GitHub/local Alpamayo workbook comparison

Reviewed 2026-10-05. Read-only comparison; original workbooks and application code were not modified.

## Conclusion

These exported results do not demonstrate convergence. There are both presentation differences and substantive differences in represented relationships. Automatic recovery of failed requests is separate from completeness and consistency of relationship extraction. A larger total is not evidence that one workbook is more accurate.

## Inputs and limits

- GitHub: /Users/Nick/Downloads/apmo1_git-project-workbook-2026-10-05.xlsx
- Local: /Users/Nick/Downloads/apmo1_local-project-workbook-2026-10-05.xlsx
- Each workbook has a Summary and an Architecture sheet, with 230 and 247 architecture rows respectively.
- Endpoint file references cover 21 distinct paths in GitHub and 22 in local. These are represented paths, not proven counts of files analyzed.
- Neither workbook includes source-content hashes, effective analysis settings, per-file coverage/failure records, canonical relationship IDs, or lineage disposition. They cannot establish identical source snapshots or explain every omission.
- No downstream hazard or requirements results are included, so downstream behavior was not tested by this comparison.

## Concrete discrepancies

1. Local rows 89–93 reference geometry/coordinates.py and xyzrot_to_corners interactions with torch.tensor and tensor operations. No GitHub row references that file. This is an export coverage difference; it does not prove the file was never processed.
2. geometry/rotation.py has 16 GitHub rows and 23 local rows. Local includes so3_to_yaw_np → numpy.arctan2, rotation_matrix → numpy.cos/sin/array, and transform_coords_2d_np → numpy.einsum absent in GitHub. Some additional proposals need source validation: local row 97 describes numpy.pi as an invocation. More rows therefore do not automatically mean better analysis.
3. action_space/unicycle_accel_curvature.py has 15 GitHub rows and 4 local rows. GitHub includes six action_to_traj → torch operation rows absent from local, plus additional class membership rows. Three membership pairs differ only by method qualification and should not be counted as distinct semantics.
4. Identically named endpoints can receive different allocations: GitHub row 186 and local row 204 (_TinyExpert → torch.nn.Module) use Alpamayo Subsystem/Software/Components versus Alpamayo Main Subsystem/Software/Components. 28 uniquely matched endpoint/path pairs differ in at least one hierarchy field.
5. Module naming varies: test_inference.py (module script) versus src/alpamayo_r1/test_inference.py. Method labels also vary between qualified and unqualified forms. These inflate naive textual mismatch counts.

## Matching method

Exact comparison key: Function (From), its file path, Function (To), and its file path, trimmed, excluding action wording and descriptions. There are 224 GitHub and 242 local distinct exact keys, with 159 shared keys. There are 152 shared keys with exactly one row on each side. These are string-based correspondence statistics, not semantic completeness scores. Repeated endpoint pairs may represent multiple operations or call sites and were not automatically classified as duplicate defects.

## Relevant implementation findings

- src/features/code-architecture-context/codeRelationshipEvidence.js deliberately inventories only lexical Python same-file definitions, class membership and selected direct calls. Imported/library calls remain model-derived; this leaves substantial scope for run-to-run extraction differences.
- Its definition recognizer processes one line at a time and requires the definition header and colon to match on that line. Multiline Python signatures therefore escape that recognizer. This is a concrete coverage limitation; the workbook does not contain source text to attribute each missing member to this cause.
- completeSupportedRelationships attaches evidence to matching model rows while retaining their display names; source-generated fallback rows use qualified names. This permits label variation even for evidence-backed relationships.
- Model-only deduplication includes action text and action details. Wording variation can change row identity.
- meaningfulArchitecturePathSegments falls back to repoContext.repoName. Local context uses source.folderName, while GitHub uses the repository name. Folder suffixes such as -main can consequently change hierarchy labels. This mechanism is consistent with the observed Alpamayo/Alpamayo Main allocations.

## Recommended next correction

Treat these workbooks as a real-world regression case. Compare source manifests/settings first, use a syntax-aware source inventory for Python definitions and syntactically resolvable operations, standardize evidence-backed endpoint identities and source-independent fallback hierarchy names, and expose coverage/provenance in exports. Preserve unresolved model proposals as explicit proposals instead of claiming a complete graph. Verify both presence and absence of relationships, not just row counts, and exercise downstream linkage/reconciliation using the resulting stable identities. Do not force parity by dropping unmatched valid rows or relabeling structural membership as executable control actions.

## Rows by originating source file

Counts below include structural and model-derived rows. They are not function counts.

| Source file | GitHub | Local |
| --- | ---: | ---: |
| src/alpamayo_r1/action_space/__init__.py | 4 | 4 |
| src/alpamayo_r1/action_space/action_space.py | 3 | 5 |
| src/alpamayo_r1/action_space/discrete_action_space.py | 4 | 7 |
| src/alpamayo_r1/action_space/unicycle_accel_curvature.py | 15 | 4 |
| src/alpamayo_r1/action_space/utils.py | 16 | 17 |
| src/alpamayo_r1/common/logging.py | 11 | 13 |
| src/alpamayo_r1/config.py | 1 | 1 |
| src/alpamayo_r1/diffusion/__init__.py | 1 | 1 |
| src/alpamayo_r1/diffusion/base.py | 4 | 4 |
| src/alpamayo_r1/diffusion/flow_matching.py | 11 | 13 |
| src/alpamayo_r1/geometry/coordinates.py | 0 | 5 |
| src/alpamayo_r1/geometry/rotation.py | 16 | 23 |
| src/alpamayo_r1/helper.py | 2 | 2 |
| src/alpamayo_r1/load_physical_aiavdataset.py | 8 | 7 |
| src/alpamayo_r1/models/action_in_proj.py | 14 | 25 |
| src/alpamayo_r1/models/alpamayo_r1.py | 7 | 8 |
| src/alpamayo_r1/models/base_model.py | 15 | 23 |
| src/alpamayo_r1/models/delta_tokenizer.py | 21 | 11 |
| src/alpamayo_r1/models/diffusion_expert_cuda_graph.py | 15 | 16 |
| src/alpamayo_r1/models/token_utils.py | 4 | 4 |
| src/alpamayo_r1/test_inference.py | 11 | 10 |
| tests/test_diffusion_expert_cuda_graph.py | 47 | 44 |
