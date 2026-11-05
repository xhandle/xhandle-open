# Collaborator overview routing and prompt deduplication

Implemented recommendations 1 and 3 from the latency/quality review using [this implementation prompt](../prompts/collaborator-overview-prompt-optimization-2026-11-05.md). Other pending work was preserved. No external AI request, release, commit or restart of the user's existing preview was performed.

## Changes

- Clear ordinary overviews of one named/current project reuse the existing conservative overview resolver before contacting the model. They retrieve the existing bounded, fresh overview evidence and make only the final answer request. This removes the otherwise redundant initial AI interpretation request and its possible format-repair request.
- Single plain-text pasted overviews follow the same route. Ambiguous names, extra attachments/selections, domain restrictions, detailed questions and follow-ups needing interpretation retain the existing governed route. Provider, model and reasoning settings are unchanged.
- Targeted read evidence is fitted once before building the final system message. The graph sample drops a record only when the same project/source identity, known version/revision/timestamp and all projected fields survive in that fitted evidence. Matching IDs alone do not suffice. Unique citation fields and differing records remain.
- The overview sample is removed from graph diagnostics only when its full, exact serialized content is already in the fitted read evidence. If the other copy was trimmed, the graph copy remains when it fits its existing budget. Coverage and other diagnostic status remain available. No smaller evidence budgets or new caches were introduced.

This is conservative deduplication between the graph sample and final read evidence, not wholesale rewriting of every repeated field inside source records. It does not broaden the existing overview sample into an exhaustive audit.

## Validation

- **238 tests passed across 10 suites**, covering routing, storage reads, graph synchronization/context, transport, budget fitting and prompt rendering. New cases cover pasted/typed equivalence, ambiguity, deletion, domain restrictions, record-version differences, budget-trimmed counterparts, unique fields/citations and exact overview duplication. Existing cancellation and exact-count safeguards remain covered.
- The first broad test run overlapped a production build and hit the existing five-second timeout in one graph-sync test. The sequential rerun passed all tests without changing that timeout or application behavior.
- Optimized production build passed with existing lint warnings; no warning was reported for the new overview/deduplication helpers. Build output: `/private/tmp/xhandle-overview-optimized-build`.
- **15 acceptance scenarios passed in Electron and 15 in Chrome**, using disposable profiles, synthetic data and a local mock AI endpoint. External network requests were blocked. The pasted overview was submitted through an actual composer paste event.
- Both ordinary typed and pasted overviews produced exactly **one `collaborator.answer` request**, with the architecture evidence sentinel appearing **once** in the final request. No routing, repair or read-planning AI call preceded these overview answers.
- General questions completed while the workspace storage lock was deliberately held. Data-dependent questions waited and reported the storage wait. Detailed technical questions retained their read planner; a non-shortcut interpretation/repair case still recovered. Exact counts retained complete coverage. No foreign-project evidence or uncaught runtime errors was observed.
- The prompt-rendering regression verifies a smaller combined prompt while retaining unique fields, citations and partial-coverage information. Native request metrics are recorded in [the acceptance summary](collaborator-overview-prompt-optimization-2026-11-05.json).
- `git diff --check` passed.

These tests establish fewer requests and less duplicate prompt content. They do not measure live-provider speed or guarantee identical model wording. The existing partial overview uses up to 24 saved functional relationships; those evidence limits were not reduced. The broader technical-read indexing and cache recommendations remain separate work.
