# Review automated safety case readiness

Review the current xHandle Safety Case implementation against this product intent:

The safety case should continuously collect and maintain relevant evidence already generated within xHandle, and allocate that evidence to the argument where an explicit, explainable relationship exists. Users must retain manual evidence allocation, uploads, authored arguments, overrides, and review authority. The value is a maintained safety argument with traceable evidence and visible gaps, rather than another evidence filing task.

Execute a repository review, not a feature implementation. Read applicable AGENTS.md instructions. Preserve existing changes and user data. Do not use live project data, external AI calls, or publish anything. Save the findings under docs/investigations/automated-safety-case-review.md.

1. Trace the actual UI paths for generation, evidence discovery, allocation, recommendations, completeness, persistence, import/export, and updates. Distinguish connected behavior from unused helpers and UI promises.
2. Inventory evidence producers: project context, hazards and risk assessments, requirements and their links, architecture and functional decomposition, verification plans versus execution results, remediation findings and verification runs, reviews and decisions, uploaded evidence, and baselines/configurations. Identify authoritative stores and IDs, project ownership, versions, relationships, notifications, and integration gaps. Examine the existing workspace graph and source reconciliation before proposing a new catalog.
3. Assess automated initial population and incremental maintenance: create/update/delete, renamed or moved records, missing sources, stale evidence, failed verification, contradictory evidence, uncertain matching, partial scans, large projects, offline restart, migration, and concurrent edits. Separate automatic collection and allocation from assessment and human acceptance.
4. Review project isolation, provenance, duplicate identities across mirrors, AI output grounding, manual overrides, durability, and reproducible evidence snapshots. Determine whether completeness and status accurately reflect evidence quality and currency.
5. Validate high-impact suspected defects using isolated synthetic data and bounded checks. Do not hang the main process or mutate real storage. Clearly state what was tested, what is inferred from code, and what remains unverified.
6. Deliver a concise verdict; current capability matrix; prioritized findings with source file/line references; evidence-source inventory; proposed architecture and lifecycle; phased implementation plan with dependencies and likely files; and observable acceptance criteria. Specify the smallest useful automatic vertical slice, followed by broader coverage. Avoid unsupported delivery estimates or claims of regulatory compliance.

Success means a developer can tell exactly what exists, what must change, and how to demonstrate that xHandle maintains a project-scoped safety case automatically while preserving manual control.
