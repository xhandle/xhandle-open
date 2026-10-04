# Fix code architecture link navigation

Implement the findings in docs/investigations/code-architecture-link-navigation-review.md. Preserve existing diagrams, saved positions, split views, analysis data, and manual/automatic arrangement behavior outside navigation. Preserve pending working-tree UI changes.

Resolve link targets against current rows using stable trace/node/edge identity, with validated unambiguous fallbacks. A link must reveal the destination, wait for current layout, React Flow measurement, and a successful viewport operation before acknowledging completion. Do not rearrange the diagram merely to navigate. Prevent stale asynchronous layout/focus work and old highlight timers from overwriting newer requests. Keep requests scoped to the active project/repository and make completion callbacks stable and request-specific.

Fix hazard subtab selection and reveal hidden/filtered/collapsed destination rows. Start highlight expiration after a successful scroll, not before the destination mounts. Support repeated and rapid navigation, including links from requirements, design, traceability, remediation, and hazard tables.

Add regression tests for the confirmed failures and integration probes for first-click node/edge navigation, unchanged positions, hidden targets, delayed readiness, rapid/repeated navigation, and cross-tab links. Run targeted tests and browser checks in Chromium and WebKit when available, using isolated synthetic data and no paid analysis. Report results and practical limitations. Do not commit or push unless requested.
