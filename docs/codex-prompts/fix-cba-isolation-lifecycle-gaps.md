# Resolve remaining architecture persistence and refresh gaps

Implement the follow-up findings in docs/investigations/cba-isolation-fix-completeness-review.md. Read the full caller paths before editing and correct any inspection-only finding whose stated trigger is not reachable.

Coordinate architecture edits, imports, and publication per project/repository so a save already queued before publication cannot replace the newer result. Settle queued edits before selecting the generation baseline, retaining atomic revision checks and checkpoint conflict protection. Ensure unsuccessful analysis after A/B/A navigation rehydrates the correct last published rows, including cancellation and publication conflict. Explicitly refresh the target scope after successful import, including unchanged-scope completion, and avoid duplicate repository IDs without changing the existing import destination policy.

Convert audit defect tests into regression tests that require correct behavior. Cover delayed open/hash operations, independent scopes, failed writes, successful publication, failed-run navigation, and import destinations. Run targeted tests and a production build. Do not delete or guess ownership of historical data, modify analysis reasoning, run paid analysis, commit, or push. Report validation and remaining limitations.
