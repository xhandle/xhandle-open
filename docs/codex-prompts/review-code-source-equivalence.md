# Code source equivalence review — approved scope

Reviewed baseline: aa0666f8961acf6d0af09e88670fa6bee5033c8c (main).

The user authorized running the attached review with these additional constraints. They override conflicting interpretation of the original prompt below.

- Read-only engineering review. Write only review, diagnostic, and proposed-prompt artifacts. Do not implement fixes, modify app/config/dependencies/Git history, touch real browser/project data, or commit/push.
- No paid/live AI calls or customer source uploads. Use isolated synthetic inputs and mocked services for diagnostics. Do not change credentials or permissions.
- Treat the reported Alpamayo differences as observations, not proof that either adapter is better. Separate confirmed implementation behavior, plausible contributors, expected model variability, and facts requiring original run exports/snapshots.
- Compare matching source contents AND analysis settings: selected files/extensions, exclusions, context, effective provider/model, prompt/policy versions, relevant organizational context if consumed, checkpoints and overrides.
- Preserve case-sensitive code paths/symbols and semantically significant source contents. Source identity is not prose normalization.
- Prefer targeted corrections to the existing shared pipeline. Separate parity fixes from optional language-parser, graph, and functional-abstraction redesigns.
- Preserve saved IDs/formats, manual edits, layouts, analyst overrides, review state, hazard/requirements links and local source isolation. Recommend additive/versioned changes and explicit migration/rollback for identity changes.
- Do not weaken size/read/memory/persistence safeguards, broaden exclusions, suppress safety-relevant primitives, or change eligibility defaults just to improve agreement.
- Produce the implementation prompt as a proposal only; do not run it.

## Original user review prompt

I want you to perform a read-only engineering review of xHandle's Code-Based Architecture analysis pipeline and then produce a detailed implementation prompt for Codex to fix the issues you identify.

## Background

xHandle supports Code-Based Architecture analysis through at least two source paths:

1. Local-first analysis of a locally available codebase.
2. GitHub-based analysis of a repository accessed through GitHub.

I ran both analysis paths against what should be equivalent Alpamayo source code and compared the resulting functional decompositions.

The outputs are recognizably analyzing the same repository, but they are materially different in ways that should not result merely from the source-access mechanism.

Examples from the comparison include:

- Local analysis produced substantially more Runtime relationships.
- Local analysis produced more relationships classified as eligible for hazard analysis.
- GitHub analysis produced substantially more Static Structure relationships.
- Different source files and architectural elements received different levels of coverage.
- Some identical or nearly identical relationships received different Lifecycle Phase, Interface Type, and Hazard Analysis Eligibility classifications.
- Some relationships were discovered in one analysis but not the other.
- Some differences appear to be naming or wording differences, but many represent actual differences in graph structure, coverage, or classification.
- The local workflow generally appeared more runtime-oriented.
- The GitHub workflow generally appeared more architecture/static-structure-oriented.
- Both workflows sometimes produce classifications that do not match the apparent semantics of the relationship.

The objective is NOT necessarily byte-for-byte identical natural-language output.

The objective is that, when a local repository and GitHub repository represent the same source revision, xHandle should derive nearly equivalent canonical architecture evidence and nearly equivalent functional decomposition results.

## Desired architectural property

Treat source acquisition as an adapter.

Conceptually:

Local source
→ source acquisition / normalization
→ canonical repository representation
→ code indexing / structural analysis
→ relationship extraction
→ functional abstraction
→ safety classification
→ Code-Based Architecture output

GitHub source
→ source acquisition / normalization
→ the same canonical repository representation
→ the same downstream analysis pipeline

After source normalization, the local and GitHub workflows should converge onto the same analysis machinery unless there is a clearly justified source-specific behavior.

The source mechanism itself should not materially influence:

- which production files are analyzed,
- symbol discovery,
- function/class discovery,
- call relationships,
- data relationships,
- inheritance relationships,
- imports,
- runtime relationships,
- configuration relationships,
- test identification,
- subsystem/component allocation,
- Lifecycle Phase,
- Interface Type,
- Hazard Analysis Eligibility,
- or functional abstraction.

## Review objectives

Perform a read-only inspection of the current implementation and determine exactly why equivalent code can produce materially different results depending on whether Local or GitHub analysis is used.

Do not implement fixes yet.

### 1. Reconstruct both pipelines

Trace the complete implementation for:

