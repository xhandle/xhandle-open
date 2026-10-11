# Implement CBA HARA/FHA workflow reliability

Use docs/investigations/cba-hara-fha-workflow-review.md as the audit baseline. Read first and scope execution changes to Code-Based Architecture. Preserve Projects behavior and method-specific reasoning; do not apply STPA command/control screening to HARA or FHA.

Preserve each input relationship and operational-context identity through prompts, results and software-requirement derivation. Forward cancellation through all requests and stop publishing after cancellation. Retry missing or malformed rows automatically with bounded retries; never manufacture completed hazards or ratings from missing responses. Checkpoint validated work with input/context-specific keys so continuation can reuse successful work. Isolate previous preprocessing by method. Preserve explicit uncertainty separately from transport failure.

For HARA, retain system safety goals and obtain a distinct software allocation and verification instead of merely renaming a system goal. Prevent unresolved placeholders becoming software requirements. Add real-generator regression tests for both methods, context propagation, cancellation, failure, checkpoint reuse and downstream provenance. Run relevant existing tests and production build. Report remaining limitations without claiming live-model or standards validation. Do not commit or push.
