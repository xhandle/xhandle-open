import { createSafetyIssueConsolidationCoordinator } from "./safetyIssueConsolidationRun";

describe("safety issue consolidation run coordination", () => {
  it("allows only one active provider run", () => {
    const coordinator = createSafetyIssueConsolidationCoordinator();
    const first = coordinator.start();

    expect(first).not.toBeNull();
    expect(coordinator.start()).toBeNull();
    expect(coordinator.isCurrent(first.id)).toBe(true);
  });

  it("aborts the active run and permits a replacement after cleanup", () => {
    const coordinator = createSafetyIssueConsolidationCoordinator();
    const first = coordinator.start();

    expect(coordinator.cancel()).toBe(true);
    expect(first.controller.signal.aborted).toBe(true);
    expect(coordinator.finish(first.id)).toBe(true);

    const second = coordinator.start();
    expect(second.id).not.toBe(first.id);
  });

  it("does not let stale cleanup clear a newer run", () => {
    const coordinator = createSafetyIssueConsolidationCoordinator();
    const first = coordinator.start();
    coordinator.cancel();
    coordinator.finish(first.id);
    const second = coordinator.start();

    expect(coordinator.finish(first.id)).toBe(false);
    expect(coordinator.isCurrent(second.id)).toBe(true);
  });
});
