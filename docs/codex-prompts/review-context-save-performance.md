# Investigate context-save latency

Perform a read-first investigation of lag when saving context, especially with large tables. Start with Code-Based Architecture hazard operational contexts and compare Projects operational contexts. Do not modify production code or customer data.

Trace the modal save callback through context assignment, persistence, change-event listeners, run reloads, review matching, table transforms, and rendering. Distinguish imported/preprocessed analyses from generated analyses and unchanged saves from actual edits. Check whether an originating save reloads itself and whether reload alignment reads the old context before the new context is durable.

Use synthetic fixtures at several row counts to measure existing context-assignment code and any identified expensive operations. Separate measured synchronous work from unmeasured browser storage and React rendering costs; do not claim a customer reproduction from a synthetic benchmark. Run existing context regression tests.

Report ranked findings with file/function references, scaling behavior, validation results, and a minimal recommended fix sequence. Preserve applicability decisions, context ownership, project/repository isolation, persistence failure handling, and existing hazard reasoning. Do not optimize by discarding rows, skipping necessary context alignment, or closing the modal before a failed save can be reported.
