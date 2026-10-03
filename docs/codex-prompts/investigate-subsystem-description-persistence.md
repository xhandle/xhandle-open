# Investigate subsystem description persistence

Investigate the report that subsystem descriptions generated with the functional diagram modal's magic button do not always survive reloads.

Trace generation, modal draft state, Save/Cancel behavior, group metadata, debounce and storage durability, reload hydration, automatic category reconciliation and Auto arrange. Check manually created and imported/generated subsystems, including subsystems within systems. Reproduce suspected failures using isolated fixtures and mocked AI responses; do not call a paid model or modify customer projects.

Distinguish confirmed defects from expected unsaved-draft behavior and unconfirmed risks. Check whether current tests actually cover persistence rather than just prompt construction. Preserve all existing uncommitted work. This is an investigation: do not change application implementation or commit/push. Record a reproducible diagnostic, source locations, findings, and a narrowly scoped repair recommendation under docs/investigations.
