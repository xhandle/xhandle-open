import {
  collectCodeArchitectureReviewPackage,
  isHostedCodeArchitectureReviewPackagerConfigured,
} from "./codeArchitectureReviewExport";

describe("codeArchitectureReviewExport", () => {
  it("builds a local review package without repository secrets or hosted packager requirements", async () => {
    const reviewPackage = await collectCodeArchitectureReviewPackage({
      appDisplayName: "Demo Review",
      project: { id: "project-1", name: "Demo Project" },
      repo: { id: "repo-1", repoName: "demo-repo", token: "secret-token" },
      cbaRows: [{ from: "A", action: "calls", to: "B" }],
      reviewItems: [{ id: "review-1", status: "draft_ai_generated" }],
    });

    expect(reviewPackage.type).toBe("code-based-architecture-review-package");
    expect(reviewPackage.schemaVersion).toBe(1);
    expect(reviewPackage.activeRepo.token).toBeUndefined();
    expect(reviewPackage.data.cbaRows).toHaveLength(1);
    expect(reviewPackage.data.repositories).toHaveLength(1);
    expect(reviewPackage.data.reviewItems).toHaveLength(1);
    expect(isHostedCodeArchitectureReviewPackagerConfigured()).toBe(false);
  });
});
