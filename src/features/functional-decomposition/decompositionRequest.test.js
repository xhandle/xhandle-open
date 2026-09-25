/**
 * Once the abstraction level is settled, a resolved request must tell the model
 * to generate. Without that directive it answers with another setup question --
 * re-asking the level it was just given, and asking which project should receive
 * a draft that modifies no project. Two code paths built this request and only
 * one carried the directive.
 */

import {
  FUNCTIONAL_DECOMPOSITION_DIRECTIVE,
  functionalAbstractionInstruction,
  functionalDecompositionRequestInstruction,
  inferFunctionalAbstractionLevel,
} from "./decompositionRequest";

const LEVELS = ["system", "subsystem", "detailed-functional", "multi-level"];

describe("the resolved decomposition instruction", () => {
  it.each(LEVELS)("names the selected level and tells the model to generate (%s)", (level) => {
    const instruction = functionalDecompositionRequestInstruction(level);

    expect(instruction).toContain(`Abstraction level selected by the user: ${level}.`);
    expect(instruction).toContain(FUNCTIONAL_DECOMPOSITION_DIRECTIVE);
  });

  it("carries each level's own guidance rather than a generic block", () => {
    const rendered = LEVELS.map((level) => functionalDecompositionRequestInstruction(level));

    expect(new Set(rendered).size).toBe(LEVELS.length);
    expect(functionalDecompositionRequestInstruction("multi-level"))
      .toContain(functionalAbstractionInstruction("multi-level"));
  });

  it("forbids the two questions that were being re-asked", () => {
    expect(FUNCTIONAL_DECOMPOSITION_DIRECTIVE).toMatch(/do not ask which project/i);
    expect(FUNCTIONAL_DECOMPOSITION_DIRECTIVE).toMatch(/do not ask another setup question/i);
  });

  it("keeps an allocation instruction alongside the directive", () => {
    const instruction = functionalDecompositionRequestInstruction("system", "Allocate to the named subsystems.");

    expect(instruction).toContain("Allocate to the named subsystems.");
    expect(instruction).toContain(FUNCTIONAL_DECOMPOSITION_DIRECTIVE);
  });

  it("puts the directive last, after the level guidance", () => {
    const instruction = functionalDecompositionRequestInstruction("multi-level");
    expect(instruction.trimEnd().endsWith(FUNCTIONAL_DECOMPOSITION_DIRECTIVE)).toBe(true);
  });
});

describe("skipping the selector entirely", () => {
  it.each([
    ["Create a multi-level functional decomposition for a yard truck", "multi-level"],
    ["Use MULTI-LEVEL abstraction", "multi-level"],
    ["give me a hierarchical breakdown", "multi-level"],
    ["detailed functional decomposition please", "detailed-functional"],
    ["subsystem-level view", "subsystem"],
    ["system-level context", "system"],
  ])("recognises the level stated in %s", (text, expected) => {
    // A request that already states its level must not be interrupted to ask.
    expect(inferFunctionalAbstractionLevel(text)).toBe(expected);
  });

  it("asks only when the request genuinely leaves the level open", () => {
    expect(inferFunctionalAbstractionLevel("Create a functional decomposition for a Warehouse Yard Truck.")).toBe("");
  });
});