- local-first Code-Based Architecture analysis,
- GitHub Code-Based Architecture analysis.

Identify every stage from source selection through final persisted architecture/decomposition rows.

Show where the pipelines:

- share code,
- fork,
- duplicate logic,
- use different prompts,
- use different parsers,
- build different source representations,
- use different file filtering,
- use different context construction,
- use different batching/chunking,
- use different model calls,
- use different relationship extraction,
- use different post-processing,
- use different normalization,
- use different classification logic,
- or use different persistence behavior.

### 2. Identify sources of non-deterministic or source-dependent behavior

Specifically inspect for differences involving:

- repository file enumeration,
- ignored/excluded files,
- GitHub API limitations,
- truncated file content,
- partial file fetches,
- local filesystem traversal,
- symlinks,
- generated files,
- package initialization files,
- tests,
- notebooks,
- binaries,
- vendored dependencies,
- file-size limits,
- token limits,
- batching order,
- alphabetical vs traversal ordering,
- prompt construction,
- model context size,
- retry behavior,
- parallel processing,
- race conditions,
- result merging,
- deduplication,
- canonical naming,
- AST parsing,
- regex/static parsing,
- LLM-derived inference,
- call-graph construction,
- source auditing,
- and classification passes.

For each source of divergence, identify whether it is:

A. an acquisition difference,
B. an indexing difference,
C. an evidence-generation difference,
D. an LLM/prompt difference,
E. a normalization difference,
F. a classification difference,
G. a persistence/merge difference,
H. or expected unavoidable nondeterminism.

### 3. Determine the actual sources of truth

Identify the authoritative representation for:

- repository revision,
- file inventory,
- file content,
- symbols,
- relationships,
- component hierarchy,
- source evidence,
- generated architecture rows,
- classifications,
- and final functional decomposition rows.

Flag cases where Local and GitHub workflows maintain separate or competing sources of truth.

### 4. Review canonical identity

Determine how xHandle identifies the same architectural relationship across runs.

For example, a relationship conceptually equivalent to:

Function A
→ control/action/interaction
→ Function B

should have a stable canonical identity independent of:

- wording,
- prompt output,
- source adapter,
- row order,
- capitalization,
- or descriptive prose.

Review whether xHandle currently has a canonical relationship key such as some normalized combination of:

- repository revision,
- source file,
- source symbol,
- relationship type,
- target file,
- target symbol.

If not, recommend one.

The natural-language description should be treated as metadata attached to the canonical relationship, not as the identity of the relationship.

### 5. Review deterministic evidence extraction versus LLM interpretation

Determine which facts can be extracted deterministically from source before an LLM is used.

Examples may include:

- file inventory,
- AST symbols,
- imports,
- class inheritance,
- function/method definitions,
- direct calls,
- direct attribute relationships,
- known test locations,
- source/target file paths.

Prefer deterministic extraction for facts that can reliably be derived from code.

Then identify where LLM reasoning is actually appropriate, such as:

- functional meaning,
- functional abstraction,
- subsystem allocation when not structurally obvious,
- Lifecycle Phase,
- Interface Type,
- Hazard Analysis Eligibility,
- and descriptions.

Recommend a boundary between deterministic code analysis and probabilistic semantic interpretation that improves repeatability.

### 6. Review classification consistency

Inspect how the following fields are assigned:

- Lifecycle Phase,
- Interface Type,
- Hazard Analysis Eligibility,
- Eligibility Rationale.

Determine whether Local and GitHub workflows use exactly the same:

- policy,
- prompt,
- taxonomy,
- examples,
- validation,
- correction pass,
- and post-processing.

Look for cases where identical relationship semantics can be classified differently because of source-specific context.

Recommend how classification should operate over canonical relationships after source ingestion so the same evidence receives the same classification policy.

### 7. Review functional abstraction

One issue is that code-level analysis can become excessively granular.

For example, an implementation may decompose a meaningful functional operation into low-level calls such as:

- tensor creation,
- reshape,
- clamp,
- matrix multiplication,
- concatenation,
- device movement.

These may be valid architecture evidence but are not always appropriate as separate STPA-oriented functional interactions.

Review whether xHandle adequately separates:

1. raw code architecture evidence,
2. canonical code relationships,
3. functional architecture abstraction,
4. safety-analysis-eligible functional relationships.

The solution should preserve low-level traceability without forcing every implementation detail into the functional decomposition used as an STPA input.

### 8. Define equivalence expectations

