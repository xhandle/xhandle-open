# Downstream derivation memory reliability

Investigate and fix avoidable memory retention and allocation during Code-Based
Architecture System Requirements, Subsystem Requirements, and System / Subsystem
Design derivation. Offer's 0.2.14 report records a renderer crash with 4,002,718,309
heap bytes used against a 4,395,630,592-byte limit, while System Requirements was
at 495/5,392. This suggests memory pressure but does not prove the native cause.

Inspect shared storage caches, panel reads, prompt logging, batching, traceability,
checkpointing, and stage lifetimes. Fix reproducible retention/allocation defects
across all affected stages. Preserve model inputs, output quality, safety coverage,
trace links, editing, durable saves, and resumable checkpoints. Do not truncate
engineering evidence or raise the renderer heap limit as a substitute for fixes.

Add focused regression checks and an isolated Electron synthetic workload for all
three stages, including checkpoint reuse, persistence, larger sources, and repeated
use. Measure heap and distinguish peak allocations from retained memory. Preserve
existing uncommitted changes and user data. No publishing or desktop update.
Report verified defects, changes, measured results, and remaining uncertainty about
Offer's crash. Do not claim a customer reproduction from synthetic testing.
