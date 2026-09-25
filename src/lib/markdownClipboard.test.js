/**
 * Copying a numbered list out of the Collaborator panel and pasting it into a
 * plain textarea loses the numbering: the clipboard's text/plain flavour of an
 * <ol> carries the item text and nothing else. These cover the HTML flavour
 * being read instead.
 */

import {
  clipboardHtmlToMarkdown,
  handleMarkdownPaste,
  markdownFromClipboard,
} from "./markdownClipboard";

const clipboard = (html, plain) => ({
  getData: (type) => (type === "text/html" ? html : plain),
});

describe("clipboardHtmlToMarkdown", () => {
  it("restores the numbering a plain-text paste drops", () => {
    const html = "<ol><li>Truck idles at a staging spot.</li><li>Truck receives a move assignment.</li></ol>";
    const plain = "Truck idles at a staging spot.\nTruck receives a move assignment.";

    expect(clipboardHtmlToMarkdown(html, plain))
      .toBe("1. Truck idles at a staging spot.\n2. Truck receives a move assignment.");
  });

  it("keeps nesting, emphasis, and links", () => {
    expect(clipboardHtmlToMarkdown(
      "<p>Architecture:</p><ul><li><strong>Perception</strong></li><li>Planning<ol><li>Route planning</li></ol></li></ul>",
      "Architecture: Perception Planning Route planning",
    )).toBe("Architecture:\n\n- **Perception**\n- Planning\n  1. Route planning");
  });

  it("falls back to the plain text when the HTML carries no list", () => {
    expect(clipboardHtmlToMarkdown("<p>Just a sentence.</p>", "Just a sentence."))
      .toBe("Just a sentence.");
  });
});

describe("markdownFromClipboard", () => {
  it("leaves an ordinary text paste to the browser", () => {
    expect(markdownFromClipboard(clipboard("", "Plain words"))).toBe("");
    expect(markdownFromClipboard(clipboard("<p>Plain words</p>", "Plain words"))).toBe("");
  });

  it("converts a list paste", () => {
    expect(markdownFromClipboard(clipboard("<ol><li>One</li></ol>", "One"))).toBe("1. One");
  });
});

describe("handleMarkdownPaste", () => {
  const pasteEvent = (target, html, plain) => ({
    clipboardData: clipboard(html, plain),
    currentTarget: target,
    preventDefault: jest.fn(),
  });

  const textarea = (value = "", caret = value.length) => {
    const element = document.createElement("textarea");
    element.value = value;
    element.selectionStart = caret;
    element.selectionEnd = caret;
    return element;
  };

  it("inserts the markdown at the caret and reports the new value", () => {
    const element = textarea("Create the following scenarios:\n");
    const applyValue = jest.fn();
    const event = pasteEvent(element, "<ol><li>Truck idles.</li><li>Truck couples.</li></ol>", "Truck idles.\nTruck couples.");

    expect(handleMarkdownPaste(event, applyValue)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(element.value).toBe("Create the following scenarios:\n1. Truck idles.\n2. Truck couples.");
    expect(applyValue).toHaveBeenCalledWith(element.value, element);
  });

  it("replaces the selected range rather than appending", () => {
    const element = textarea("keep me / replace me");
    element.selectionStart = 10;
    element.selectionEnd = 20;
    const event = pasteEvent(element, "<ul><li>New</li></ul>", "New");

    handleMarkdownPaste(event, jest.fn());
    expect(element.value).toBe("keep me / - New");
  });

  it("does nothing for a plain-text paste", () => {
    const element = textarea("existing");
    const applyValue = jest.fn();
    const event = pasteEvent(element, "", "pasted");

    expect(handleMarkdownPaste(event, applyValue)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(element.value).toBe("existing");
    expect(applyValue).not.toHaveBeenCalled();
  });
});
