// src/components/generateThreadTitle.js
import { buildAIAuthOpts } from "./backendConfig";

export async function generateThreadTitle(messages) {
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
  
    const resp = await fetch("/api/chat", {
      method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error("title_generation_failed");
    const data = await resp.json();
    return (data.result || data.choices?.[0]?.message?.content || "").trim();
  }
  
