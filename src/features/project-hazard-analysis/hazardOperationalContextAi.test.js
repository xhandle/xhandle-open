import {
  generateHazardOperationalContexts,
  parseHazardOperationalContextResponse,
} from "./hazardOperationalContextAi";

describe("hazard operational context AI", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  it("parses fenced output and removes duplicate scenario-mode combinations", () => {
    const result = parseHazardOperationalContextResponse(`Here are suggestions:\n\`\`\`json\n[
      {"scenario":"Urban pickup","mode":"Autonomous","conditions":"Rain","assumptions":"Map current"},
      {"scenario":"Urban pickup","mode":"Autonomous","conditions":"Dry","assumptions":"Map current"},
      {"scenario":"Depot maintenance","mode":"Maintenance","conditions":"Vehicle stationary","assumptions":"Technician present"}
    ]\n\`\`\``, 123);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(expect.objectContaining({
      id: "context-ai-123-1-urban-pickup",
      scenario: "Urban pickup",
      mode: "Autonomous",
    }));
    expect(result[1]).toEqual(expect.objectContaining({
      scenario: "Depot maintenance",
      mode: "Maintenance",
    }));
  });

  it("rejects responses without an array", () => {
    expect(() => parseHazardOperationalContextResponse("No contexts available", 123))
      .toThrow("did not contain an operational-context list");
  });

  it("uses the active provider's selected model", async () => {
    localStorage.setItem("xhandle.aiProvider.active", "anthropic");
    localStorage.setItem("xhandle.aiProvider.activeModel", "claude-sonnet-5");
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[{"scenario":"Emergency stop","mode":"Degraded","conditions":"Low traction","assumptions":"Brakes available"}]' } }],
      }),
    });

    const result = await generateHazardOperationalContexts({ description: "An autonomous vehicle" });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.model).toBe("claude-sonnet-5");
    expect(result[0]).toEqual(expect.objectContaining({ scenario: "Emergency stop", mode: "Degraded" }));
  });
});
