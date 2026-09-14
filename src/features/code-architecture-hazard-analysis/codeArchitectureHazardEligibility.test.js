const {
  classifyCodeArchitectureHazardEligibility,
  ensureCodeArchitectureHazardEligibility,
  summarizeCodeArchitectureHazardEligibility,
} = require("./codeArchitectureHazardEligibility");

describe("Code-Based Architecture hazard eligibility", () => {
  it("excludes static class-member definitions", () => {
    expect(classifyCodeArchitectureHazardEligibility({
      from: "Alpamayo2SuperConfig",
      action: "Define __init__",
      to: "__init__",
      fromFile: "src/models/configuration_alpamayo.py",
      controlActionDetails: "Exposes a defined class member at import time.",
    })).toMatchObject({
      lifecyclePhase: "Static Structure",
      interfaceType: "Structural Relationship",
      hazardAnalysisEligibility: "Exclude",
    });
  });

  it("excludes test and example-only relationships", () => {
    expect(classifyCodeArchitectureHazardEligibility({
      from: "fixture",
      action: "Call planner",
      to: "plan_motion",
      fromFile: "tests/test_planner.py",
    }).hazardAnalysisEligibility).toBe("Exclude");
  });

  it("includes operational runtime data and safety recovery paths", () => {
    expect(classifyCodeArchitectureHazardEligibility({
      from: "estimate_pose",
      action: "Publish pose estimate",
      to: "plan_trajectory",
      fromFile: "src/runtime/localization.py",
    })).toMatchObject({ lifecyclePhase: "Runtime", interfaceType: "State Estimate", hazardAnalysisEligibility: "Include" });

    expect(classifyCodeArchitectureHazardEligibility({
      from: "monitor_health",
      action: "Issue minimum-risk command",
      to: "execute_fallback",
    }).hazardAnalysisEligibility).toBe("Include");
  });

  it("includes consequential initialization and configuration", () => {
    expect(classifyCodeArchitectureHazardEligibility({
      from: "load_checkpoint",
      action: "Load model weights and dtype configuration",
      to: "initialize_inference_model",
      controlActionDetails: "Validates model configuration before runtime trajectory inference.",
    })).toMatchObject({
      hazardAnalysisEligibility: "Include",
      interfaceType: "Configuration/Authority",
    });
  });

  it("retains an explicit review state for ambiguous calls", () => {
    expect(classifyCodeArchitectureHazardEligibility({
      from: "helper_a",
      action: "Call helper_b",
      to: "helper_b",
      fromFile: "src/utils.py",
    }).hazardAnalysisEligibility).toBe("Needs Review");
  });

  it("preserves analyst overrides during migration and reports counts", () => {
    const rows = ensureCodeArchitectureHazardEligibility([
      {
        from: "helper_a",
        action: "Call helper_b",
        to: "helper_b",
        hazardAnalysisEligibility: "Include",
        lifecyclePhase: "Runtime",
        interfaceType: "Data",
        hazardAnalysisEligibilityRationale: "Confirmed production runtime path.",
        hazardAnalysisEligibilitySource: "analyst-override",
      },
      { from: "Config", action: "Define __init__", to: "__init__" },
    ]);

    expect(rows[0]).toMatchObject({ hazardAnalysisEligibility: "Include", hazardAnalysisEligibilitySource: "analyst-override" });
    expect(summarizeCodeArchitectureHazardEligibility(rows)).toEqual({ total: 2, include: 1, exclude: 1, needsReview: 0 });
  });
});
