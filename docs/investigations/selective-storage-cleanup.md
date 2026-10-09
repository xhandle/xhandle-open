# Selective storage cleanup

Settings > Storage now expands categories into pages of 50 logical stored records. Users can select records across pages, collapse categories without losing selection, or select an entire category. Category checkboxes show a partial-selection state. The existing Delete Selected confirmation identifies entire categories versus individual-item counts. Credential values are never displayed.

IndexedDB deletion waits for transaction completion and reports failures instead of silently claiming success. Hazard-run payloads and their metadata entries are deleted together in one transaction. Local-storage selections remove only selected keys. Refresh discards stale record selections. Selection operates on stored records/keys, not individual cells within an analysis payload.

Large encoded records appear as one logical item; internal chunks are hidden and skipped during pagination. Individual deletion retains chunks because saved recovery records may still reference them. Entire-category deletion clears all chunks in that store. This deliberately avoids invalidating other saved recovery records; individual deletion may therefore reclaim less physical storage than the logical record's full size.

Validation:
- `node scripts/diagnostics/verify-storage-category-items.cjs`: passed native Chromium IndexedDB paging (125 records across three pages), hidden chunks, selective deletion, preservation of other records, and paired payload/index cleanup.
- The same diagnostic renders Settings with synthetic local-storage fixtures and verifies selecting/deleting one item preserves its unselected sibling.
- Browser tests use a fresh isolated context and block API requests; no user records were deleted.
- `npm run build`: passed with warnings.
- `git diff --check`: passed.

## Readable item names

Storage item labels now resolve project names from the active/retained project lists, repository names from small sibling analysis metadata, and record purpose from recognized key types. Available timestamps appear as saved dates. Raw UUIDs and storage keys are kept internally for selection/deletion but are no longer rendered. Unidentified records use the category and a stable page-relative item number; no project identity is invented. Listing does not hydrate chunked analyses.

Three label regression tests pass, and the native browser diagnostic now selects a readable project label and confirms only its underlying storage key is removed.

## Workspace reconciliation after deletion

Cleanup now invokes the application state owner after each successful category operation. Clearing Code architecture analysis removes the Code-Based Architecture workspace list. Deleting a specific decomposition root removes only its repository; the project is removed when no repositories remain. Metadata, checkpoint, and layout deletion do not remove projects. Existing repository files are untouched. The category description explains this behavior before confirmation.

React project lists now reload from the updated registry, and deleted active architecture selections, tables, and hazard results are cleared. Deleting the local project registries also updates their sidebar state. Hazard-store deletion emits its normal reload event. This prevents a render-only broadcast from leaving stale project entries visible.

Six targeted tests passed; production build passed with warnings. Earlier category deletions did not change the project registry; clearing the category again applies the new workspace reconciliation without guessing which previously empty projects were intentionally created.

## Reload verification

Startup now treats an explicitly stored empty architecture project list as intentional and only migrates legacy repository settings if the registry is absent. Deleting the registry itself stores an empty list to retain that distinction.

`verify-storage-cleanup-reload.cjs` passes against the actual App and Settings UI in an isolated browser: seed three projects and legacy repository settings, delete the entire architecture category, verify the sidebar entries and registry disappear, reload, verify the registry stays empty. Seven unit tests pass. The user confirmed the reported three remaining entries followed refresh only, without repeating deletion; the old deletion's leftover registry is not automatically purged.
