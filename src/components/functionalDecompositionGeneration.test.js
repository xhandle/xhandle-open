import { buildPromptWizardCollaboratorRequest } from "./functionalDecompositionGeneration";

describe("buildPromptWizardCollaboratorRequest", () => {
  it("passes user-authored evidence while omitting unapproved AI-generated wizard drafts", () => {
    const result = buildPromptWizardCollaboratorRequest(JSON.stringify({
      systemName: "Humanoid Robot",
      abstractionLevel: "multi-level",
      systemOverview: "Performs general-purpose embodied tasks in human environments.",
      functionalComponents: "Companionship, Smart Home Integration, Cloud Services",
      interactions: "Companionship sends emotional responses to the user.",
      ops: "Nominal walking and degraded balance recovery.",
      evidenceProvenance: {
        aiGeneratedFields: ["functionalComponents", "interactions"],
      },
    }));

    expect(result.abstractionLevel).toBe("multi-level");
    expect(result.userRequest).toContain("Create a functional decomposition for Humanoid Robot");
    expect(result.userRequest).toContain("general-purpose embodied tasks");
    expect(result.userRequest).toContain("degraded balance recovery");
    expect(result.userRequest).not.toContain("Companionship, Smart Home Integration");
    expect(result.userRequest).not.toContain("emotional responses");
    expect(result.userRequest).toContain("omitted AI-generated wizard drafts");
  });

  it("preserves manually supplied functional architecture evidence", () => {
    const result = buildPromptWizardCollaboratorRequest({
      systemName: "Humanoid Robot",
      abstractionLevel: "detailed-functional",
      functionalComponents: "Whole-Body Control, Gait Generation, Joint Torque Regulation",
      interactions: "Whole-Body Control provides joint targets to Joint Torque Regulation.",
    });

    expect(result.userRequest).toContain("Whole-Body Control");
    expect(result.userRequest).toContain("Joint Torque Regulation");
  });
});
