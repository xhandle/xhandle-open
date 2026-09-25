/**
 * Paste rendered Collaborator output into a plain textarea as Markdown.
 *
 * Copying a rendered list out of the Collaborator panel puts an HTML fragment
 * and a text/plain fallback on the clipboard. A textarea takes the plain
 * fallback, and the browser's plain rendering of an <ol> drops the numbers, so
 * "1. Truck idles at a staging spot" arrives as bare prose and the list
 * structure the reviewer meant to carry across is gone.
 *
 * This reads the HTML flavour instead and converts it back to Markdown. It
 * started as the Collaborator composer's own paste handler; it lives here so
 * every surface that accepts pasted Collaborator text behaves the same way
 * without importing the Collaborator view.
 */

export function clipboardHtmlToMarkdown(html = "", plainText = "") {
  const source = String(html || "");
  if (!source || typeof DOMParser === "undefined") return String(plainText || "");
  const documentNode = new DOMParser().parseFromString(source, "text/html");
  if (!documentNode.body.querySelector("ul, ol")) return String(plainText || "");

  const inline = (node) => {
    if (node.nodeType === 3) return node.nodeValue || "";
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
    const content = Array.from(node.childNodes).map(inline).join("");
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${content}**`;
    if (tag === "em" || tag === "i") return `*${content}*`;
    if (tag === "code") return `\`${content}\``;
    if (tag === "a") {
      const href = node.getAttribute("href");
      return href ? `[${content}](${href})` : content;
    }
    return content;
  };

  const list = (element, depth = 0) => Array.from(element.children)
    .filter((child) => child.tagName?.toLowerCase() === "li")
    .map((item, index) => {
      const nestedLists = Array.from(item.children).filter((child) => /^(UL|OL)$/.test(child.tagName));
      const directContent = Array.from(item.childNodes)
        .filter((child) => !(child.nodeType === 1 && /^(UL|OL)$/.test(child.tagName)))
        .map(inline)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      const marker = element.tagName.toLowerCase() === "ol" ? `${index + 1}.` : "-";
      const line = `${"  ".repeat(depth)}${marker} ${directContent}`.trimEnd();
      const nested = nestedLists.map((child) => list(child, depth + 1)).filter(Boolean).join("\n");
      return nested ? `${line}\n${nested}` : line;
    })
    .join("\n");

  const block = (node) => {
    if (node.nodeType === 3) return (node.nodeValue || "").trim();
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") return list(node);
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${inline(node).trim()}`;
    if (tag === "blockquote") return inline(node).trim().split("\n").map((line) => `> ${line}`).join("\n");
    if (["p", "div", "section", "article"].includes(tag)) return inline(node).trim();
    return inline(node).trim();
  };

  return Array.from(documentNode.body.childNodes)
    .map(block)
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The Markdown a paste should insert, or "" when the clipboard carries nothing
 * a textarea would otherwise mangle. Plain-text pastes are left alone.
 */
export function markdownFromClipboard(clipboardData) {
  const html = clipboardData?.getData?.("text/html") || "";
  if (!html || !/<(?:ul|ol)(?:\s|>)/i.test(html)) return "";
  return clipboardHtmlToMarkdown(html, clipboardData?.getData?.("text/plain") || "");
}

/**
 * Insert the Markdown form of a rich paste at the caret.
 *
 * `applyValue(value, element)` receives the textarea's new value so a React
 * state-bound field stays in sync. Returns false when the paste was left to the
 * browser, so a caller can tell the two cases apart.
 */
export function handleMarkdownPaste(event, applyValue) {
  const markdown = markdownFromClipboard(event?.clipboardData);
  if (!markdown) return false;
  event.preventDefault();
  const target = event.currentTarget;
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  target.setRangeText(markdown, start, end, "end");
  applyValue?.(target.value, target);
  return true;
}
