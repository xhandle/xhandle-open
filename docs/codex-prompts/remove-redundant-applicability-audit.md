# Remove redundant guide-phrase applicability assessment

Read the Code-Based Architecture STPA screening, generation, audit, repair, ownership, and checkpoint paths first. Identify where downstream prompts ask the model to reassess decisions already supplied by command/control screening or accepted human review.

Implement a focused change: treat protected applicability as input throughout generation and repairs. Partition audit batches so protected rows receive only safety-significance and evidence questions, without applicability response fields or semantic proof questions. Do not trigger applicability distribution/calibration retries for protected rows. Retain independent safety classification, evidence, protection, and causal-category checks and their existing criteria. Keep legacy unassessed rows on their existing applicability path. Preserve No/unresolved gating and authoritative decision/rationale protection even if a provider returns unexpected applicability fields.

Keep the Projects screening workflow unchanged. Preserve row identity and ordering across mixed batches. Version affected downstream checkpoints without discarding source extraction or screening work. Update progress messages to describe the work actually being performed.

Add regression tests for screened and reviewed decisions, mixed batches, hostile provider output, uniform protected populations, genuine downstream inconsistencies, and legacy applicability auditing. Run focused and existing hazard-analysis tests and a production build. Report implementation and limits; do not claim measured live-provider speed improvements without measurements.
