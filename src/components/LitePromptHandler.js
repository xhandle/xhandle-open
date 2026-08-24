import { buildAIAuthOpts } from "./backendConfig";

const MODEL = "gpt-4o";
const MAX_OUTPUT_TOKENS = 4000;
const MAX_CHARS_PER_CHUNK = 6000;
const MAX_OPENAI_PROXY_FAILURES_PER_RUN = 1;
const TRANSIENT_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const SECTION_FALLBACKS = {
  systemName: ["System Name"],
  systemOverview: ["System Overview", "System Purpose", "Objective"],
  functionalComponents: ["Functional Components", "Components"],
  interactions: ["Control Interactions", "Interactions"],
  ops: ["Operational Scenarios / Modes of Operation", "Operational Scenarios", "Modes of Operation"],
};

function uniqueStrings(items) {
  return Array.from(new Set((items || []).map((x) => String(x || "").trim()).filter(Boolean)));
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractBalancedJsonArray(text) {
  const src = String(text || "");
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "[") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "]" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

function parseRowsFromContent(content) {
  const direct = parseJsonMaybe(content);
  if (Array.isArray(direct)) return direct;

  const fenced = String(content || "").match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsedFence = parseJsonMaybe(fenced);
    if (Array.isArray(parsedFence)) return parsedFence;
  }

  const extracted = extractBalancedJsonArray(content);
  if (!extracted) return [];
  const parsed = parseJsonMaybe(extracted);
  return Array.isArray(parsed) ? parsed : [];
}

function extractAIText(payload) {
  const candidates = [
    payload?.choices?.[0]?.message?.content,
    payload?.choices?.[0]?.text,
    payload?.result,
    payload?.answer,
    payload?.content,
    payload?.message,
    payload?.text,
    payload?.data?.result,
    payload?.data?.content,
  ];
  return candidates
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean) || "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeField(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function formatClarificationsForPrompt(value) {
  const blocks = [];
  const appendQuestion = (stepLabel, item) => {
    const question = normalizeField(item?.question);
    const answer = normalizeField(item?.answer);
    if (!question || !answer) return;
    blocks.push(`- ${stepLabel}: ${question}\n  Answer: ${answer}`);
  };

  if (Array.isArray(value)) {
    value.forEach((item) => appendQuestion("General", item));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([stepKey, items]) => {
      if (!Array.isArray(items)) return;
      const stepLabel = stepKey.replace(/([a-z])([A-Z])/g, "$1 $2");
      items.forEach((item) => appendQuestion(stepLabel, item));
    });
  }

  return blocks.join("\n");
}

