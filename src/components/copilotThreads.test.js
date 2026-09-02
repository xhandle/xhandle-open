import { loadThreads, saveThreads } from "./copilotThreads";

describe("Collaborator thread persistence", () => {
  beforeEach(() => localStorage.clear());

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
});
