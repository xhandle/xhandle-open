import React, { act } from "react";
import { createRoot } from "react-dom/client";
import SafetyReportViewer from "./SafetyReportViewer";

jest.mock("react-markdown", () => {
  const ReactRuntime = require("react");
  return function ReactMarkdownMock({ children, components = {} }) {
    const markdown = String(children || "");
    const sourceMatch = markdown.match(/\[Source Row (\d+)\]\(#hazard-source-row-(\d+)\)/);
    if (sourceMatch && components.a) {
      return ReactRuntime.createElement(
        components.a,
        { href: `#hazard-source-row-${sourceMatch[2]}` },
        `Source Row ${sourceMatch[1]}`
      );
    }
    if (markdown.includes("| Scenario |") && components.table) {
      return ReactRuntime.createElement(
        components.table,
        null,
        ReactRuntime.createElement("tbody", null, ReactRuntime.createElement("tr", null, ReactRuntime.createElement("td", null, "Braking")))
      );
    }
    return ReactRuntime.createElement("div", null, markdown);
  };
});
jest.mock("remark-gfm", () => jest.fn());
jest.mock("rehype-raw", () => jest.fn());

describe("SafetyReportViewer", () => {
  let container;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  it("uses a wide table layout in expanded preview", () => {
    act(() => {
      root.render(
        <SafetyReportViewer
          expanded
          reportText={'| Scenario | Mode | Hazard |\n| --- | --- | --- |\n| Braking | Active | Unsafe response |'}
        />
      );
    });

    expect(container.querySelector("table").className).toContain("min-w-[1200px]");
  });

  it("opens linked hazard source rows through the workspace callback", () => {
    const onOpenSourceRow = jest.fn();
    act(() => {
      root.render(
        <SafetyReportViewer
          reportText={'[Source Row 42](#hazard-source-row-42)'}
          onOpenSourceRow={onOpenSourceRow}
        />
      );
    });

    act(() => {
      container.querySelector('a[href="#hazard-source-row-42"]').dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    expect(onOpenSourceRow).toHaveBeenCalledWith(42);
  });
});
