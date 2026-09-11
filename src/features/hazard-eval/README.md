# Hazard Analysis Evaluation Harness

Measures whether a hazard-analysis run reaches the engineering conclusions a
qualified engineer would approve.

## Why this exists

The generation pipeline in
[`aiAnalysisCodeHazardStandard.js`](../../components/aiAnalysisCodeHazardStandard.js)
runs five sequential stages — generation, generic-row repair, safety-significance
tagging, audit-anomaly repair, and canonicalization — each tuned by hand-written
heuristics. Existing unit tests cover structure: schema shape, parsing,
normalization, coverage. Nothing covered **conclusion quality**, so any change to
a prompt, a regex, or a threshold was an unmeasured guess, and no one could tell
whether a later stage was fixing an earlier stage's output or fighting it.

This harness makes the four known failure modes countable:

| Failure mode | Metric |
| --- | --- |
| Semantically weak guide phrases treated as applicable | `applicability.falsePositiveRate` |
| Mission/reliability effects presented as safety concerns | `safetySignificance.falsePositiveRate` |
| Hundreds of row-level findings that never converge | `canonicalization.convergenceRatio` |
| Requirements contradicting stated context assumptions | `architecturalConsistency.violationRate` |

## Label status

Every fixture carries `labelStatus`. Only `"approved"` fixtures are ground truth.

- `"proposed"` — drafted for engineer review. Exercises the harness; **not
  evidence of quality**. `getApprovedHazardEvalFixtures()` excludes these.
- `"approved"` — reviewed and signed off by a qualified engineer.

Do not report a score from a proposed fixture as a quality result.

## Fixture schema

A fixture mirrors the output of `flattenDecomposition` — one entry per
interface × operational context × guide phrase — so items feed the real pipeline
without translation.

```js
{
  fixtureId: "vehicle-braking-001",
  domain: "vehicle-braking",
  labelStatus: "proposed" | "approved",
  operationalContext: "...",   // the derived project/operational context prompt text
  organizationContext: "",     // optional organization calibration text
  canonicalHazards: [
    { id: "H-BRK-1", title: "Vehicle fails to decelerate when deceleration is commanded" },
  ],
  items: [
    {
      id: "FD-1",
      from: "Brake Controller",
      fromDetails: "...",
      controlAction: "Brake pressure command",
      controlActionDetails: "...",
      to: "Brake Actuator",
      toDetails: "...",
      operationalContextId: "CTX-1",
      operationalScenario: "Highway deceleration",
      operationalMode: "Normal braking",
      operatingConditions: "...",
      contextAssumptions: "...",
      guidePhrase: "Not providing the control action causes a hazard",
      expected: {
        applicable: "yes" | "no",
        rationale: "why an engineer decided that",
        safetySignificant: "yes" | "no" | null,   // null when not applicable
        canonicalHazardId: "H-BRK-1" | null,
        forbiddenRequirementClaims: [
          "shall command brake application on power loss",
        ],
      },
    },
  ],
}
```

### `expected.applicable`

The engineer's judgment on whether the guide phrase has a credible mechanism at
this interface in this context. A `"no"` needs a rationale explaining *why the
deviation cannot occur or cannot produce an adverse receiver state* — not merely
that it seems unlikely.

### `expected.safetySignificant`

Scored **only** on rows where the engineer said applicable *and* the run said
applicable. This keeps one applicability error from being counted twice. Use
`"no"` for real deviations whose consequence is availability, reliability,
mission, or efficiency without a credible physical-harm path.

### `expected.canonicalHazardId`

Which entry in `canonicalHazards` this row should roll up to. Drives
`mappingAccuracy`; `convergenceRatio` is measured independently from the count of
distinct hazard statements the run emitted.

### `expected.forbiddenRequirementClaims`

Plain phrases (matched case-insensitively as substrings against the generated
requirement and mitigation) that would contradict this item's stated
architecture. The seed fixture uses a passive fail-safe context: a requirement
demanding a controller command on power loss contradicts an actuator that
reverts mechanically with no command required.

## Metrics

`scoreHazardEvalRun({ fixture, rows })` returns per-fixture scores;
`aggregateHazardEvalReports(reports)` totals them across the corpus.

Confusion counts distinguish three outcomes, not two:

- **decided** — the run committed to Yes or No, and it is scored.
- **undecided** — the run wrote `Needs Review`. Counted separately so declines
  never inflate accuracy.
- **unlabeled** — the fixture has no expected value for that field.

`falsePositiveRate` is the headline number for over-generation: of the deviations
an engineer rejected, the fraction the run claimed anyway.

## Adding a fixture

1. Export the fixture object from a new file in `fixtures/`.
2. Register it in [`fixtures/index.js`](./fixtures/index.js).
3. Keep `labelStatus: "proposed"` until an engineer signs off.

