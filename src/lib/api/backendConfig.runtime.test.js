describe("host-provided runtime backend", () => {
  afterEach(() => {
    delete window.__BACKEND_URL;
    jest.resetModules();
  });

  it("accepts an immutable backend URL supplied by a host", () => {
    jest.resetModules();
    Object.defineProperty(window, "__BACKEND_URL", {
      value: "xhandle://app", configurable: true, writable: false,
    });
    const { backendURL } = require("./backendConfig");
    expect(backendURL).toBe("xhandle://app");
    expect(window.__BACKEND_URL).toBe("xhandle://app");
  });
});
