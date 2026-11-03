# Same-project browser/desktop performance report

The user reports near-instant diagram/table/tab interaction in Chrome and slower interaction in the current local Electron preview, using the same imported project. This is a manual acceptance finding that the earlier synthetic diagnostics-overhead tests do not resolve. On November 3, the user explicitly excluded this gap as a blocker for the current release; track it separately while preparing the release.

Read-only checks on the running preview found:

- No shared source files newer than its compiled frontend; the preview is not obviously using an old frontend. Chrome serves the development bundle and the preview serves the production build, so the bundles are not byte-identical.
- Chrome 156.0.8078.79; preview Chromium 156.0.8078.48 / Electron 45. GPU compositing, rasterization, WebGL and related acceleration are enabled in the preview. These checks rule out neither runtime bugs nor compositor differences.
- The preview's renderer previously peaked at 3,450,048 KiB working set (approximately 3.29 GiB). Its reported JS heap was approximately 802 MB while a table was displayed, and approximately 1.03 GB with a diagram displayed. These are observations, not post-GC retained-heap or leak measurements.
- Recorded diagrams reached 4,907 nodes / 3,754 edges, and 4,049 nodes / 3,875 edges—larger than the latest synthetic 1,504-node comparison.
- The flight recorder reported approximately 8.07 GiB system swap in use on the 8 GiB host. This is system-wide and cannot be attributed entirely to xHandle.
- Recorded requirements reads took 111.5 ms (10,346 rows) and 338.9 ms (153 rows). There were no error/failure entries in the sampled journal. Existing diagnostics do not cover every worker/storage/rendering path, so silence does not establish that every path is healthy.

A temporary 100 Hz renderer CPU profile and bounded long-task/input observer ran for approximately 50.7 seconds, then stopped and detached automatically. It captured **zero click, wheel, keydown or pointerdown events**. It was predominantly idle and cannot identify the reported interaction bottleneck. No application source or saved project data was changed by this investigation. Raw trace: `/private/tmp/xhandle-current-preview-rvq5p7/interaction-cpu-profile.json`.

The existing Chrome process exposes no local diagnostic listener, so an equivalent live Chrome CPU trace was not obtained. Next evidence needed: an active Electron trace while reproducing the slow tab/scroll/diagram interactions, followed by the equivalent Chrome interaction trace or timed comparison. Separate cold/paged-out activation from repeatedly slow interaction, and distinguish JS/render work, storage/worker preparation, GPU paint, and system paging. Do not infer a confirmed root cause from system swap or a quiet CPU trace.
