import React from "react";
import { createRoot } from "react-dom/client";
import ResultsReviewDrawer from "./ResultsReviewDrawer";

const { act } = React;
global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("lucide-react", () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

describe("ResultsReviewDrawer dock-aware layout", () => {
  it("keeps the complete drawer inside the workspace left of Collaborator", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const props = {
      isOpen: true,
      options: {},
      items: [],
      onClose: jest.fn(),
      onToggleExpanded: jest.fn(),
      onApproveAsIs: jest.fn(),
      onApproveWithModifications: jest.fn(),
      onReject: jest.fn(),
      onNeedsRegeneration: jest.fn(),
      onRequestRegeneration: jest.fn(),
      onNeedsMoreContext: jest.fn(),
    };

    try {
      act(() => root.render(<ResultsReviewDrawer {...props} />));
      const viewport = host.firstElementChild;
      const drawer = viewport.firstElementChild;

      expect(viewport.className).toContain("left-0");
      expect(viewport.className).toContain("justify-end");
      expect(viewport.className).toContain("right-[var(--xhandle-collaborator-reserved-width)]");
      expect(drawer.className).toContain("w-[var(--results-review-drawer-width)]");
      expect(drawer.className).toContain("max-w-full");

      act(() => root.render(<ResultsReviewDrawer {...props} isExpanded />));
      expect(host.firstElementChild.firstElementChild.className)
        .toContain("w-[var(--results-review-drawer-expanded-width)]");
      expect(host.firstElementChild.firstElementChild.className).toContain("max-w-full");
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