function extractStructuredInput(prompt) {
  const raw = String(prompt || "").trim();
  const parsed = parseJsonMaybe(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return {
      systemName: normalizeField(parsed.system || parsed.systemName),
      systemOverview: normalizeField(parsed.objective || parsed.systemOverview || parsed.purpose),
      functionalComponents: normalizeField(parsed.components || parsed.functionalComponents),
      interactions: normalizeField(parsed.interactions),
      ops: normalizeField(parsed?.optional?.operationalScenarios || parsed.ops || parsed.operationalScenarios),
      clarifications: formatClarificationsForPrompt(parsed.clarifications || parsed.clarificationResponses),
      raw,
    };
  }

  const labels = Object.entries(SECTION_FALLBACKS).flatMap(([key, names]) => names.map((name) => ({ key, name })));
  const positions = labels
    .map(({ key, name }) => {
      const idx = raw.indexOf(`${name}:`);
      return idx >= 0 ? { key, name, idx } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.idx - b.idx);

  if (!positions.length) {
    return {
      systemName: "",
      systemOverview: "",
      functionalComponents: "",
      interactions: raw,
      ops: "",
      clarifications: "",
      raw,
    };
  }

  const out = { systemName: "", systemOverview: "", functionalComponents: "", interactions: "", ops: "", clarifications: "", raw };
  positions.forEach((cur, i) => {
    const next = positions[i + 1];
    const start = cur.idx + cur.name.length + 1;
    const end = next ? next.idx : raw.length;
    out[cur.key] = normalizeField(raw.slice(start, end));
  });
  return out;
}

function normalizeComponents(componentsText) {
  return uniqueStrings(
    String(componentsText || "")
      .split(/\n|,|;|•|·|\|/g)
      .map((s) => s.replace(/^[\s*-]+/, "").trim())
  );
}

function parseComponentEntries(componentsText) {
  return String(componentsText || "")
    .split(/\n+/)
    .map((line) => line.replace(/^[\s*-]+/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const fields = {};
      line.split("|").forEach((part) => {
        const colonIndex = part.indexOf(":");
        if (colonIndex <= 0) return;
        fields[part.slice(0, colonIndex).trim().toLowerCase()] = part.slice(colonIndex + 1).trim();
      });
      if (fields.function || fields.component || fields.name || fields.subsystem || fields.description) {
        return {
          name: normalizeField(fields.function || fields.component || fields.name),
          subsystem: normalizeField(fields.subsystem),
          description: normalizeField(fields.description || fields.role),
        };
      }
      const colonIndex = line.indexOf(":");
      return {
        name: normalizeField(colonIndex > 0 ? line.slice(0, colonIndex) : line),
        subsystem: "",
        description: normalizeField(colonIndex > 0 ? line.slice(colonIndex + 1) : ""),
      };
    })
    .filter((entry) => entry.name);
}

function chunkText(text, maxChars = MAX_CHARS_PER_CHUNK) {
  const src = normalizeField(text);
  if (!src) return [];
  if (src.length <= maxChars) return [src];

  const lines = src
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const units = lines.length > 1 ? lines : src.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  units.forEach((unit) => {
    if (!unit) return;
    const candidate = current ? `${current}\n${unit}` : unit;
    if (candidate.length <= maxChars) {
      current = candidate;
      return;
    }
    if (current) chunks.push(current);
    if (unit.length <= maxChars) {
      current = unit;
      return;
    }
    let start = 0;
    while (start < unit.length) {
      chunks.push(unit.slice(start, start + maxChars));
      start += maxChars;
    }
    current = "";
  });

  if (current) chunks.push(current);
  return chunks;
}

function buildChunkRequests(prompt) {
  const sections = extractStructuredInput(prompt);
  const componentEntries = parseComponentEntries(sections.functionalComponents);
  const componentList = componentEntries.length
    ? uniqueStrings(componentEntries.map((entry) => entry.name))
    : normalizeComponents(sections.functionalComponents);
  const subsystemByComponent = new Map(componentEntries.map((entry) => [entry.name.toLowerCase(), entry.subsystem]));
  const componentBlock = componentEntries.length
    ? componentEntries.map((entry) => `- ${entry.name}${entry.subsystem ? ` [Subsystem: ${entry.subsystem}]` : ""}${entry.description ? `: ${entry.description}` : ""}`).join("\n")
    : componentList.length
      ? componentList.map((name) => `- ${name}`).join("\n")
    : sections.functionalComponents || "None provided";

  const longSections = [
    { label: "System Overview", value: sections.systemOverview },
    { label: "Control Interactions", value: sections.interactions },
    { label: "Operational Scenarios", value: sections.ops },
  ];

  const chunkParts = [];
  longSections.forEach(({ label, value }) => {
    const chunks = chunkText(value);
    if (!chunks.length && value) chunkParts.push(`${label}:\n${value}`);
    else chunks.forEach((chunk, index) => {
      chunkParts.push(`${label}${chunks.length > 1 ? ` (Part ${index + 1}/${chunks.length})` : ""}:\n${chunk}`);
    });
  });

  const chunkBodies = chunkParts.length ? chunkParts : ["Control Interactions:\nNone provided."];
  return chunkBodies.map((body, index) => ({
    systemName: sections.systemName,
    componentList,
    systemPrompt: [
      "You are an AI system engineering assistant.",
      "Return ONLY a JSON array.",
      "Each item must include: subsystem, fromFunction, fromDetails, controlAction, controlDetails, toFunction, toDetails.",
      "Set subsystem to the supplied subsystem for the source/from function when available; otherwise infer the most appropriate subsystem from the component list and system context.",
      "Use exact component names from the provided component list whenever possible.",
      "Represent bidirectional interfaces as two separate objects.",
      "Write detailed descriptions, not labels: fromDetails and toDetails must explain each function's responsibility, inputs it consumes, outputs it produces, state/data it owns or transforms, and relevant operating constraints.",
      "Write controlDetails as an interface description that explains what information, command, signal, event, or material crosses the boundary, why it is sent, expected timing/trigger, receiver effect, and any safety/quality assumptions.",
      "Use 18-35 words for each details field when evidence supports it. Avoid generic phrases such as handles data, manages system, provides interface, or processes input unless the concrete data/control path is named.",
      "Do not include prose, markdown, comments, or code fences.",
    ].join(" "),
    userPrompt: [
      `System Name: ${sections.systemName || "System"}`,
      sections.clarifications ? `Clarification Answers:\n${sections.clarifications}` : "",
      "Functional Components (exact names):",
      componentBlock,
      body,
    ].filter(Boolean).join("\n\n"),
    index,
    total: chunkBodies.length,
    subsystemByComponent,
  }));
}

function mergeRows(chunks, subsystemLookup = new Map()) {
  const merged = [];
  const seen = new Set();

  (chunks || []).forEach((row) => {
    if (!row || typeof row !== "object") return;
    const normalized = {
      subsystem: normalizeField(row.subsystem) || subsystemLookup.get(normalizeField(row.fromFunction).toLowerCase()) || "",
      fromFunction: normalizeField(row.fromFunction),
      fromDetails: normalizeField(row.fromDetails),
      controlAction: normalizeField(row.controlAction),
      controlDetails: normalizeField(row.controlDetails),
      toFunction: normalizeField(row.toFunction),
      toDetails: normalizeField(row.toDetails),
    };
    if (!normalized.fromFunction || !normalized.controlAction || !normalized.toFunction) return;
    const key = [
      normalized.fromFunction.toLowerCase(),
      normalized.controlAction.toLowerCase(),
      normalized.toFunction.toLowerCase(),
      normalized.fromDetails.toLowerCase(),
      normalized.controlDetails.toLowerCase(),
      normalized.toDetails.toLowerCase(),
      normalized.subsystem.toLowerCase(),
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalized);
  });

  return merged;
}

function fallbackRowsFromPrompt(prompt) {
  const sections = extractStructuredInput(prompt);
  const rows = [];
  const arrowRe = /(.+?)\s*(?:->|→)\s*(.+?)\s*(?:->|→)\s*(.+)/;
  const componentEntries = parseComponentEntries(sections.functionalComponents);
  const componentList = componentEntries.length
    ? uniqueStrings(componentEntries.map((entry) => entry.name))
    : normalizeComponents(sections.functionalComponents);
  const subsystemLookup = new Map(componentEntries.map((entry) => [entry.name.toLowerCase(), entry.subsystem]));

  const matchNamedComponents = (line) => {
    const lower = line.toLowerCase();
    const matches = componentList
      .filter((name) => lower.includes(name.toLowerCase()))
      .sort((a, b) => lower.indexOf(a.toLowerCase()) - lower.indexOf(b.toLowerCase()));
    if (matches.length >= 2) return [matches[0], matches[1]];
    return null;
  };

  const inferControlAction = (line, from, to) => {
    const clean = normalizeField(line.replace(/^[\s*-]+/, ""));
    const withoutComponents = clean
      .replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "")
      .replace(new RegExp(to.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "")
      .replace(/\s+/g, " ")
      .trim();
    const verbMatch = withoutComponents.match(/\b(sends?|provides?|requests?|reports?|publishes?|receives?|commands?|notifies?|alerts?|updates?|streams?|forwards?|returns?|passes?|transmits?|delivers?)\b(.+?)(?:\bto\b|\bfrom\b|\bso\b|\bwhen\b|$)/i);
    const action = verbMatch ? `${verbMatch[1]} ${verbMatch[2] || ""}`.trim() : withoutComponents;
    return normalizeField(action || `communicates with ${to}`).slice(0, 160);
  };

  String(sections.interactions || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const match = line.match(arrowRe);
      if (!match) return;
      rows.push({
        subsystem: subsystemLookup.get(normalizeField(match[1]).toLowerCase()) || "",
        fromFunction: normalizeField(match[1]),
        fromDetails: "",
        controlAction: normalizeField(match[2]),
        controlDetails: "",
        toFunction: normalizeField(match[3]),
        toDetails: "",
      });
    });

  if (!rows.length) {
    String(sections.interactions || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const pair = matchNamedComponents(line);
        if (!pair) return;
        const [from, to] = pair;
        rows.push({
          subsystem: subsystemLookup.get(from.toLowerCase()) || "",
          fromFunction: from,
          fromDetails: `${from} participates in the ${sections.systemName || "system"} functional architecture based on the prompt wizard inputs.`,
          controlAction: inferControlAction(line, from, to),
          controlDetails: normalizeField(line.replace(/^[\s*-]+/, "")),
          toFunction: to,
          toDetails: `${to} receives or responds to this interaction as part of the described system behavior.`,
        });
      });
  }

  if (!rows.length && componentList.length >= 2) {
    for (let i = 0; i < componentList.length - 1; i += 1) {
      rows.push({
        subsystem: subsystemLookup.get(componentList[i].toLowerCase()) || "",
        fromFunction: componentList[i],
        fromDetails: `${componentList[i]} is a prompt-specified functional component in ${sections.systemName || "the system"}.`,
        controlAction: "coordinates operational information",
        controlDetails: `Derived fallback interaction from the prompt wizard component list because the AI decomposition service was unavailable.`,
        toFunction: componentList[i + 1],
        toDetails: `${componentList[i + 1]} participates in the adjacent functional flow and should be refined by a reviewer.`,
      });
    }
  }

  return mergeRows(rows, subsystemLookup);
}

