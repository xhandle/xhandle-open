# Projects HARA

Subsequent decision presentation, reasoning checks and goal consolidation are documented in [HARA decision quality — 2026-11-16](hara-decision-quality-2026-11-16.md). That update supersedes the generation and provisional-status behavior described below.

Projects now offers STPA and HARA (ISO 26262). Code-Based Architecture offers STPA and HARA for new analyses; existing FHA records and the internal FHA generator remain readable and supported.

HARA calls the same upstream engine as Projects STPA: functional decomposition, operational contexts, seven guide-phrase variants, applicability, losses, hazards, unsafe control actions, causal scenarios and safety constraints. A vehicle-item scope and item definition are supplied to that engine. A subsequent bounded HARA assessment adds hazardous events, potential harm and exposed persons, separate S/E/C ratings and rationales, safety goals, safe state, FTTI and justification, assumptions, gaps and review status.

The ASIL lookup runs in application code, independently of the model. The 36 nonzero S/E/C combinations were cross-checked against [NHTSA DOT HS 812 574, Table 21](https://www.nhtsa.gov/sites/nhtsa.gov/files/documents/13497a_812574_hydraulicbrakingsystem.pdf). Zero classes produce “Not assigned”; invalid or absent classifications produce “Not assessed”. Shared safety goals inherit the highest contributing event ASIL and remain provisional when evidence is incomplete. Generated assessments require review. The underlying concept-phase reference is [ISO 26262-3:2018](https://www.iso.org/standard/68385.html).

HARA maps STPA plural loss/hazard/unsafe-action/constraint fields explicitly. It does not use the legacy column-alignment fallback that distributes unmatched values into empty cells. Unknown ratings, FTTIs and evidence stay missing and generate review gaps. Model response IDs, completeness and field types are validated; malformed results receive bounded retries, then smaller requests. Successful evidence is checkpointed. No S/E/C defaults or model-provided ASILs are accepted.

Method switching preserves separate STPA and HARA snapshots in the existing durable recovery store. Restoring a revision adopts its method. Stale autosaves from another method are rejected. A switch cannot clear a completed analysis. Method snapshots participate in project backup/deletion and do not clutter ordinary revision history. Manual rating edits recompute event and safety-goal ASIL. CSV retains the existing visible-row export; the HARA workbook exports all event rows, linked safety goals and item definition in separate sheets.

Validation:

- 667 tests passed in 59 relevant suites, including ASIL combinations, unknown/zero classes, goal inheritance, provider failures, source-column aliases, cancellation, method preservation and legacy CBA dispatch.
- Production renderer build and isolated Chrome/Electron UI checks use `scripts/diagnostics/verify-project-hara.cjs`. The UI diagnostic exercises the real generation, storage, edit, export and reload paths with controlled remote-provider responses; it makes no paid AI requests.
- Desktop preview refresh is local and isolated; this change does not publish a desktop release.
