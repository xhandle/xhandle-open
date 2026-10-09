# Resolve disappearing software requirements

Implement the confirmed defects in the software requirements derivation review. Preserve existing uncommitted work and customer data.

Make saved artifact revisions authoritative across IndexedDB and local fallback storage, including empty results, reloads, repeated failures, recovery, and save notifications. Serialize competing writes for a scope. Validate complete chunk manifests and counts; never treat corruption or failed persistence as successful empty results. Surface load/save errors while retaining available rows. Preserve compatibility with legacy arrays and IndexedDB records.

Convert audit reproductions into regression tests, exercise production storage functions and panel notification/reopen behavior, and verify a production build. Document remaining limitations accurately.

Keep the existing derivation inputs, hazard reasoning, and downstream traceability contracts unchanged. The review explicitly separates processed-Functional input selection and a checkpointed generation redesign from this smallest storage correction; do not silently change those semantics. Bound model request duration to prevent indefinite waits, using existing software fallback handling. Do not run live paid AI requests or mutate customer browser data.
