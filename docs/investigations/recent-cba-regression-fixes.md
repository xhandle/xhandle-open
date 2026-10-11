# Recent CBA regression fixes

Executed docs/codex-prompts/fix-recent-cba-regressions.md.

## Implemented

1. HARA/FHA classification now applies the shared safety-classification evidence policy and requires a substantive classification rationale. Incomplete classifications receive a corrective retry; unresolved outcomes remain Needs Review and cannot qualify automatic software safety requirement imports. Applicability remains unchanged. Classification evidence fields persist in output. Postprocessing checkpoints no longer cache unresolved classifications; checkpoint version changed to invalidate earlier generation contracts.
2. Legacy whole-function HARA/FHA preprocessing is retained under archivedUserPreprocessing with original decisions and source run identity. New specific guide phrases are assessed independently. Exact phrase decisions continue through the existing preservation path. Regeneration is no longer blocked solely by legacy broad decisions. Archived history survives run normalization and continuation; original saved run data is not edited in place.
3. FHA generates and validates separate severity and SCC rationales. Normalization computes a SwCI derivation explanation from the implemented matrix inputs. All three fields persist in the FHA and Summary sheets for display and export; Projects generation remains on its legacy schema.
4. Repository-context generation checks request identity, modal state, project/repository identity and original draft identity before adopting asynchronous results. Close/cancel invalidates the request. Changing repository or editing context during generation prevents stale results from overwriting those edits. Both local and GitHub branches are guarded.

## Validation

150 distinct targeted tests passed across nine suites, including corrected classification behavior, independent FHA rationale fields, review migration through the runner and reload, stale request guards, STPA applicability preservation, table/CSV and software-requirement regressions. Production build passed with existing warnings. git diff --check passed.

The model and storage integrations in these tests are mocked. No live provider/customer repository or Safari smoke test was run. Existing saved analyses are not retroactively reclassified or supplied with invented rationales; rerunning applies the corrected contracts. Archived broad decisions are historical records, not approvals of the newly introduced guide phrases. No commit/push.
