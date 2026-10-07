# Implement Functional CSCI/CSC decomposition

Implement the findings in docs/investigations/functional-csci-csc-decomposition-review.md. Preserve the existing Functional abstraction and detailed source analysis.

Create an evidence-grounded, bounded hierarchy allocation stage for all generated Functional responsibilities, including canonical and model-extracted relationships from either GitHub or local sources. Generate Subsystem → CSCI → CSC → Function ownership, with cohesive component responsibilities and configuration boundaries rather than directory prefixes or forced group counts. This Functional allocation must not be bypassed because upstream detailed classification used a fallback or exceeded 300 rows. Keep requests bounded, validate complete membership, retry/split recoverable malformed results, support cancellation, and publish atomically. Do not multiply detailed extraction requests or rewrite the raw call inventory to solve a derived presentation problem.

Resolve endpoint allocations consistently by exact file/symbol, prefer explicit endpoint ownership, and do not infer destination ownership from callers. Surface conflicting ownership evidence to allocation. Preserve source/function/interaction IDs, labels, row coverage, hazard eligibility, and supporting traceability. Keep existing analyses readable; offer a hierarchy-only upgrade for saved Functional models without rerunning responsibility generation. Persist hierarchy through the existing revision-checked storage path. Ensure changed hierarchy gets a fresh layout without deleting old layouts.

Expose source and destination Subsystem/CSCI/CSC in the Functional table, clipboard and CSV. Retain filtering, navigation, split view, virtualization and export behavior. Do not reintroduce redundant CSU wrappers or removed informational banners.

Run meaningful regression tests for multi-component and cross-component ownership, >300 inputs, language/source neutrality, malformed responses/cancellation, reload/upgrade, stable downstream identities, and table/export parity. Run the production build and report changes, validation, and limitations. Do not commit or push.
