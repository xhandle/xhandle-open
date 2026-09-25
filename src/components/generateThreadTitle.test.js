import { deriveThreadTitle, generateThreadTitle } from "./generateThreadTitle";

describe("Collaborator thread titles", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("derives a concise title from the first discussion topic", () => {
    expect(deriveThreadTitle([
      { role: "assistant", content: "How can I help?" },
      { role: "user", content: "Can you fix the hazard analysis storage issue?" },
    ])).toBe("Fix the hazard analysis storage issue");
  });

  test("falls back to a topic-derived title when automatic title generation fails", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    await expect(generateThreadTitle([
      { role: "user", content: "Review edge routing behavior in the diagram" },
    ])).resolves.toBe("Review edge routing behavior in the");
  });
});
