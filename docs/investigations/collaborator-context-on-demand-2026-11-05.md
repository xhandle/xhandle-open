# Collaborator context on demand

Implemented [this prompt](../prompts/collaborator-context-on-demand-2026-11-05.md) from the [intent-routing review](collaborator-intent-routing-review-2026-11-04.md). This changes the pending shared application code; it does not publish a desktop release or replace the user's installed app.

## Behavior

Ordinary messages now reach the selected model with bounded recent conversation, supplied attachments and lightweight current-view metadata before any workspace graph preparation. The first streamed response can be the complete answer, a clarification, or a validated request for specific saved-data domains. Direct answers do not require a second model request. Internal request JSON is not displayed.

Saved-data requests prepare only the requested index domains and use the existing governed read policy, coverage and source links. Straightforward counts and lists retain their deterministic shortcut. Invalid requests fail without falling back to a whole-workspace scan. Model-supplied references must quote earlier user text; the original current request still controls project/history policy. Some legacy stores contain multiple domains, so preparing one domain can still scan a shared store; this is not a claim that all saved-data reads have constant cost.

App no longer builds a large legacy workspace context during every render for Collaborator. Specialized functional workflows receive a lazy provider. The ordinary envelope distinguishes the architecture dashboard, project detail, the selected architecture tab and full-page Collaborator, and excludes hidden selection bodies.

Conversational rewriting is separated from explicit saved-record commands. An implicit yes/no applies only to the immediately preceding pending proposal. Topic changes and intervening cancelled turns invalidate implicit consent. Explicit Apply still validates the exact stored card and thread, followed by the existing source validation and execution checks. Hazard/functional review card controls remain available; an unrelated next message is no longer consumed as custom review scope.

Provider, model and effort preferences are retained. The application has not gained a live weather or web-search tool; the ordinary-response instructions state that limitation. Timing metadata records the context-turn workflow without storing prompt or record bodies.

## Verification

- Jest: 239 tests across 12 relevant suites, covering routing envelopes, bounded attachments, malformed/unsupported requests, conversational references, scope restrictions, streaming, saved actions, read/index integration, and hazard/functional review sessions.
- Optimized production build succeeds. The repository still emits its existing lint warnings; the build was run with `CI=false`. A prior `CI=true` build rejected those warnings, rather than a compilation error.
- Actual optimized Chrome App: project-panel and full-page routing journeys passed with a deliberately held workspace mutation lock. Greetings, weather, screen orientation, recursion, engineering explanations, translations and shortening completed before storage was released. They sent no fresh synthetic saved-record marker. Invalid tool requests also avoided storage. A named-function question waited for saved-data preparation (and clarified project scope when no project was selected); a requirements count included verified complete-count evidence.
- Actual optimized Electron App: architecture-dashboard routing journey passed under the same blocked-storage conditions with an Anthropic model/medium-effort fixture. Chrome used an OpenAI model/high-effort fixture. These verify preference propagation through the shared adapters, not external provider behavior.
- Actual Electron proposal journey: unrelated conversational yes left the old synthetic requirement edit unapplied; explicit Apply performed it; immediate no cancelled a new pending proposal.
- Actual Chrome and Electron broader journeys: direct conversation, deterministic report list/count, deferred automatic title, source navigation, Stop during a thread switch, subsequent thread usability, report reopening after reload and confirmed report deletion all passed.
- `git diff --check` passes.

The regression scripts are in `scripts/diagnostics/collaborator-acceptance/`: `context-on-demand.cjs`, `confirmation-binding.cjs`, and `full-app.cjs`. They use disposable profiles, synthetic records and a local mock provider, with external network requests blocked. Compact [test evidence](collaborator-context-on-demand-2026-11-05.json) is saved beside this report.

## Limits and next validation

The native tests establish application dependencies and control flow. They do not measure live model routing accuracy, provider latency or performance on the customer's large workspace. Mock responses deliberately choose answer/read/error routes; unit tests validate attachment and mixed-domain envelopes, but do not establish real-model judgment on those prompts. A model can still choose an unnecessary supported read or fail the structured protocol; invalid output produces an error rather than a broad fallback. Complex saved-data questions can require the first response, a targeted read plan and a final answer.

The next user check should exercise the updated local preview with the chosen provider: unrelated general questions, current-screen questions, rewrites, attachment-only questions and genuine saved-data questions. Verify time to first visible answer and correctness together. This implementation removes the confirmed unconditional retrieval dependency; it cannot guarantee instant responses or absence of every regression.