Prefer fixtures that mix outcomes. A corpus of only-hazardous interfaces cannot
measure over-application, which is the failure mode that matters most.

## Corpus integrity

[`hazardEvalFixtures.test.js`](./hazardEvalFixtures.test.js) runs against every
registered fixture. A corpus that contradicts itself produces metrics that look
precise and mean nothing, so these are enforced:

- Positional ids, decidable applicability, and a rationale on every label.
- Safety significance labelled on applicable items and absent on the rest.
- Canonical hazard references resolve, and every safety-significant item maps to
  one.
- Both applicability outcomes present, and at least one applicable mission-only
  item — otherwise over-application or over-classification is unmeasurable.
- **Applicable items on one interface share a safety significance.** Significance
  follows the interface's architectural role — direct safety control or
  safety-critical feedback — more than the guide phrase applied to it. This is
  the check that catches a row reaching a known hazardous state while labelled
  mission-only; grouping by canonical hazard misses it, because the mislabelled
  row carries no hazard id.

## Running a fixture through the pipeline

`runHazardEvalFixture` builds a Functional Decomposition sheet from the fixture,
runs the **real** five-stage pipeline, converts the result sheet back to rows,
and scores them.

```js
const report = await runHazardEvalFixture({ fixture, method: "STPA" });
const suite = await runHazardEvalSuite({ fixtures: HAZARD_EVAL_FIXTURES });
console.log(formatHazardEvalSummary(suite));
```

Two safeguards are built in:

- **Applicability columns are left blank** in the generated sheet. Seeding them
  would hand the pipeline its own answer.
- **Item ids must be `FD-1`, `FD-2`, …** in order. `flattenDecomposition`
  assigns ids positionally and ignores any id column, so a fixture numbered
  otherwise would be scored against the wrong rows. `assertFixtureItemIds`
  fails loudly rather than mis-attributing.

### Per-stage attribution

`runStandardHazardAnalysisStages` fires `onStageComplete({ stage, rows })` after
generation and after each repair stage. The runner scores every one, so
`report.stages` shows what each pass actually changed:

```
generation             FP 1  undecided 0  baseline
language-repair        FP 1  undecided 0  no measured change
safety-audit           FP 0  undecided 0  applicabilityFalsePositives -1
audit-anomaly-repair   FP 0  undecided 0  no measured change
canonicalization       FP 0  undecided 0  distinctHazardStatements -1
```

`changedNothing` marks a stage that spent a model call and moved no tracked
metric. That is the signal for deciding which of the five passes earn their cost.

### Where applicability is actually decided

Not in generation. The generated row's `guidePhraseApplicable` is provisional;
the **`hazard-safety-audit` stage** adjudicates it through
`validateApplicabilityEvidence`, which demotes any verdict whose cited evidence
is not a verbatim excerpt from the supplied interface or context fields. A run
steered only at the generation stage comes back entirely `Needs Review`.

## Replay transport

Every model call goes through one function, `fetchLLMResponse`, and each call
site tags itself with a `workflow`:

| Workflow | Stage |
| --- | --- |
| `hazard-row-generation` | Row generation |
| `hazard-language-repair` | Generic-language repair |
| `hazard-safety-audit` | Applicability + safety significance |
| `hazard-applicability-pattern-repair` | Pattern collapse repair |
| `hazard-canonical-catalog` | Canonical loss/hazard catalog |
| `hazard-canonical-mapping` | Row → canonical mapping |

`createCassetteTransport` replays recorded responses keyed by
`workflow:hash(prompt)`, so scoring, matching, and downstream-stage changes can
be re-run for free. **A cassette miss throws** rather than silently reaching the
network, and recording modes refuse to run without an explicit `liveTransport` —
live calls cost real money and are never the default.

`createScriptedTransport` drives the pipeline down a chosen path in tests,
with a `fallback` for stages a given test is not steering.

## Running

```bash
CI=true npx react-scripts test --testPathPattern "hazard-eval" --watchAll=false
```

The scoring module is pure — it compares produced rows to labels and performs no
model calls. Nothing in the app imports this feature, so it is excluded from the
production bundle.

## Known gaps this harness exposes

**Verbatim evidence is not supporting evidence.** The structural gate checks
that an evidence quote is a real excerpt. It does not check that the quote
*supports* the verdict. A row can cite "reverts to its mechanically applied
fail-safe position" — a quote that argues the deviation is harmless — as grounds
for calling that deviation applicable, and pass. Only the labels catch it. See
the `catches an over-application whose evidence quote argues against it` test.

**Unparseable applicability defaults to applicable.**
`normalizeGuidePhraseApplicability` returns `"Yes"` for any value it cannot
parse, including an empty one. A row that states no applicability at all enters
the pipeline already counted as a hazard. See the `attributes to generation an
applicability the model never stated` test.
