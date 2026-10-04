# Code architecture link navigation fix

Implemented the prompt in `docs/codex-prompts/fix-code-architecture-link-navigation.md` following the navigation review.

## Changes

- Resolve current node/edge identities using trace IDs, stable element IDs, and unambiguous interface/file fallbacks. Stale row positions no longer take precedence. Reject ambiguous or missing destinations instead of selecting unrelated rows.
- Use one cancellable focus request for local and external links. Completion requires layout readiness, the detailed destination view, measured endpoints, and a successful synchronous viewport fit. Unsuccessful attempts never acknowledge completion. Completion handlers are stable and tied to the specific request.
- Remove clean/arrange requests from link navigation. Guard asynchronous layout commits against changed graphs, superseded work, and unmounts; preserve current selection when applying a valid layout.
- Rebuild containers around saved function coordinates when restoring a diagram for navigation. Block unmount writes before position hydration, including React StrictMode's initial cleanup, which previously replaced saved positions with an empty map.
- Scope active diagram/artifact requests and functional/hazard row highlights to their originating workspace. Cancel component-local retries on unmount.
- Hazard row navigation selects Hazard Analysis even when Safety Remediation was previously selected. Reveal filtered rows, other operational contexts, and collapsed groups before scrolling.
- Repeated table-row links carry distinct request keys. Start highlight expiry after the destination mounts and is scrolled into view. Older completion timers cannot clear a newer request.

Existing menu/UI changes in the working tree were retained. No paid analysis was run; no commit or push was performed.

## Validation

- 61 tests passed across seven targeted suites, covering target resolution, cancellation, delayed readiness, current callback use, repeated row links, hidden/collapsed/context-specific rows, table behavior, menus, and artifact generation.
- Six controlled probes of the actual source callbacks passed: delayed measurement/layout, unsuccessful viewport fit, missing edge endpoints, hazard subtab selection, stale layout protection, and request-specific expiry.
- Chromium and WebKit checks passed in isolated synthetic workspaces: first/repeated function links, rapid source/target clicks, control-action links, and stale-ID links from Software Requirements, System Requirements, Subsystem Requirements, and System / Subsystem Design. Saved function coordinates remained unchanged across those links; hazard links selected the correct subtab. No page errors were recorded.
- ESLint: zero errors, existing warnings. `git diff --check` passed.

Run current browser checks with `scripts/diagnostics/verify-code-architecture-link-navigation-browser.cjs` (set `XHANDLE_PLAYWRIGHT_PATH`, `XHANDLE_CHROME_PATH` for Chromium, and `XHANDLE_BROWSER=webkit` for WebKit). Run controlled callback checks with `node scripts/diagnostics/verify-code-architecture-link-navigation.cjs`. The `review-*` scripts are historical pre-fix reproducers, not current passing regression checks.

## Practical limits

Browser checks used small synthetic repositories, not the customer's complete project or a production Safari installation. Saved function coordinates are restored; container bounds are reconstructed around them, consistent with the existing coordinate-only persistence format. Deleted/ambiguous references remain unresolved, and focus retries stop after approximately 30 seconds without falsely reporting success. No changes were made to analysis generation or data formats.
