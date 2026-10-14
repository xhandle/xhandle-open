# Replace the code-based architecture hazard pipeline

Retain the existing implementation as an explicitly callable legacy pipeline. Route the code-based architecture STPA, HARA, and FHA entry point to a new compact, bounded-batch assessment pipeline. Do not change Projects hazard analysis.

Use the Functional model when available through the existing input builder, eligibility and operational context selection. Include the enabled organization profile in every request and checkpoint identity. Preserve reviewed applicability and imported preprocessing; No rows never receive downstream hazard generation. Generate each interface/context/guide-phrase assessment once, validate locally, checkpoint successful assessments, and retry only invalid/missing rows with smaller batches. Avoid full-table LLM audit/repair/catalog cycles. Preserve cancellation, project/repository isolation, persistence, CSV, diagram links, and software requirement derivation. Do not manufacture successful results on transport errors. Keep assumptions explicit.

Default columns:
- FHA: Function (From), Control Action, Function (To), Operational Context, Guide Phrase, Guide Phrase Applicable, Mishap, Severity Category, Severity Rationale, Software Control Category, Software Control Category Rationale, Software Criticality Index, SWCI Rationale / Derivation, Safety Classification, Verification.
- HARA: Function, Operational Scenario, Operational Mode, Operating Conditions, Guide Phrase, Guide Phrase Applicable, Malfunctioning Behavior, Hazardous Event, Severity, Exposure, Controllability, ASIL, Safety Goal, Safety Classification.
- STPA: Function, Operational Scenario, Operational Mode, Operating Conditions, Guide Phrase, Guide Phrase Applicable, Malfunctioning Behavior, Causal Factor, Safety Classification.

Keep software-allocated requirements, verification, classification rationale, assumptions and traceability as additional stored/exportable columns, hidden by default. Compute ASIL and SWCI from validated ratings locally. Progress must use completed assessments and reach 100 only after saving.

Verify dispatch, all three schemas, rated results, governed applicability, organization profile propagation/cache invalidation, identity/coverage, partial response retry, cancellation, reload persistence, CSV, and hazard-derived software requirements. Run focused regression suites and production build. Report measured request counts separately from live elapsed-time claims. No commit or push.
