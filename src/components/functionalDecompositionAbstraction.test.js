import {
  DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL,
  FUNCTIONAL_ABSTRACTION_LEVEL_OPTIONS,
  getFunctionalAbstractionLevelOption,
  getFunctionalAbstractionPromptGuidance,
  normalizeFunctionalAbstractionLevel,
} from "./functionalDecompositionAbstraction";

describe("functional decomposition abstraction levels", () => {
  test("offers the four expected mutually exclusive levels with multi-level recommended", () => {
    expect(FUNCTIONAL_ABSTRACTION_LEVEL_OPTIONS.map((option) => option.value)).toEqual([
      "system",
      "subsystem",
      "detailed-functional",
      "multi-level",
    ]);
    expect(DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL).toBe("multi-level");
    expect(getFunctionalAbstractionLevelOption(DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL)?.recommended).toBe(true);
  });

  test("normalizes friendly aliases", () => {
    expect(normalizeFunctionalAbstractionLevel("System level")).toBe("system");
    expect(normalizeFunctionalAbstractionLevel("Detailed")).toBe("detailed-functional");
    expect(normalizeFunctionalAbstractionLevel("multilevel")).toBe("multi-level");
  });

  test("keeps multi-level hierarchy containers out of flat-table endpoints", () => {
    const guidance = getFunctionalAbstractionPromptGuidance("multi-level");
    expect(guidance).toContain("only concrete leaf functions");
    expect(guidance).toContain("Use Subsystem to identify");
    expect(guidance).toContain("Do not mix hierarchy containers");
  });
});
