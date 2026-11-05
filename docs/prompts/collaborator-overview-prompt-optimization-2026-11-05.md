# Implement overview routing and lossless prompt deduplication

Implement recommendations 1 and 3 from the Collaborator latency/quality review. Preserve pending unrelated work. Do not change provider/model/effort, publish a release, or send project content to an external AI service.

Reuse the existing conservative overview resolver before the initial AI context-routing call. An unambiguous ordinary overview of one named/current project should retrieve the same bounded, fresh catalog/source evidence and make only the final answer request. Typed and single plain-text pasted prompts must behave equivalently. Ambiguous names, detailed questions, domain restrictions, mixed attachments/selections and follow-ups requiring interpretation must retain the governed fallback. Preserve cancellation and source failures.

Fit targeted read evidence before deduplicating the graph prompt against it. Remove only information demonstrably present in the final serialized targeted evidence. Preserve unique fields, differing revisions, citations and partial/stale coverage; never remove a graph record on the assumption that its counterpart will survive a later budget trim. Avoid duplicate overview samples. Keep evidence/history limits and memory bounds.

Add meaningful regressions for routing, pasted inputs, ambiguity, restrictions, exact counts, evidence retention and budget boundaries. Exercise the optimized application in disposable Chrome and Electron profiles with a local mock provider, verifying request counts, evidence and runtime errors. Report measured prompt-size/request-count improvements separately from unmeasured live-provider latency. Do not restart the user's existing preview without need.
