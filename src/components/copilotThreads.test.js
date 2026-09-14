import { loadThreads, saveThreads } from "./copilotThreads";

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
});
