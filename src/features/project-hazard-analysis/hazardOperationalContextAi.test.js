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

  it("accepts Claude-style object envelopes and common context property names", () => {
    const result = parseHazardOperationalContextResponse(JSON.stringify({
      operational_contexts: [{
        scenario: "Recovery after a fall",
        mode: "Protective recovery",
        conditions: "Robot is grounded near people",
        assumptions: "Joint sensing remains available",
      }],
    }), 124);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      scenario: "Recovery after a fall",
      mode: "Protective recovery",
    }));
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

  it("repairs a malformed Claude response before surfacing an error", async () => {
    localStorage.setItem("xhandle.aiProvider.active", "anthropic");
    localStorage.setItem("xhandle.aiProvider.activeModel", "claude-fable-5-1");
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "I considered normal operation, emergency stopping, and maintenance." } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            contexts: [
              {
                scenario: "Normal task execution",
                mode: "Autonomous",
                conditions: "People may enter the work envelope",
                assumptions: "Safety sensing is available",
              },
              {
                scenario: "Protective stop",
                mode: "Degraded",
                conditions: "A safety-envelope violation is active",
                assumptions: "Joint brakes remain available",
              },
              {
                scenario: "Scheduled service",
                mode: "Maintenance",
                conditions: "A technician is inside the safeguarded area",
                assumptions: "Autonomous motion is inhibited",
              },
            ],
          }) } }],
        }),
      });

    const result = await generateHazardOperationalContexts({
      description: "A humanoid robot working near people",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(3);
    const repairRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(repairRequest.model).toBe("claude-fable-5-1");
    expect(repairRequest.messages[0].content).toMatch(/repair structured operational-context output/i);
    expect(repairRequest.messages[1].content).toMatch(/Invalid response:/);
  });

  it("repairs an empty first response using the original request", async () => {
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "" } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            contexts: [
              { scenario: "Normal operation", mode: "Automatic", conditions: "Nominal environment", assumptions: "All required resources are available" },
              { scenario: "Degraded operation", mode: "Limited capability", conditions: "A required resource is unavailable", assumptions: "Fallback capability remains available" },
              { scenario: "Maintenance", mode: "Service", conditions: "Authorized personnel are present", assumptions: "Automatic operation is inhibited" },
            ],
          }) } }],
        }),
      });

    const result = await generateHazardOperationalContexts({
      description: "A platform-independent safety-critical system",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(3);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages[1].content)
      .toMatch(/platform-independent safety-critical system/);
  });
});
