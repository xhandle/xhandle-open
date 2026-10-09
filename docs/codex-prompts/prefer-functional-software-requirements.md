# Prefer the Functional table for software requirements

Use the generated, current Functional view table as the input to software requirements derivation whenever available. Fall back to current CSU rows only when no valid processed Functional model exists. Apply the rule in the shared derivation entry point and the UI source count, for both GitHub and local projects, including saved/reloaded and imported Functional models. Do not use UI column filters to discard input.

Preserve functional relationship IDs and supporting CSU evidence through generated requirements and downstream traceability. Retain node-only functional responsibility rows rather than applying hazard-only interaction filtering. Do not regenerate or rewrite existing saved requirements automatically, and leave hazard generation and persistence behavior unchanged.

Test ready, missing, stale, and reloaded Functional models, source-provider parity, model request inputs, and trace resolution. Run relevant regression tests and a production build. Report the change and validation honestly; do not run paid model requests.