Propose explicit invariants for equivalent Local and GitHub analyses.

At minimum, when both source paths analyze the same commit/revision:

#### Repository invariant
The production-code file inventory should be equivalent after normalization.

#### Symbol invariant
The normalized symbol inventory should be equivalent.

#### Relationship invariant
Deterministically discoverable source→target relationships should be equivalent.

#### Identity invariant
Equivalent relationships should receive the same canonical identity.

#### Classification invariant
The same canonical relationship with the same evidence should receive the same classification policy.

#### Exclusion invariant
Tests, examples, fixtures, generated files, etc. should be included/excluded using the same rules.

#### Traceability invariant
Every final relationship should trace back to source evidence independent of source adapter.

#### Ordering invariant
Analysis result semantics must not depend upon file traversal or batching order.

### 9. Define measurable acceptance criteria

Recommend concrete acceptance criteria.

I would expect something along the lines of:

- Same commit SHA or verified equivalent source snapshot.
- Approximately 100% normalized production-file inventory agreement, except explicitly documented adapter limitations.
- Approximately 100% deterministic symbol agreement.
- Greater than 95% agreement on deterministically discoverable canonical relationships.
- Greater than 95% agreement on classification for relationships present in both analyses.
- No material difference in subsystem/component coverage caused solely by Local versus GitHub ingestion.
- Differences must be explainable through explicit source-access limitations rather than hidden implementation divergence.
- Re-running the same source through the same workflow should produce highly stable canonical results.

Do not blindly adopt these numbers if the implementation demonstrates a better metric. Recommend the appropriate thresholds and explain why.

### 10. Consider revision identity

The comparison is only valid when the local and GitHub source actually represent the same revision.

Review how xHandle should establish this.

For GitHub, this may be commit SHA.

For local analysis, determine whether xHandle can:

- read the local Git commit SHA,
- identify dirty/uncommitted changes,
- generate a normalized source snapshot hash,
- or otherwise establish an equivalent source fingerprint.

The UI and audit evidence should make it clear whether two analyses were performed against genuinely equivalent source.

### 11. Regression testing

Design an automated regression-test strategy.

I want a test fixture where the exact same repository revision can be analyzed through:

A. Local-first ingestion.

B. GitHub ingestion.

The test should compare normalized intermediate and final outputs.

Include tests for:

- file inventory,
- symbols,
- canonical relationships,
- classification,
- exclusions,
- functional abstraction,
- stable IDs,
- repeat runs,
- ordering differences,
- batching differences,
- and source adapter equivalence.

The regression test should make future source-path divergence obvious.

## Important design constraint

Do not solve this by forcing both workflows to produce the same LLM wording.

Solve it by making both workflows operate from the same canonical evidence and analysis pipeline.

Natural-language fields may vary slightly.

Canonical architecture facts should not.

Likewise, do not simply union all relationships from both workflows. Determine why each workflow produces different evidence and fix the underlying architecture.

## Required output

After completing the review, provide:

### A. Current architecture

A concise reconstruction of the Local and GitHub analysis pipelines.

### B. Root causes

A prioritized list of the concrete implementation reasons the two workflows can diverge.

For each finding include:

- severity,
- affected files/modules/functions,
- evidence,
- consequence,
- and recommended architectural correction.

### C. Target architecture

Describe the desired unified pipeline and sources of truth.

### D. Invariants

List the invariants the implementation should enforce.

### E. Equivalence metrics

Define how Local-vs-GitHub equivalence should be measured.

### F. Regression test design

Describe the automated test suite required to prove equivalence.

### G. Implementation sequence

Recommend the safest order for making the changes.

### H. Codex implementation prompt

Finally, produce a standalone, detailed Codex implementation prompt that I can give to a fresh Codex session to implement the changes.

That implementation prompt must:

- reference actual files, modules, functions, and architecture discovered during this review;
- describe the required implementation rather than vaguely saying "make Local and GitHub equivalent";
- preserve existing functionality that is not implicated;
- avoid replacing deterministic source evidence with additional LLM inference;
- establish canonical relationship identity;
- unify classification behavior;
- add equivalence/regression tests;
- preserve source traceability;
- include acceptance criteria;
- require running relevant existing tests plus the new regression tests;
- and instruct Codex to report any architectural limitation that prevents true source-path equivalence rather than hiding it.

Do not implement the fixes during this review.

The purpose of this review is to produce an evidence-based implementation plan and a high-quality Codex implementation prompt.
