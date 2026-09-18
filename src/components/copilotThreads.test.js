import { ensureThread, loadThreads, saveThreads } from "./copilotThreads";

describe("Collaborator thread persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("preserves a long engineering response in recent history", () => {
    const longResponse = "functional decomposition row\n".repeat(1200);
    saveThreads([{
      id: "thread-1",
      title: "Humanoid decomposition",
      createdAt: 1,
      updatedAt: 2,
      messages: [{ role: "assistant", content: longResponse }],
    }]);

    expect(loadThreads()[0].messages[0].content).toBe(longResponse);
  });

  it("falls back to tab storage when local storage is full", () => {
    const originalSetItem = Storage.prototype.setItem;
    const setItem = jest.spyOn(Storage.prototype, "setItem");
    setItem.mockImplementation(function mockStorageSetItem(key, value) {
      if (this === localStorage && key === "xhc.threads") {
        const error = new Error("quota exceeded");
        error.name = "QuotaExceededError";
        throw error;
      }
      return originalSetItem.call(this, key, value);
    });

    saveThreads([{
      id: "thread-fallback",
      title: "Eligibility review",
      createdAt: 1,
      updatedAt: 3,
      messages: [{ role: "assistant", content: "Item 5 of 12" }],
    }]);

    expect(loadThreads()[0].messages[0].content).toBe("Item 5 of 12");
    setItem.mockRestore();
  });

  it("never compacts away a thread linked to an unfinished review", () => {
    localStorage.setItem("xhandle.hazardVibeReview.sessions.v1", JSON.stringify({
      "project:protected-thread": {
        projectId: "project",
        threadId: "protected-thread",
        state: "paused",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    }));
    const threads = Array.from({ length: 24 }, (_, index) => ({
      id: index === 23 ? "protected-thread" : `thread-${index}`,
      title: `Thread ${index}`,
      createdAt: index,
      updatedAt: index,
      messages: [{ role: "assistant", content: `Message ${index}` }],
    }));
    saveThreads(threads);
    expect(loadThreads().some((thread) => thread.id === "protected-thread")).toBe(true);
  });

  it("recreates a missing Collaborator thread with its original id", () => {
    const restored = ensureThread("missing-review-thread", "Recovered safety review");
    expect(restored).toMatchObject({ id: "missing-review-thread", title: "Recovered safety review", protectedByReview: true });
    expect(loadThreads().find((thread) => thread.id === "missing-review-thread")?.messages[0].content).toContain("restored");
  });
});
