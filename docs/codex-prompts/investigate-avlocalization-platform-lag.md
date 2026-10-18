# Investigate avLocalizationWithOutHDMap platform lag

Review the current xHandle implementation without modifying production code or saved data. Investigate severe lag while opening avLocalizationWithOutHDMap, switching diagram abstractions and tabs, navigating elsewhere, and after completing its 26,278-row STPA analysis. The architecture has 4,981 relationships. The console reported Review Center registration exceeding a storage deadline and hid 18,530 messages. Earlier performance changes were deliberately rolled back; inspect the current implementation.

Trace project loading, diagram construction/layout, hazard table preparation/rendering, global state, review registration/persistence, and background cleanup. Identify repeated scans, serialization, allocation, unbounded queues, unnecessary offscreen work, and missing lifecycle cleanup. Distinguish storage waiting from main-thread delays.

Reproduce suspected paths using the actual source and safe synthetic fixtures. Report measurements, fixture sizes, and limitations. Where possible profile opening, abstraction/tab switching, leaving the project and idle, comparing a small project and DevTools open/closed. If the actual browser or dataset is unavailable, explicitly distinguish measured synthetic behavior from hypotheses about the user's session. Do not call paid providers or rerun analysis.

Deliver ranked findings with file/line references, explain the review timeout, recommend targeted fixes and acceptance tests. Save the findings. Do not implement fixes, delete data, commit, or push.
