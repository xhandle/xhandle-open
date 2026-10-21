# Saved hazard tab entry fix

Executed fix-hazard-tab-entry-lag.md.

Changes:
- Large saved runs first mount a lightweight xHandle progress shell. Row normalization runs in 100-row batches after a frame; functional metadata/freshness checks run as subsequent preparation stages rather than inside the initial panel render.
- Normalization reuses the same row-identity algorithm as the synchronous path, including legacy missing-ID behavior.
- One latest prepared snapshot is retained for warm tab entry; cache keys include summary identity, project/repo/run and freshness inputs. Input changes/unmount cancel scheduled work. Metadata-only updates reuse preparation.
- Initial layouts above 5,000 entries prepare row-height estimates in batches. Existing mounted-table updates retain synchronous reconciliation to preserve scroll anchors, selection and focus. Small tables retain their immediate path.
- Saved preparation uses the first 70% of the indicator; table layout completes the remaining portion. Percentages reflect completed batches/stages, not elapsed-time animation. First storage loading has an icon without an invented storage-read percentage.
- Moved the architecture-readiness notice out of App's pre-panel render path. Existing displayed runs remain mounted on edits/imports/partial updates rather than being replaced by an entry loader.

Tests cover a real 26,278-row panel/table entry, one initial indicator, windowed DOM, warm re-entry, cancellation/project changes, unchanged identity behavior, initial distant navigation, StrictMode navigation, scrolling, resizing and edits.

The broader run found three existing hazardCompletionPublicationAudit.test.js failures: expected one final save call, observed two. They reproduce with the original HEAD normalization implementation restored temporarily; the working version was restored afterward. This test belongs to publication recovery and was not modified to hide the failures.

Limits: this is not a live Safari timing reproduction. Architecture metadata checks still run as individual preparation stages; batching all architecture hashing would be a separate optimization if real-project profiling identifies it as the remaining bottleneck. The fix makes saved-entry feedback available before these stages and chunks the large row work, but does not promise every browser/storage operation is instantaneous.

Final validation: 61 suites / 582 tests passed with the known publication-audit suite excluded. Its three existing failures remain documented above. Production build passed with warnings. git diff --check passed. No commit or push performed.
