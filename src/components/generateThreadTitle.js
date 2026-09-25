// src/components/generateThreadTitle.js
import { buildAIAuthOpts } from "./backendConfig";

export function deriveThreadTitle(messages = []) {
  const topic = [...messages]
    .reverse()
    .find((message) => message?.role === "user" && String(message?.content || "").trim());
  const cleaned = String(topic?.content || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_#>`~(){}]/g, " ")
    .replaceAll("[", " ")
    .replaceAll("]", " ")
    .replace(/^(?:please\s+)?(?:can|could|would)\s+you\s+/i, "")
    .replace(/^(?:please\s+)?(?:help\s+(?:me\s+)?(?:to\s+)?|let(?:'s| us)\s+|i\s+(?:want|need|would like)\s+(?:to\s+)?)/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "General Collaborator Chat";
  const words = cleaned.split(" ").slice(0, 6);
  const title = words.join(" ").replace(/[.,;:!?-]+$/g, "").trim();
  if (!title) return "General Collaborator Chat";
  return `${title.charAt(0).toUpperCase()}${title.slice(1)}`.slice(0, 80);
}

export async function generateThreadTitle(messages) {
    const fallbackTitle = deriveThreadTitle(messages);
    const slice = messages.slice(-8).map(m => `${m.role}: ${m.content}`).join("\n\n");
    const prompt = `Name this chat thread in 3–5 words.
  Rules:
  - Title Case
  - No quotes
  - Be specific if possible
  - If unclear, output: General Collaborator Chat
  
  Conversation:
  ${slice}
  
  ONLY OUTPUT THE TITLE TEXT.`;
  
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        ...buildAIAuthOpts({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!resp.ok) return fallbackTitle;
      const data = await resp.json();
      return (data.result || data.choices?.[0]?.message?.content || "").trim() || fallbackTitle;
    } catch {
      return fallbackTitle;
    }
  }
  
