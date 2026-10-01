# Review lag in large functional diagrams and hazard tables

Review the current implementation to determine why interaction slows down as projects grow. Do not fix application code in this review.

Scope:
- Functional diagram initialization, node/edge rendering, selection, dragging, group/system reconciliation, routing, selection notifications, and persistence.
- Project hazard tables (draft and completed), filtering, selection, editing, column/row sizing, and tab switching; inspect shared app rendering and relevant code-architecture tables.
- Recent quick search: distinguish cost while closed, opening, typing, and selecting a result.
- Storage writes, history serialization, event listeners, and effects triggered by otherwise small interactions.

Use source inspection plus reproducible measurements on isolated synthetic projects. Compare small and larger datasets, record DOM/editor counts and interaction/long-task timings, and collect CPU evidence where possible. Do not access or modify the user's browser profile/projects, call paid AI services, or infer a runtime bottleneck from a loop alone.

Save reproducible diagnostics and a report under docs/investigations. Rank confirmed bottlenecks and distinguish source-level risks, environmental effects, and measurement limitations. Recommend targeted fixes that preserve click-to-edit, text-based row heights, saved diagram layouts, systems/subsystems, filtering, restore/history, and persistence. Explain whether search contributes to ordinary lag. Do not commit or push.
