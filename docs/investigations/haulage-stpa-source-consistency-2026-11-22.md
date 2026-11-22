# Haulage STPA source consistency

Reusable implementation prompt: [fix-haulage-stpa-source-consistency.md](../codex-prompts/fix-haulage-stpa-source-consistency.md).

## Baseline and causes

The supplied run contains 105 rows: 68 applicable and 37 excluded. Review found contradictory reset/brake expectations, incorrect arithmetic, telemetry/command threshold confusion, unsafe stop-path suppression proposals and autonomous framing of a teleoperated fixture. A hypothetical failure of a safeguard is legitimate STPA input; it must remain distinguishable from a demonstrated implementation defect.

Two concrete evidence-path defects contributed to this risk:

- Functional abstraction replaced full file evidence with path-only records, retaining function snippets but losing imports, adjacent guards and file-level context. This weakened later source verification.
- Both context-generation callers appended organization guidance to the user's description. The code-architecture caller passed only functional labels, omitting existing project operating concepts and function descriptions. This blurred evidence priority and could bias mode selection toward profile examples. It does not prove which prompt caused the saved autonomous context in the supplied run.

The applicability screen accepted generic gate/downstream-harm arguments as final exclusions. Generation already had general grounding instructions, but lacked explicit consistency instructions for source guards, reset transitions, actuator priority, command-sequence test state and physical versus software timing.

## Changes

- Preserve full file evidence and snapshot identity through functional abstraction. Conflicting source snapshots remain separate. Preserve existing valid interface/lifecycle metadata and source line references.
- Send user description, project context and organization guidance as separate context-generation inputs. Include function descriptions. Explicit project authority/mode and source facts take precedence; neither remote supervision nor an autonomy organization establishes remote driving/autonomy for this project.
- Add focused source screening for automatic STPA exclusions justified only by being a gate or requiring downstream harm. This requests evidence and a new justified decision; it never automatically converts No to Yes or overwrites analyst decisions. Duration exclusions for instantaneous predicates remain valid.
- Expand generation guidance for explicit reset, reset-cycle zero motion, stop retention, emergency-brake priority, protective output under invalid input, safe short-circuit rejection, freshness versus replay, named constants and consistent test prerequisites. Distinguish proposed changes and injected faults from existing source behavior.
- Add a bounded arithmetic parser. It supports numeric literals, supplied scalar variables, parentheses and arithmetic operators; it never executes source code. Pure single-parameter/single-return arithmetic functions and literal numeric constants provide prompt anchors and checks for explicit named numerical claims. Literal arithmetic equalities are checked independently. Ambiguous function/constant definitions do not become a fabricated single oracle. Explicit proposed replacements and injected faulty outputs are allowed.
- Reuse existing per-row correction/checkpoint validation for failed numeric claims. Increment generation and screening contract versions so fresh runs cannot reuse pre-fix automatic checkpoints. Keep stored completed results and analyst inputs intact.
- Add regressions to the existing offline STPA harness. There is no mandatory additional model review pass for every row.

## Validation

- Offline STPA harness on the final code: 14 suites, 220 tests passed in 21.90 s. Includes HARA/FHA compatibility, cancellation, partial recovery, table publication and the new numeric/screening checks.
- Focused suites: 6 suites, 104 tests passed for functional evidence, context generation, applicability, focused recovery, prompt payloads and organization context.
- Final targeted rerun: 3 suites, 76 tests passed, including the additional legitimate injected-fault negative control.
- Applying only the new arithmetic validator to the supplied results flags UCA-HA-57, UCA-HA-62 and UCA-HA-101. These are actual numeric contradictions in that output, not mocked reviewer decisions. The other 65 applicable rows are not thereby approved.
- `git diff --check` passed.
- Production build passed with `NODE_OPTIONS=--max-old-space-size=8192 npm run build`. The default attempt exhausted Node's default heap. CRA reported the repository's warning backlog and large-bundle notice; the new arithmetic module introduced no build warnings. Build log: `/tmp/xhandle-haulage-consistency-build-8gb.log`.

## Limits and next run

No paid provider analysis, modification to the enabled profile, or mutation of saved user projects was performed. Offline provider doubles test control flow and correction behavior, not live narrative quality. Local arithmetic checks cover a deliberately limited expression grammar and explicit claims, not arbitrary prose, physical vehicle models or general semantic correctness. Broader reset/brake consistency is strengthened by retained evidence and generation guidance; it is not formally proved by these checks. Full source preservation can enlarge prompts; existing deduplication and evidence chunking remain active.

Reload/restart the development app as appropriate, correct or regenerate the saved operational context so it describes the teleoperated fixture, and choose fresh hazard regeneration. Toggling the profile alone does not change saved contexts or earlier findings. Keep the profile and model fixed for the first comparison with the original results. Share the regenerated table for another source-based review.
