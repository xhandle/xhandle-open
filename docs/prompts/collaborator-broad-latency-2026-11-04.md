# Investigate and improve Collaborator retrieval latency

The user reports slow responses for ordinary prompts across browser and Desktop, not just greetings. The longest visible stage is “Retrieving the most relevant project and architecture context.” The selected provider/model is context for diagnosis, not a reason to special-case a provider or change preferences.

Trace and improve local preparation before the AI request. Preserve Collaborator's access to saved projects, CBA tables, hazards, reports and source evidence; review prompts and existing actions must keep working. Do not trade accurate scope, provenance, current/history isolation, deletion safety or bounded memory for speed.

1. Profile actual IndexedDB and workers using disposable synthetic Chrome/Electron profiles. Separate first index, incremental refresh, warm retrieval, planner, and provider time. Retain failed measurements and state limitations.
2. Remove demonstrated redundant storage/index work and batch bounded writes. Preserve checksum, revision and cancellation checks.
3. Allow provably focused read-only lookups to prepare the necessary source domains without waiting for unrelated source/hazard indexing. Broader questions must still prepare broader data. Partial-domain preparation must not masquerade as a complete workspace index.
4. Make background preparation yield to foreground retrieval safely, retaining completed domain checkpoints and serializing with permanent cleanup. Protect shared source ownership and verification links.
5. Avoid extra planner requests for deterministic local lookups and duplicate samples in exact-count prompts. General explanations must not need saved data; ambiguous saved-data questions must retain grounding.
6. Run focused integrity/concurrency/deletion regressions, broader relevant tests, production build, and actual App journeys in Chrome and Electron. Use local mocked providers to validate preference preservation; do not spend on live AI calls or read customer profiles.
7. Report measured improvements and remaining bottlenecks honestly. Do not commit, push, package or publish a desktop update.
