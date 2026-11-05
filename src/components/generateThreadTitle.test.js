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

test('uses current provider configuration and aborts background naming on demand',async()=>{
 const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue({ok:true,json:async()=>({result:'Saved Analysis Review'})});const controller=new AbortController();
 await generateThreadTitle([{role:'user',content:'Review saved analysis'}],{signal:controller.signal});const payload=JSON.parse(fetchMock.mock.calls[0][1].body);expect(payload).not.toHaveProperty('model');expect(payload.xhandleWorkflow).toBe('collaborator.title');expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
 controller.abort();await expect(generateThreadTitle([],{signal:controller.signal})).rejects.toHaveProperty('name','AbortError');
});
