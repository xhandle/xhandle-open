# Fix follow-up project transfer findings

Fix all three findings in portable-project-transfer-followup-review-2026-10-24.md. Accept legitimate architecture run/history aliases while enforcing project ownership and chunk hashes. Validate nested ready-to-publish rowRecord/runRecord references on export and import without hydrating the entire analysis. Extend requirement checkpoint acceptance to task-specific complete source/parent coverage, including hazard-derived system requirements and consolidation paths; reject old incomplete cached responses while retaining complete-response reuse.

Convert all reproduction probes into correctness tests. Test real publication, history, recovery round trips, malformed archives, and continuation after transfer. Run relevant regressions and a production build. Document results and remaining manual validation needs. Preserve unrelated work; do not commit, push, or release.
