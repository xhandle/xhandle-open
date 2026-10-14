# Review and implement a resilient hazard-run completion policy

Review the active code-based STPA/HARA/FHA pipeline. Separate workflow completion
from evidence sufficiency and provider success. Preserve all successful work and
governed human decisions. Use the ordinary pipeline, not a separate demo mode.

Trace unresolved applicability, malformed responses, exhausted provider retries,
truncation, storage failure, explicit cancellation and browser lifecycle interruption.
Do not promise completion despite a terminated browser/process or deliberate Stop.

The user approved assumption-based assessments. Retain premises in existing
Assumptions and Assessment Basis fields. Assessments may be decisive under those
premises, but unsupported ratings must not be represented as source-verified
conclusions. Use local, bounded completion for exhausted recoverable failures and
unavailable provider credentials; keep explicit Stop and programming errors visible.

For the selected contract, replace the terminal aggregation of recoverable row
failures with an explicit completion outcome. Maintain exact row identities and
partial checkpoints, bounded retries, local ASIL/SWCI derivation, requirements
traceability and the distinction between source evidence and assumptions. An
unavailable provider must not cause successful assessments to disappear. Storage
failure must retain exportable memory results and accurate save state. Explicit
Stop must remain effective. Do not fill source citations with invented content.

Test each method under provider outage, truncation, missing evidence, invalid
ratings, mixed successful/failed batches, checkpoint failure and cancellation.
Report the resulting guarantees and limitations precisely. Do not remove validation
or hide unsupported safety conclusions to make an artifact appear complete.
