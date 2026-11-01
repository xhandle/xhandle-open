# Retire legacy review overhead while preserving Collaborator

Implement the unfinished review-memory fix in xhandle-open. The Review Center, right-side results-review tray and row review-status badges are retired. Collaborator prompt-based review of table results remains active and must retain its prompts, evidence, decisions and source-table updates.

Trace shared dependencies before changing behavior. Stop automatic per-row legacy review registration, remove retired entry points and avoid loading all historical review records at startup or on tab navigation. Persist Collaborator evidence through bounded, targeted operations that preserve existing history and unrelated records, including on failures and concurrent writes. Keep historical records stored; preserve explicit import/export, backup, deletion and compatible standalone review packages. Do not silently drop stored evidence because the interactive provider no longer holds a full collection.

Preserve active tabs, table editing/filtering/continuous scrolling, diagram controls, and Collaborator review functionality. Add meaningful storage and integration regression tests, run large-data Chrome and Electron checks, and report measured results and limitations. No release, push, desktop update or destructive data migration is authorized by this task.
