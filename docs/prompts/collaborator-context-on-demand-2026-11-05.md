# Implement Collaborator context on demand

Implement the findings in collaborator-intent-routing-review-2026-11-04.md. Preserve pending work and existing functional/hazard review capabilities. Do not publish a desktop release.

Replace universal retrieval with a provider-neutral first response that either answers from bounded conversation, attachments and current-view metadata, clarifies, or requests scoped read-only workspace evidence. This is not a compulsory classifier followed by an answer request. Validate requests outside the model; preserve selected provider/model/effort, project/history restrictions, citations, cancellation and bounded reads. No unknown-intent full-index fallback. Do not expose routing JSON or fabricate external lookup capabilities. Keep reliable explicit workflows and deterministic saved-data counts.

Remove eager parent workspace hydration; use lightweight view descriptors and lazy providers for specialized workflows. Resolve conversational rewriting independently of workspace mutation. Bind implicit confirmation to the current proposal and exact thread/card revision; topic changes must prevent unrelated yes/no from applying or cancelling old proposals. Preserve explicit card controls and source validation.

Add regression gates for general questions, weather, paraphrases, current view, thread rewriting, attachments, mixed requests, scoped saved records/counts, invalid tool requests, blocked storage, stale confirmation, cancellation and provider parity. Exercise optimized browser and Electron using disposable profiles and mocked providers. Report limitations honestly: mocked checks establish dependency behavior, not live model quality. No credentials or customer records in artifacts.
