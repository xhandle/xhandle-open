# Hazard-derived safety requirements in the specification chain

Saved Projects hazard-analysis obligations enter System Requirements. Saved Code-Based Architecture obligations enter Software Requirements. In mixed projects the code obligations enter Software first; the System specification combines that Software source with the Projects diagram and Projects hazard obligations. Software and Hardware follow the existing source-aware derivation order.

Safety requirements are optional. No analysis is performed automatically and a missing analysis does not block ordinary specification generation. When no saved safety obligations or inherited safety requirements are present, the generation instructions explicitly skip safety requirements, classifications and missing-analysis gaps. Model-provided attributes cannot invent a safety designation.

The source projection reads current saved Projects summaries or the latest completed saved analysis per code repository, including paged storage and legacy workspaces. It selects requirement/constraint text, recorded safety classification, source ASIL, verification and exact analysis/row provenance. It excludes non-applicable and explicitly non-safety rows and avoids copying full hazard tables, code snapshots or diagnostics. Identical obligations share one source with all original row references. Distinct constraints remain distinct.

Recorded shall obligations are retained in the entry specification even if the provider omits them. Existing atomic-statement organization keeps complete sentences, conditions and thresholds. Unsupported wording remains a review gap. Derived requirements inherit Safety Significant, Safety Source IDs and Source ASIL through exact parent citations. Source ASIL is provenance, not an automatic allocation of an ASIL to a new component. An unallocated safety parent becomes a traceable allocation gap instead of a fabricated requirement or a silent omission.

The safety designation appears in the filterable Table columns and the Outline and Document views, and is retained in document exports and JSON backups. Changes to saved hazard requirements invalidate source freshness before accepting a completed proposal. Existing accepted artifacts are updated through the normal generate/update and review flow.

Validation covers optional absent analysis, minimal projection, duplicate and distinct obligations, paged code rows, source edits before acceptance, and real generation/publication across Projects, code and mixed chains. Live diagnostics use isolated Chrome/Electron profiles and controlled remote-provider responses; they do not make paid AI requests.

Verification results:

- The artifact regression run passed 495 tests in 54 suites. Final gating checks, including unfinished-analysis handling, passed 49 tests in three suites; requirements view/export regressions passed 109 tests in six suites.
- The final production renderer build passed with existing repository warnings.
- Live safety-inheritance checks passed in Chrome and Electron: all three source configurations generated and jointly published specifications, retained exact recorded obligations, inherited safety flags, and displayed them in Table and Outline. Each run used 54 controlled provider responses.
- The no-analysis Chrome check passed all three configurations and verified that no safety requirements, safety designations or missing-safety-allocation gaps were injected (54 controlled provider responses).
- HARA live checks also passed all seven checks in Chrome and Electron, including the CBA method menu.
