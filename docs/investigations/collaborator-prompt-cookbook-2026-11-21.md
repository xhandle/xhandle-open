# Collaborator Prompt Cookbook — 2026-11-21

Executed prompt: [collaborator-prompt-cookbook.md](../codex-prompts/collaborator-prompt-cookbook.md).

## Behavior

Open Collaborator's **+ → Prompt Cookbook** in either docked or full-screen mode. With focus inside the composer, **Cmd/Ctrl+Alt+P** opens the same panel. Browse and search the 21 existing examples, filter their four categories, inspect each task's effect, and edit its prompt. **Use prompt** appends to any existing conversation draft; it does not send a message, discard attachments or apply changes.

**Help me write a prompt** accepts a goal and explicitly requests a suggestion through the selected provider/model/effort and existing chat transport. Suggestions are based on the shared cookbook, the user's goal and bounded current view/project/method/selected-reference metadata. The helper does not retrieve source files, read attachment bodies, inspect saved workspace contents or execute the proposed task. A clarification can request one missing detail. Requests that belong in analysis/report controls can redirect to those controls. The user reviews and edits a suggestion, then uses the existing Send action.

Browsing does not call a provider. The existing draft remains intact on close, error, cancellation or invalid responses. Pending requests are cancelled and late replies discarded after closing, changing the goal/context/tab or switching conversations. Finished suggestions become unusable if their scope or goal changes. Full-screen conversation context does not inherit a hidden project's last tab or method.

## Implementation

- `src/features/collaborator-prompts/catalog.json` is the shared recipe data. README, browser/search and suggestion instructions use the same catalog.
- `promptCookbook.js` bounds metadata and inputs, constructs the provider-neutral drafting contract, validates known recipe identities and response types, and appends prompts without replacing existing text.
- `PromptCookbookPanel.jsx` provides the accessible, themed, responsive dialog, editable drafts, explicit provider requests, cancellation and focus management.
- Both existing `CollaboratorPromptComposer` layouts use the same integration. Other composer/voice/provider controls retain their existing behavior. App focus supplies the current hazard method as metadata.
- A `cookbook` category was added to the Electron regression harness. Its provider responses and workspace are synthetic; no live paid-provider calls or private-data are needed.

## Validation

Focused tests: **209 passed** across cookbook protocol/panel, README, composer and current-view context tests.

Final regression run: **all nine selected categories passed** in `/private/tmp/xhandle-cookbook-verified-20261121/report.json`: frontend, backend, production build, fixtures, native startup smoke, populated workspace, appearance, Collaborator current-view behavior and cookbook. This was a selected regression run, not a rerun of all 20 available categories.

- Frontend: **4,537 passed, zero failed**, four standard skips (497 passing suites, two skipped suites).
- Backend/diagnostic helpers: **141 passed**.
- Cookbook Electron workflow: **10 checks passed**, including both layouts, editable insertion, retained attachments, explicit model calls, metadata boundaries, failures, clarifications, changed goals, cancellation, unsupported tasks, unchanged saved records and narrow viewports.
- Cookbook appearance: **3 screenshots/audits**, no sampled text/field contrast failures or unexpected bright panels. Representative actual screens were visually reviewed.
- Shared and native source fingerprints stayed unchanged during the final run. Shared fingerprint: `241dae3e19ab2b0d9126a3a78e8d12d192071208508533995f5bc1a711ebeea9`.

Cookbook evidence and screenshots: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-cookbook-live-rnskTu/result.json`. Provider responses are controlled test fixtures; no live model or external workspace was used.

Model selection and drafting quality with live provider models has not been benchmarked. Controlled responses test the integration and its boundaries; they do not establish that every suggested prompt or subsequent engineering answer is correct. Prompt suggestions remain editable and existing application validation/review paths still govern execution.

No commit, push, version bump or desktop publication is included. Earlier unrelated local files remain intact.
