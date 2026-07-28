jest.mock("./backendConfig", () => ({
  buildAuthOpts: (headers = {}) => ({ headers }),
  buildAIAuthOpts: (headers = {}) => ({ headers }),
}));

const { handleLitePromptSubmit } = require("./LitePromptHandler");

function mockJsonResponse(content, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
    text: async () => content,
  };
}

describe("handleLitePromptSubmit", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the chat proxy before the openai proxy for project decomposition", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      mockJsonResponse(JSON.stringify([
        {
          fromFunction: "Sensor",
          fromDetails: "Collects external measurements for the system.",
          controlAction: "sends measurements",
          controlDetails: "Delivers sampled measurement data to the controller.",
          toFunction: "Controller",
          toDetails: "Receives measurements and determines the next command.",
        },
      ]))
    );

    let response = "";
    await handleLitePromptSubmit(
      [
        "System Name: Test System",
        "Functional Components: Sensor, Controller",
        "Control Interactions: Sensor sends measurements to Controller",
      ].join("\n"),
      (value) => { response = value; },
      () => {}
    );

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/chat");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/openai"))).toBe(false);
    expect(JSON.parse(response)).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromFunction: "Sensor", toFunction: "Controller" }),
    ]));
  });
});
