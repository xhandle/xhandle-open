# Implement the diagram search navigator

Extend the existing Quick Search opened by Ctrl+F, Cmd+F, and the Search button. In Code-Based Architecture and project diagram views, show a compact browsable glossary immediately, without requiring a query. Keep the existing table and diagram text search.

Use the diagram's existing model and navigation. Group entries by applicable abstraction/type (System, Subsystem, CSCI, CSC, CSU, Function, Note, Connection), with expandable sections, counts, and parent context to distinguish duplicate names. Clicking or pressing Enter on an entry must center and highlight the correct element without rearranging or changing project data. When a CBA element is omitted by the selected abstraction, reveal its appropriate abstraction and wait for the rendered target before focusing. Respect file filters and the active diagram; do not enumerate unrelated projects or inactive tabs.

Keep the navigator lightweight: collect only when search opens, use indexed endpoint/parent lookups, render a bounded window of entries, and allow all entries to be reached without a first-100 cap. Retain keyboard navigation, focus restoration, IME handling, modifier release, and isolation from canvas delete shortcuts. Cancel pending navigation when the diagram scope changes or unmounts. Work in the shared React code for both browser and Electron.

Preserve existing work, including the 15% zoom experiment and hazard loading changes. Add focused regression coverage for browsing without typing, filtering, duplicate labels, offscreen targets, abstraction switching, large-list reachability, stale scopes, and existing table search. Run relevant tests and a production build. Report validation and any untested real-device behavior. Do not publish a desktop update.
