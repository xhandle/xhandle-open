// Guards the corpus itself. A fixture with internal contradictions or missing
// coverage produces metrics that look precise and mean nothing, so these run
// against every registered fixture rather than a hand-built example.

import { HAZARD_EVAL_FIXTURES, getApprovedHazardEvalFixtures, getHazardEvalFixture } from "./fixtures";
import { assertFixtureItemIds } from "./hazardEvalRunner";
import { normalizeExpectedDecision } from "./hazardEvalScoring";

const applicableItems = (fixture) => fixture.items
  .filter((item) => normalizeExpectedDecision(item.expected?.applicable) === "yes");

describe.each(HAZARD_EVAL_FIXTURES.map((fixture) => [fixture.fixtureId, fixture]))(
  "fixture %s",
  (fixtureId, fixture) => {
    test("uses the positional ids the pipeline assigns", () => {
      expect(() => assertFixtureItemIds(fixture)).not.toThrow();
    });

    test("gives every item a decidable applicability label", () => {
      fixture.items.forEach((item) => {
        expect(normalizeExpectedDecision(item.expected?.applicable)).not.toBeNull();
      });
    });

    test("labels safety significance on applicable items and omits it elsewhere", () => {
      fixture.items.forEach((item) => {
        const applicable = normalizeExpectedDecision(item.expected?.applicable) === "yes";
        const significance = normalizeExpectedDecision(item.expected?.safetySignificant);
        if (applicable) {
          expect(significance).not.toBeNull();
        } else {
          // A non-applicable deviation has no significance to classify. Leaving
          // a value here would be scored as a second, independent judgment.
          expect(item.expected?.safetySignificant ?? null).toBeNull();
        }
      });
    });

    test("points every canonical hazard reference at a declared hazard", () => {
      const declared = new Set((fixture.canonicalHazards || []).map((hazard) => hazard.id));
      fixture.items.forEach((item) => {
        const hazardId = item.expected?.canonicalHazardId;
        if (hazardId) expect(declared).toContain(hazardId);
      });
    });

    test("maps a canonical hazard for every safety-significant item", () => {
      applicableItems(fixture)
        .filter((item) => normalizeExpectedDecision(item.expected?.safetySignificant) === "yes")
        .forEach((item) => {
          expect(item.expected?.canonicalHazardId).toBeTruthy();
        });
    });

    test("keeps both applicability outcomes so over-application is measurable", () => {
      const outcomes = new Set(fixture.items.map((item) => normalizeExpectedDecision(item.expected?.applicable)));
      expect(outcomes).toContain("yes");
      // Without a rejected deviation there is nothing to over-apply, and the
      // headline metric would be undefined.
      expect(outcomes).toContain("no");
    });

    test("keeps a mission-only item so over-classification is measurable", () => {
      const significance = new Set(applicableItems(fixture)
        .map((item) => normalizeExpectedDecision(item.expected?.safetySignificant)));
      expect(significance).toContain("yes");
      expect(significance).toContain("no");
    });

    test("classifies applicable items on one interface consistently", () => {
      // Safety significance is mostly a property of the interface's role in the
      // architecture — a direct safety control or safety-critical feedback path
      // — rather than of which guide phrase was applied to it. Two applicable
      // rows on the same interface with opposite significance is the shape of
      // the FD-8/FD-10 contradiction, and grouping by canonical hazard misses
      // it because the mislabelled row carries no hazard id.
      //
      // A genuine exception may exist one day. This failing is the prompt to
      // make that call deliberately rather than let the corpus drift.
      const byInterface = new Map();
      applicableItems(fixture).forEach((item) => {
        const key = [item.from, item.controlAction, item.to].map((part) => String(part || "").trim()).join(" → ");
        if (!byInterface.has(key)) byInterface.set(key, []);
        byInterface.get(key).push(item);
      });
      byInterface.forEach((items, key) => {
        const significance = [...new Set(items.map((item) => normalizeExpectedDecision(item.expected?.safetySignificant)))];
        // Compared as a pair so a failure names the offending interface.
        expect([key, significance]).toEqual([key, [significance[0]]]);
      });
    });

    test("classifies items reaching the same canonical hazard consistently", () => {
      const byHazard = new Map();
      applicableItems(fixture).forEach((item) => {
        const hazardId = item.expected?.canonicalHazardId;
        if (!hazardId) return;
        if (!byHazard.has(hazardId)) byHazard.set(hazardId, []);
        byHazard.get(hazardId).push(item);
      });
      byHazard.forEach((items, hazardId) => {
        const significance = [...new Set(items.map((item) => normalizeExpectedDecision(item.expected?.safetySignificant)))];
        expect([hazardId, significance]).toEqual([hazardId, [significance[0]]]);
      });
    });

    test("gives every label a rationale a reviewer can check", () => {
      fixture.items.forEach((item) => {
        expect(String(item.expected?.rationale || "").length).toBeGreaterThan(20);
      });
    });
  },
);

describe("fixture registry", () => {
  test("exposes registered fixtures by id", () => {
    expect(getHazardEvalFixture("vehicle-braking-001")).toBeTruthy();
    expect(getHazardEvalFixture("missing")).toBeNull();
  });

  test("separates approved fixtures from proposed ones", () => {
    const approved = getApprovedHazardEvalFixtures();
    approved.forEach((fixture) => expect(fixture.labelStatus).toBe("approved"));
    expect(approved.length).toBeLessThanOrEqual(HAZARD_EVAL_FIXTURES.length);
  });
});
