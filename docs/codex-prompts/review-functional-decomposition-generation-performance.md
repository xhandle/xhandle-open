# Review functional-decomposition generation latency

Perform a read-only engineering review of xHandle's functional-decomposition pipeline. Users report runs taking hours. Identify changes that could drastically reduce latency while preserving source coverage, functional abstraction quality, traceability, and downstream compatibility.

Trace GitHub and local acquisition, file selection and indexing, source extraction, syntax reconciliation, architecture classification, Functional responsibility processing, consolidation, CSCI/CSC hierarchy, checkpointing, publication, and diagram handoff. Distinguish source-to-CSU generation from derived Functional view processing. Inspect provider timeouts, retries, splitting, batching, concurrency, prompts/output budgets, repeated evidence, progress reporting, and resume behavior.

Use code references and bounded synthetic/mock measurements where useful. Do not make live paid model calls, alter customer data, weaken validation, sample away source files or relationships, change analysis logic, or modify production code. Label measured results separately from estimates and hypotheses. Do not claim a customer's exact root cause without their run telemetry.

Report ranked bottlenecks, current call-count/concurrency behavior, retry amplification, expensive repeated work, and a prioritized implementation plan with acceptance criteria. Explicitly protect complete input coverage, identity/project isolation, determinism where applicable, uncertainty/boundary preservation, applicability governance, and hazard/requirements/traceability inputs. Recommend instrumentation and representative cross-language benchmarks to prove speed and quality together.