async function fetchChatChunk(systemPrompt, userPrompt) {
  return fetch("/api/chat", {
    method: "POST",
    ...buildAIAuthOpts({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      model: MODEL,
      xhandleModelLocked: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: MAX_OUTPUT_TOKENS,
    }),
  });
}

async function fetchOpenAIChunk(systemPrompt, userPrompt) {
  return fetch("/api/chat", {
    method: "POST",
    ...buildAIAuthOpts({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      model: "gpt-4o-mini",
      xhandleModelLocked: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: MAX_OUTPUT_TOKENS,
    }),
  });
}

async function requestRowsWithRetry(fetcher, label, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const resp = await fetcher();

    if (resp.ok) {
      const data = await resp.json();
      const rows = parseRowsFromContent(extractAIText(data) || "[]");
      if (rows.length) return rows;
      lastError = new Error(`${label} returned no parseable rows.`);
      break;
    }

    const errTxt = await resp.text();
    lastError = new Error(`${label} error (${resp.status}): ${errTxt}`);
    if (!TRANSIENT_STATUSES.has(resp.status)) break;
    if (attempt < attempts) await sleep(500 * attempt);
  }
  throw lastError || new Error(`${label} failed.`);
}

async function requestChunk(systemPrompt, userPrompt, runState = {}) {
  try {
    return await requestRowsWithRetry(
      () => fetchChatChunk(systemPrompt, userPrompt),
      "LLM chat proxy",
      2
    );
  } catch (chatError) {
    if ((runState.openAIProxyFailures || 0) >= MAX_OPENAI_PROXY_FAILURES_PER_RUN) {
      throw chatError;
    }
    try {
      return await requestRowsWithRetry(
        () => fetchOpenAIChunk(systemPrompt, userPrompt),
        "LLM openai proxy",
        1
      );
    } catch (openAIError) {
      runState.openAIProxyFailures = (runState.openAIProxyFailures || 0) + 1;
      throw new Error(`${chatError.message}; ${openAIError.message}`);
    }
  }
}

export const handleLitePromptSubmit = async (prompt, setResponse, setPrompt, context = {}) => {
  if (!prompt || prompt.trim().length === 0) {
    setResponse(JSON.stringify([], null, 2));
    setPrompt("");
    return;
  }

  try {
    const requests = buildChunkRequests(prompt);
    const allRows = [];
    const runState = { openAIProxyFailures: 0 };

    for (const req of requests) {
      try {
        const rows = await requestChunk(req.systemPrompt, req.userPrompt, runState);
        allRows.push(...rows);
      } catch (chunkErr) {
        console.warn(`Lite decomposition chunk ${req.index + 1}/${req.total} failed`, chunkErr);
      }
    }

    const merged = mergeRows(allRows, requests[0]?.subsystemByComponent || new Map());
    const fallback = merged.length ? merged : fallbackRowsFromPrompt(prompt);
    setResponse(JSON.stringify(fallback, null, 2));
  } catch (err) {
    console.error("Failed to fetch LLM decomposition:", err);
    setResponse(JSON.stringify(fallbackRowsFromPrompt(prompt), null, 2));
  } finally {
    setPrompt("");
  }
};
