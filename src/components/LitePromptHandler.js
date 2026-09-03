import { buildAIAuthOpts } from "./backendConfig";
import {
  DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL,
  getFunctionalAbstractionLevelOption,
  getFunctionalAbstractionPromptGuidance,
  normalizeFunctionalAbstractionLevel,
} from "./functionalDecompositionAbstraction";
import {
  FUNCTIONAL_DECOMPOSITION_CORE_INSTRUCTIONS,
  FUNCTIONAL_DECOMPOSITION_SAMPLING,
} from "./functionalDecompositionGeneration";

const MODEL = "gpt-4o";
const MAX_OUTPUT_TOKENS = 12000;
const MAX_BLUEPRINT_TOKENS = 4500;
const MAX_CHARS_PER_CHUNK = 30000;
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
  if (direct && typeof direct === "object") {
    const wrappedRows = direct.rows || direct.interfaces || direct.functionalDecomposition;
    if (Array.isArray(wrappedRows)) return wrappedRows;
  }

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

function extractBalancedJsonObject(text) {
  const src = String(text || "");
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < src.length; i += 1) {
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
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

function parseArchitectureBlueprint(content) {
  const direct = parseJsonMaybe(content);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;

  const fenced = String(content || "").match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsedFence = parseJsonMaybe(fenced);
    if (parsedFence && typeof parsedFence === "object" && !Array.isArray(parsedFence)) return parsedFence;
  }

  const extracted = extractBalancedJsonObject(content);
  if (!extracted) return null;
  const parsed = parseJsonMaybe(extracted);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function getBlueprintInventory(blueprint) {
  const functions = [];
  const subsystemNames = [];
  const subsystemLookup = new Map();
  const rawSubsystems = Array.isArray(blueprint?.subsystems)
    ? blueprint.subsystems
    : blueprint?.subsystems && typeof blueprint.subsystems === "object"
      ? Object.entries(blueprint.subsystems).map(([name, value]) => (
        value && typeof value === "object" ? { name, ...value } : { name, functions: value }
      ))
      : [];
  rawSubsystems.forEach((subsystem) => {
    const subsystemName = normalizeField(subsystem?.name || subsystem?.subsystem);
    if (subsystemName) subsystemNames.push(subsystemName);
    (Array.isArray(subsystem?.functions) ? subsystem.functions : []).forEach((entry) => {
      const functionName = normalizeFunctionName(
        typeof entry === "string" ? entry : entry?.name || entry?.function || entry?.functionName
      );
      if (!functionName) return;
      functions.push(functionName);
      if (subsystemName) subsystemLookup.set(functionName.toLowerCase(), subsystemName);
    });
  });
  return {
    functions: uniqueStrings(functions),
    subsystemNames: uniqueStrings(subsystemNames),
    subsystemLookup,
  };
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

function normalizeFunctionName(value) {
  const normalized = normalizeField(value);
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(normalized)) return normalized;
  return normalized
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
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
      abstractionLevel: normalizeFunctionalAbstractionLevel(
        parsed.abstractionLevel || parsed.decompositionDepth || parsed.decompositionLevel
      ),
      systemOverview: normalizeField(parsed.objective || parsed.systemOverview || parsed.purpose),
      functionalComponents: normalizeField(parsed.components || parsed.functionalComponents),
      interactions: normalizeField(parsed.interactions),
      ops: normalizeField(parsed?.optional?.operationalScenarios || parsed.ops || parsed.operationalScenarios),
      clarifications: formatClarificationsForPrompt(parsed.clarifications || parsed.clarificationResponses),
      aiGeneratedFields: uniqueStrings(parsed?.evidenceProvenance?.aiGeneratedFields),
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
      abstractionLevel: DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL,
      systemOverview: "",
      functionalComponents: "",
      interactions: raw,
      ops: "",
      clarifications: "",
      aiGeneratedFields: [],
      raw,
    };
  }

  const out = {
    systemName: "",
    abstractionLevel: DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL,
    systemOverview: "",
    functionalComponents: "",
    interactions: "",
    ops: "",
    clarifications: "",
    aiGeneratedFields: [],
    raw,
  };
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

function buildArchitectureBlueprintRequest(prompt) {
  const sections = extractStructuredInput(prompt);
  const abstractionOption = getFunctionalAbstractionLevelOption(sections.abstractionLevel);
  const componentEntries = parseComponentEntries(sections.functionalComponents);
  const inventoryTarget = {
    system: "Aim for 4-8 major subsystems and roughly 6-12 broad capability functions when the system warrants them.",
    subsystem: "Aim for 4-10 major subsystems and roughly 12-22 capability functions, normally allocating at least two functions to each nontrivial subsystem.",
    "detailed-functional": "Aim for roughly 18-32 implementable leaf functions across the warranted subsystem owners, with additional depth where the system is genuinely complex.",
    "multi-level": "Aim for 5-12 major subsystems and roughly 20-36 implementable leaf functions, normally allocating at least two cohesive leaves to each nontrivial subsystem.",
  }[abstractionOption.value];
  const provenanceLabel = (field) => sections.aiGeneratedFields.includes(field)
    ? "AI-generated hypothesis; independently verify"
    : "user-authored evidence";
  const suppliedArchitecture = [
    sections.systemOverview ? `System Overview [${provenanceLabel("systemOverview")}]:\n${sections.systemOverview}` : "",
    sections.functionalComponents ? `Wizard Functions and Allocations [${provenanceLabel("functionalComponents")}]:\n${sections.functionalComponents}` : "",
    sections.interactions ? `Wizard Interactions [${provenanceLabel("interactions")}]:\n${sections.interactions}` : "",
    sections.ops ? `Operational Scenarios and Modes [${provenanceLabel("ops")}]:\n${sections.ops}` : "",
    sections.clarifications ? `Clarification Answers:\n${sections.clarifications}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    systemPrompt: [
      "You are the architecture-planning stage of a systems-engineering workflow.",
      "Infer a domain-specific functional architecture before any interface table is written.",
      `The user selected ${abstractionOption.label}: ${abstractionOption.description}.`,
      getFunctionalAbstractionPromptGuidance(abstractionOption.value),
      inventoryTarget,
      "Treat wizard entries as evidence to improve and expand, not as a mandatory shallow chain.",
      "Treat AI-completed wizard functions and interactions as hypotheses, not verified requirements. Retain them only when supported by the stated mission or necessary to the system class.",
      "When the user supplies only a broad system class or name, produce a conservative platform reference architecture: prioritize the enabling perception/input, state estimation, representation, planning, control, execution, feedback, resource, and safety capabilities intrinsic to that class. Do not invent a customer persona, application vertical, companion role, healthcare role, entertainment role, or smart-environment integration.",
      "Identify the capabilities that are essential to the named system's actual mission, environment, embodiment, control problem, and credible operating modes.",
      "Prefer domain-specific subsystem and function names over generic labels such as Data Processing, Control System, Decision Making, Sensor Suite, or User Interface whenever the evidence supports a more precise responsibility.",
      "Separate sensing and input acquisition, interpretation or estimation, world/state representation, decision or planning, control, execution, and measured feedback where those are distinct responsibilities in this domain.",
      "Include only warranted supporting concerns such as operator interaction, configuration and mode management, health and fault management, resources or power, communications, security, degraded operation, recovery, and emergency control.",
      "For each major subsystem, identify enough cohesive verb-noun functions to expose its internal behavior at the selected depth. Do not use hardware nouns, payloads, commands, or subsystem containers as leaf functions.",
      "For subsystem, detailed-functional, and multi-level output, the overall system name is the scope boundary and must not be listed as an internal subsystem.",
      "Define at least one end-to-end mission thread and the operational feedback loops that close control or decision behavior. Distinguish genuine external actors and systems from internal functions.",
      "Return one JSON object with keys: scopeBoundary, externalActors, subsystems, missionThreads, feedbackLoops, operatingModes, and architectureRisks. These collection-valued keys must contain JSON arrays.",
      "Each subsystem must contain name, responsibility, and functions. Each function must contain name, responsibility, consumes, produces, state, and constraints.",
      "Each mission thread and feedback loop must be an ordered array of exact function names from the subsystem inventory, with genuine external endpoints included only where applicable.",
      "Silently check domain completeness, allocation consistency, interface compatibility, and selected-depth coverage before returning JSON.",
      "Return JSON only. Do not include markdown or commentary.",
    ].join(" "),
    userPrompt: [
      `System Name: ${sections.systemName || "System"}`,
      `Selected Decomposition Depth: ${abstractionOption.label} — ${abstractionOption.description}`,
      suppliedArchitecture || "No additional architecture evidence was supplied. Infer a conservative reference architecture from the system name and selected depth.",
      componentEntries.length
        ? "Preserve valid user-named concepts, but correct their functional allocation and add missing domain-essential functions."
        : "Infer the smallest credible domain architecture that fully explains the system mission at the selected depth.",
    ].join("\n\n"),
  };
}

function buildChunkRequests(prompt, architectureBlueprintContent = "") {
  const sections = extractStructuredInput(prompt);
  const abstractionOption = getFunctionalAbstractionLevelOption(sections.abstractionLevel);
  const abstractionGuidance = getFunctionalAbstractionPromptGuidance(abstractionOption.value);
  const architectureBlueprint = parseArchitectureBlueprint(architectureBlueprintContent);
  const blueprintInventory = getBlueprintInventory(architectureBlueprint);
  const componentEntries = parseComponentEntries(sections.functionalComponents);
  const componentsAreAIGenerated = sections.aiGeneratedFields.includes("functionalComponents");
  const authoritativeComponentEntries = componentsAreAIGenerated ? [] : componentEntries;
  const componentList = componentEntries.length
    ? uniqueStrings(componentEntries.map((entry) => entry.name))
    : normalizeComponents(sections.functionalComponents);
  const subsystemByComponent = new Map([
    ...blueprintInventory.subsystemLookup.entries(),
    ...authoritativeComponentEntries
      .filter((entry) => entry.subsystem)
      .map((entry) => [entry.name.toLowerCase(), entry.subsystem]),
  ]);
  const componentBlock = componentEntries.length
    ? componentEntries.map((entry) => `- ${entry.name}${entry.subsystem ? ` [Subsystem: ${entry.subsystem}]` : ""}${entry.description ? `: ${entry.description}` : ""}`).join("\n")
    : componentList.length
      ? componentList.map((name) => `- ${name}`).join("\n")
    : sections.functionalComponents || "None provided";

  const provenanceLabel = (field) => sections.aiGeneratedFields.includes(field)
    ? "AI-generated hypothesis; independently verify"
    : "user-authored evidence";
  const architectureSections = [
    { field: "systemOverview", label: "System Overview", value: sections.systemOverview },
    { field: "interactions", label: "Control Interactions", value: sections.interactions },
    { field: "ops", label: "Operational Scenarios", value: sections.ops },
  ]
    .filter(({ value }) => normalizeField(value))
    .map(({ field, label, value }) => `${label} [${provenanceLabel(field)}]:\n${normalizeField(value)}`);
  const integratedArchitectureContext = architectureSections.join("\n\n")
    || "Control Interactions:\nNone provided.";
  const chunkBodies = chunkText(integratedArchitectureContext);
  return chunkBodies.map((body, index) => ({
    systemName: sections.systemName,
    componentList,
    systemPrompt: [
      "You are an AI system engineering assistant.",
      "Create an architecture-review-ready functional decomposition from all supplied wizard evidence, then silently check it for coverage, consistency, and duplicates before returning it.",
      FUNCTIONAL_DECOMPOSITION_CORE_INSTRUCTIONS,
      `The user selected ${abstractionOption.label}: ${abstractionOption.description}.`,
      abstractionGuidance,
      "Return ONLY one JSON array.",
      "Each item must include: subsystem, fromFunction, fromDetails, controlAction, controlDetails, toFunction, toDetails.",
      "Treat subsystem as the owner of fromFunction. Keep every function under one consistent subsystem, and do not use the overall system name as a subsystem when the requested scope is an internal system decomposition.",
      "Treat supplied components as architecture evidence, not as a restriction to a shallow component-to-component chain. Derive concrete verb-noun functions within the supplied or strongly implied subsystems when the requested detail requires them.",
      "AI-generated wizard fields are unverified hypotheses. They must not override the system name, user-authored mission evidence, or the reviewed architecture blueprint, and they must not force optional product features into the result.",
      "Use the architecture blueprint as the primary coverage and allocation plan. Correct it only when it conflicts with explicit user evidence or would create an incoherent interface.",
      "Do not collapse domain-distinct stages into a generic processing chain. Preserve the sensing, estimation, representation, planning, control, execution, and feedback distinctions that are meaningful for the named system.",
      "Function endpoints must be behaviors or capabilities. Do not use payloads, commands, acknowledgements, generic placeholders, or broad labels such as All Systems as function endpoints. External actors and systems are allowed only at genuine system-boundary interfaces.",
      "Build a connected primary mission flow from boundary input through sensing/input processing, state or situation understanding, decision/planning, command generation, execution/output, and observable feedback as applicable to this system.",
      "Add the supporting paths warranted by the evidence: configuration and mode control, health/fault monitoring, power/resource management, data persistence, operator interaction, security, degraded operation, recovery, and emergency control. Do not invent unrelated capabilities.",
      "Represent purposeful reverse interfaces as separate rows when feedback, measured state, health, status, requests, constraints, or corrective commands materially affect upstream behavior. Do not add ceremonial acknowledgements merely to create bidirectionality.",
      "Cover every major supplied subsystem with multiple internal functions when its complexity warrants decomposition, and include meaningful cross-subsystem interfaces. Every internal function should participate in the connected graph and should appear as a source when it owns an output.",
      "Use the operational scenarios and modes to identify functions, interfaces, control-authority changes, degraded behavior, and safety paths, but do not turn scenario or mode names into function nodes.",
      "Do not repeat the same Function From + Control Action + Function To interface with alternate wording. Do not create contradictory destinations or ownership for the same function.",
      "Scale depth to the selected level and system complexity. Completeness and coherence matter more than reaching a quota.",
      "Write stable, technically specific function descriptions: fromDetails and toDetails must state responsibility, principal inputs, outputs, owned/transformed state, and relevant constraints without changing meaning between rows.",
      "Write a specific noun-phrase controlAction naming the command, data, status, request, event, or material transferred. Do not use generic actions such as send, process data, or coordinate information.",
      "Write controlDetails that state payload/content, trigger, timing or freshness expectation, receiver effect, and important safety/quality assumptions when supported.",
      "Use 18-35 words for each details field when evidence supports it. Avoid generic phrases such as handles data, manages system, provides interface, or processes input unless the concrete data/control path is named.",
      "Do not include prose, markdown, comments, or code fences.",
    ].join(" "),
    userPrompt: [
      `System Name: ${sections.systemName || "System"}`,
      `Selected Decomposition Depth: ${abstractionOption.label} — ${abstractionOption.description}`,
      sections.clarifications ? `Clarification Answers:\n${sections.clarifications}` : "",
      `Functional Components [${provenanceLabel("functionalComponents")}]:`,
      componentBlock,
      architectureBlueprintContent ? `Architecture Blueprint:\n${architectureBlueprintContent}` : "",
      chunkBodies.length > 1 ? `Architecture evidence excerpt ${index + 1} of ${chunkBodies.length}:` : "Integrated architecture evidence:",
      body,
    ].filter(Boolean).join("\n\n"),
    index,
    total: chunkBodies.length,
    subsystemByComponent,
    architectureBlueprint,
    blueprintInventory,
    abstractionLevel: abstractionOption.value,
  }));
}

function mergeRows(chunks, subsystemLookup = new Map()) {
  const merged = [];
  const rowIndexByInterface = new Map();

  const rowQuality = (row) => [
    row.subsystem,
    row.fromDetails,
    row.controlDetails,
    row.toDetails,
  ].reduce((score, value) => score + normalizeField(value).length, 0);

  (chunks || []).forEach((row) => {
    if (!row || typeof row !== "object") return;
    const rawFromFunction = normalizeField(row.fromFunction);
    const fromFunction = normalizeFunctionName(rawFromFunction);
    const normalized = {
      subsystem: subsystemLookup.get(fromFunction.toLowerCase())
        || subsystemLookup.get(rawFromFunction.toLowerCase())
        || normalizeField(row.subsystem)
        || "",
      fromFunction,
      fromDetails: normalizeField(row.fromDetails),
      controlAction: normalizeField(row.controlAction),
      controlDetails: normalizeField(row.controlDetails),
      toFunction: normalizeFunctionName(row.toFunction),
      toDetails: normalizeField(row.toDetails),
    };
    if (!normalized.fromFunction || !normalized.controlAction || !normalized.toFunction) return;
    const interfaceKey = [
      normalized.fromFunction.toLowerCase(),
      normalized.controlAction.toLowerCase(),
      normalized.toFunction.toLowerCase(),
    ].join("|");
    const existingIndex = rowIndexByInterface.get(interfaceKey);
    if (Number.isFinite(existingIndex)) {
      if (rowQuality(normalized) > rowQuality(merged[existingIndex])) merged[existingIndex] = normalized;
      return;
    }
    rowIndexByInterface.set(interfaceKey, merged.length);
    merged.push(normalized);
  });

  const canonicalDetailsByFunction = new Map();
  const rememberFunctionDetails = (functionName, details) => {
    const key = normalizeField(functionName).toLowerCase();
    const value = normalizeField(details);
    if (!key || !value) return;
    const existing = canonicalDetailsByFunction.get(key) || "";
    if (value.length > existing.length) canonicalDetailsByFunction.set(key, value);
  };
  merged.forEach((row) => {
    rememberFunctionDetails(row.fromFunction, row.fromDetails);
    rememberFunctionDetails(row.toFunction, row.toDetails);
  });

  const subsystemVotesByFunction = new Map();
  merged.forEach((row) => {
    const functionKey = row.fromFunction.toLowerCase();
    const subsystem = normalizeField(row.subsystem);
    if (!functionKey || !subsystem) return;
    const votes = subsystemVotesByFunction.get(functionKey) || new Map();
    votes.set(subsystem, (votes.get(subsystem) || 0) + 1);
    subsystemVotesByFunction.set(functionKey, votes);
  });
  const canonicalSubsystemByFunction = new Map();
  subsystemVotesByFunction.forEach((votes, functionKey) => {
    const supplied = normalizeField(subsystemLookup.get(functionKey));
    if (supplied) {
      canonicalSubsystemByFunction.set(functionKey, supplied);
      return;
    }
    const [winner] = Array.from(votes.entries()).sort((a, b) => b[1] - a[1]);
    if (winner?.[0]) canonicalSubsystemByFunction.set(functionKey, winner[0]);
  });

  return merged.map((row) => ({
    ...row,
    subsystem: canonicalSubsystemByFunction.get(row.fromFunction.toLowerCase()) || row.subsystem,
    fromDetails: canonicalDetailsByFunction.get(row.fromFunction.toLowerCase()) || row.fromDetails,
    toDetails: canonicalDetailsByFunction.get(row.toFunction.toLowerCase()) || row.toDetails,
  }));
}

function analyzeFunctionGraph(rows, blueprintFunctions = []) {
  const blueprintKeys = new Set(blueprintFunctions.map((name) => name.toLowerCase()));
  const graphKeys = blueprintKeys.size
    ? blueprintKeys
    : new Set(rows.flatMap((row) => [row.fromFunction, row.toFunction]).map((name) => normalizeField(name).toLowerCase()).filter(Boolean));
  const undirected = new Map(Array.from(graphKeys, (key) => [key, new Set()]));
  const directed = new Map(Array.from(graphKeys, (key) => [key, new Set()]));

  rows.forEach((row) => {
    const from = normalizeField(row.fromFunction).toLowerCase();
    const to = normalizeField(row.toFunction).toLowerCase();
    if (!graphKeys.has(from) || !graphKeys.has(to) || from === to) return;
    undirected.get(from)?.add(to);
    undirected.get(to)?.add(from);
    directed.get(from)?.add(to);
  });

  const visited = new Set();
  const components = [];
  graphKeys.forEach((start) => {
    if (visited.has(start)) return;
    const stack = [start];
    const component = [];
    visited.add(start);
    while (stack.length) {
      const current = stack.pop();
      component.push(current);
      (undirected.get(current) || []).forEach((next) => {
        if (visited.has(next)) return;
        visited.add(next);
        stack.push(next);
      });
    }
    components.push(component);
  });

  const visiting = new Set();
  const complete = new Set();
  const visitForCycle = (node) => {
    if (visiting.has(node)) return true;
    if (complete.has(node)) return false;
    visiting.add(node);
    for (const next of directed.get(node) || []) {
      if (visitForCycle(next)) return true;
    }
    visiting.delete(node);
    complete.add(node);
    return false;
  };
  const hasCycle = Array.from(graphKeys).some((key) => visitForCycle(key));
  const largestComponentSize = components.reduce((largest, component) => Math.max(largest, component.length), 0);
  return {
    componentCount: components.length,
    connectedRatio: graphKeys.size ? largestComponentSize / graphKeys.size : 0,
    hasCycle,
  };
}

function assessDecompositionQuality(rows, { abstractionLevel, blueprintInventory, systemName } = {}) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const inventory = blueprintInventory || { functions: [], subsystemNames: [] };
  const minimumRows = {
    system: 8,
    subsystem: 14,
    "detailed-functional": 20,
    "multi-level": 24,
  }[abstractionLevel] || 14;
  const minimumSubsystems = {
    system: 4,
    subsystem: 4,
    "detailed-functional": 4,
    "multi-level": 5,
  }[abstractionLevel] || 4;
  const endpointKeys = new Set(
    normalizedRows
      .flatMap((row) => [row.fromFunction, row.toFunction])
      .map((name) => normalizeField(name).toLowerCase())
      .filter(Boolean)
  );
  const missingBlueprintFunctions = inventory.functions.filter((name) => !endpointKeys.has(name.toLowerCase()));
  const representedSubsystems = uniqueStrings(normalizedRows.map((row) => row.subsystem));
  const expectedSubsystemCount = inventory.subsystemNames.length
    ? Math.min(minimumSubsystems, inventory.subsystemNames.length)
    : minimumSubsystems;
  const graph = analyzeFunctionGraph(normalizedRows, inventory.functions);
  const completeDetails = normalizedRows.filter((row) => (
    normalizeField(row.fromDetails).length >= 45
    && normalizeField(row.controlDetails).length >= 45
    && normalizeField(row.toDetails).length >= 45
  )).length;
  const ownershipByFunction = new Map();
  const ownershipConflicts = new Set();
  normalizedRows.forEach((row) => {
    const functionKey = normalizeField(row.fromFunction).toLowerCase();
    const subsystem = normalizeField(row.subsystem).toLowerCase();
    if (!functionKey || !subsystem) return;
    const existing = ownershipByFunction.get(functionKey);
    if (existing && existing !== subsystem) ownershipConflicts.add(row.fromFunction);
    else ownershipByFunction.set(functionKey, subsystem);
  });
  const systemBoundaryMisuse = normalizedRows.some((row) => (
    normalizeField(systemName)
    && normalizeField(row.subsystem).toLowerCase() === normalizeField(systemName).toLowerCase()
    && abstractionLevel !== "system"
  ));
  const issues = [];
  if (normalizedRows.length < minimumRows) {
    issues.push(`Only ${normalizedRows.length} interface rows were generated; the selected depth needs approximately ${minimumRows} or more when supported by the architecture.`);
  }
  if (representedSubsystems.length < expectedSubsystemCount) {
    issues.push(`Only ${representedSubsystems.length} subsystem owners are represented; approximately ${expectedSubsystemCount} or more are expected from the blueprint.`);
  }
  if (missingBlueprintFunctions.length) {
    issues.push(`Blueprint functions absent from interfaces: ${missingBlueprintFunctions.slice(0, 16).join(", ")}.`);
  }
  if (graph.componentCount > 1 && graph.connectedRatio < 0.8) {
    issues.push(`The internal function graph is fragmented into ${graph.componentCount} components; connect mission, support, safety, and feedback paths through meaningful interfaces.`);
  }
  if (["subsystem", "detailed-functional", "multi-level"].includes(abstractionLevel) && !graph.hasCycle) {
    issues.push("No operational feedback loop is represented; add measured state, execution status, health, constraint, or corrective-command paths that change upstream behavior.");
  }
  if (completeDetails < normalizedRows.length * 0.85) {
    issues.push("Too many rows lack sufficiently specific source, payload/trigger/receiver-effect, or target details.");
  }
  if (ownershipConflicts.size) {
    issues.push(`Functions have conflicting subsystem owners: ${Array.from(ownershipConflicts).slice(0, 10).join(", ")}.`);
  }
  if (systemBoundaryMisuse) {
    issues.push(`The overall system name “${systemName}” is being used as an internal subsystem owner.`);
  }

  const blueprintCoverage = inventory.functions.length
    ? (inventory.functions.length - missingBlueprintFunctions.length) / inventory.functions.length
    : 1;
  const score = Math.min(10,
    3 * Math.min(1, normalizedRows.length / minimumRows)
    + 1.5 * Math.min(1, representedSubsystems.length / Math.max(1, expectedSubsystemCount))
    + 2 * blueprintCoverage
    + 2 * graph.connectedRatio
    + (graph.hasCycle || abstractionLevel === "system" ? 1 : 0)
    + 0.5 * (normalizedRows.length ? completeDetails / normalizedRows.length : 0)
  );

  return { score, issues, minimumRows, missingBlueprintFunctions, graph };
}

function buildRepairRequest(prompt, architectureBlueprintContent, rows, qualityReport) {
  const sections = extractStructuredInput(prompt);
  const abstractionOption = getFunctionalAbstractionLevelOption(sections.abstractionLevel);
  return {
    systemPrompt: [
      "You are the final architecture-quality editor in a systems-engineering workflow.",
      "Rewrite the complete functional-decomposition table so it scores at least 8/10 for domain fidelity, selected-depth coverage, graph coherence, interface semantics, allocation consistency, and useful operational feedback.",
      `The selected depth is ${abstractionOption.label}: ${abstractionOption.description}.`,
      getFunctionalAbstractionPromptGuidance(abstractionOption.value),
      "Return a complete replacement JSON array, not a critique, patch, or list of only new rows.",
      "Each object must contain subsystem, fromFunction, fromDetails, controlAction, controlDetails, toFunction, and toDetails.",
      "Use the blueprint function inventory and ownership as the coverage baseline. Add missing domain-essential functions if the blueprint itself is shallow, but do not invent unrelated product features.",
      "Treat the blueprint and wizard entries as provisional when the mission is underspecified. Prefer intrinsic platform capabilities and remove unsupported personas, application verticals, companion behaviors, healthcare functions, entertainment functions, and smart-environment integrations.",
      "Create one coherent end-to-end mission architecture plus meaningful supporting, safety, resource, mode, recovery, operator, and external paths when warranted.",
      "Do not connect independent functions merely because they are adjacent in a list. Every transferred command, data product, state, request, status, or event must be produced by its source and consumed by its target.",
      "Put assessment, planning, authorization, or decision functions before the mitigation or execution they control. Feed measured outcomes, state, health, constraints, and execution status back to the functions that use them.",
      "Avoid generic substitute subsystems and functions when the named domain supports precise architectural responsibilities.",
      "Keep each function under one subsystem owner. The subsystem column owns fromFunction; the overall system name is not an internal subsystem.",
      "Use stable Title Case verb-noun function names and specific noun-phrase interface labels. Do not use acknowledgements unless receipt itself changes behavior.",
      "Preserve strong rows, replace semantically invalid rows, connect fragmented chains, and add the missing depth. Silently audit the replacement before returning it.",
      "Return JSON only, with no markdown or commentary.",
    ].join(" "),
    userPrompt: [
      `System Name: ${sections.systemName || "System"}`,
      `Selected Decomposition Depth: ${abstractionOption.label} — ${abstractionOption.description}`,
      sections.systemOverview ? `System Overview:\n${sections.systemOverview}` : "",
      sections.ops ? `Operational Scenarios and Modes:\n${sections.ops}` : "",
      sections.clarifications ? `Clarification Answers:\n${sections.clarifications}` : "",
      architectureBlueprintContent ? `Architecture Blueprint:\n${architectureBlueprintContent}` : "",
      `Automated quality score: ${qualityReport.score.toFixed(1)}/10`,
      `Issues to repair:\n${qualityReport.issues.map((issue) => `- ${issue}`).join("\n")}`,
      `Current draft rows:\n${JSON.stringify(rows)}`,
    ].filter(Boolean).join("\n\n"),
  };
}

function buildSemanticReviewRequest(prompt, architectureBlueprintContent, rows, structuralQuality) {
  const sections = extractStructuredInput(prompt);
  const abstractionOption = getFunctionalAbstractionLevelOption(sections.abstractionLevel);
  const provenanceLabel = (field) => sections.aiGeneratedFields.includes(field)
    ? "AI-generated hypothesis; independently verify"
    : "user-authored evidence";
  return {
    systemPrompt: [
      "You are an independent senior functional-architecture reviewer. You did not author the draft and must challenge plausible-looking assumptions and interfaces.",
      "Review and rewrite the complete decomposition using this weighted rubric: domain and mission fidelity 2 points; appropriate selected-depth decomposition 2 points; causal and payload-compatible interfaces 3 points; closed-loop control, feedback, and safety behavior 2 points; genuine system boundaries 1 point.",
      "A high row count or connected graph is not evidence of quality. Never retain or create an interface merely to connect graph components or satisfy a quota.",
      "Distinguish intrinsic platform capabilities from optional application features. If the mission is underspecified, retain a conservative platform reference architecture and remove invented personas, verticals, services, user-health features, emotional behavior, entertainment behavior, cloud services, or smart-environment integrations unless explicit evidence requires them.",
      "Check every row causally: the source function must actually produce the named control action or data product; the target must consume it; the target details must describe the resulting receiver behavior; and the direction must match the operational sequence.",
      "Do not chain independent modalities, lifecycle activities, alerts, or convenience features. Do not route power status, completion status, software status, or configuration status to an unrelated function simply to make the graph connected.",
      "For cyber-physical or embodied systems, ensure the architecture includes the domain-appropriate equivalents of external and internal sensing, state estimation, environment or system representation, decision/planning, command generation, controlled execution, measured feedback, resource supervision, and safety/fault response when intrinsic to the system class.",
      "Put detection and assessment before decisions or mitigations, commands before execution, and measured outcomes after execution. Represent emergency inhibition separately from stopped-state confirmation and recovery authorization.",
      "Each function must have one clear subsystem owner. Use Title Case verb-noun function names. The overall system boundary is not an internal subsystem.",
      `Honor ${abstractionOption.label}: ${abstractionOption.description}.`,
      getFunctionalAbstractionPromptGuidance(abstractionOption.value),
      "First identify defects in the original draft, then rewrite it, then audit the corrected rows rather than merely asserting a total score.",
      "Return one JSON object with reviewSummary, originalDraftFindings, postCorrectionValidation, and rows.",
      "originalDraftFindings must contain unsupportedAssumptions, missingIntrinsicCapabilities, invalidInterfaces, and ownershipConflicts arrays. Each invalid interface or ownership finding must identify its row or function and explain the defect.",
      "postCorrectionValidation must contain numeric domainFidelity (0-2), decompositionDepth (0-2), interfaceSemantics (0-3), feedbackAndSafety (0-2), and systemBoundaries (0-1), plus unsupportedAssumptionsRemaining, missingIntrinsicCapabilitiesRemaining, invalidInterfacesRemaining, and ownershipConflictsRemaining arrays.",
      "Award rubric points only when the corrected rows provide concrete evidence. A corrected result may score 8 or higher only when every remaining-issue array is empty. Never copy the draft score or award points for row count alone.",
      "rows must be the complete corrected replacement array using subsystem, fromFunction, fromDetails, controlAction, controlDetails, toFunction, and toDetails.",
      "Return JSON only. Do not include markdown or commentary.",
    ].join(" "),
    userPrompt: [
      `System Name: ${sections.systemName || "System"}`,
      `Selected Decomposition Depth: ${abstractionOption.label} — ${abstractionOption.description}`,
      sections.systemOverview
        ? `System Overview [${provenanceLabel("systemOverview")}]:\n${sections.systemOverview}`
        : "System Overview: Not supplied; use a conservative platform interpretation.",
      sections.functionalComponents
        ? `Wizard Functions and Allocations [${provenanceLabel("functionalComponents")}]:\n${sections.functionalComponents}`
        : "",
      sections.interactions
        ? `Wizard Interactions [${provenanceLabel("interactions")}]:\n${sections.interactions}`
        : "",
      sections.ops ? `Operational Scenarios and Modes [${provenanceLabel("ops")}]:\n${sections.ops}` : "",
      sections.clarifications ? `Clarification Answers:\n${sections.clarifications}` : "",
      architectureBlueprintContent ? `Provisional Architecture Blueprint (also subject to review):\n${architectureBlueprintContent}` : "",
      `Structural quality signal: ${structuralQuality.score.toFixed(1)}/10. This signal does not assess semantic validity.`,
      `Draft rows to independently review and replace:\n${JSON.stringify(rows)}`,
    ].filter(Boolean).join("\n\n"),
  };
}

function buildSemanticRescueRequest(prompt, architectureBlueprintContent, rows, structuralQuality, priorReview) {
  const baseRequest = buildSemanticReviewRequest(
    prompt,
    architectureBlueprintContent,
    rows,
    structuralQuality
  );
  const remainingIssues = priorReview?.remainingIssues?.length
    ? priorReview.remainingIssues.map((issue) => `- ${issue}`).join("\n")
    : "- The prior response did not provide a complete, passing post-correction rubric.";
  return {
    systemPrompt: [
      baseRequest.systemPrompt,
      "This is the single bounded rescue pass. Replace the rejected candidate completely and fix every supplied structural and semantic failure.",
      "Preserve valid domain content, but do not preserve an interface, optional feature, or ownership assignment merely because it appeared in the rejected candidate.",
      "Before returning, trace the primary mission from a real boundary input through domain sensing or intake, estimation/interpretation, planning/decision, control, execution/output, and measured outcome as applicable; then connect resource, health, degraded-mode, recovery, and safety functions through genuine operational effects.",
    ].join(" "),
    userPrompt: [
      baseRequest.userPrompt,
      `The previous semantic correction was rejected at ${Number.isFinite(priorReview?.semanticScore) ? `${priorReview.semanticScore}/10` : "an incomplete score"}.`,
      `Unresolved semantic findings:\n${remainingIssues}`,
      `Structural findings that must also be repaired:\n${structuralQuality.issues.length ? structuralQuality.issues.map((issue) => `- ${issue}`).join("\n") : "- None reported."}`,
      "Return a complete replacement and its evidence-grounded postCorrectionValidation. Do not return a critique or a partial patch.",
    ].join("\n\n"),
  };
}

function parseSemanticReview(content) {
  const parsed = parseArchitectureBlueprint(content);
  if (!parsed) return null;
  const validation = parsed.postCorrectionValidation;
  const rubricMaximums = {
    domainFidelity: 2,
    decompositionDepth: 2,
    interfaceSemantics: 3,
    feedbackAndSafety: 2,
    systemBoundaries: 1,
  };
  const rubricScores = Object.entries(rubricMaximums).map(([key, maximum]) => {
    const score = Number(validation?.[key]);
    return Number.isFinite(score) ? Math.max(0, Math.min(maximum, score)) : null;
  });
  const remainingIssueKeys = [
    "unsupportedAssumptionsRemaining",
    "missingIntrinsicCapabilitiesRemaining",
    "invalidInterfacesRemaining",
    "ownershipConflictsRemaining",
  ];
  const hasCompleteRubric = rubricScores.every((score) => score !== null)
    && remainingIssueKeys.every((key) => Array.isArray(validation?.[key]));
  const hasRemainingIssues = remainingIssueKeys.some((key) => (
    Array.isArray(validation?.[key]) && validation[key].length > 0
  ));
  const remainingIssues = remainingIssueKeys.flatMap((key) => (
    Array.isArray(validation?.[key])
      ? validation[key].map((issue) => {
        if (typeof issue === "string") return `${key}: ${issue}`;
        if (issue && typeof issue === "object") {
          const location = issue.rowIndex != null
            ? `row ${issue.rowIndex}`
            : normalizeField(issue.function || issue.capability || issue.assumption);
          const reason = normalizeField(issue.reason || issue.issue || issue.description);
          return `${key}: ${[location, reason].filter(Boolean).join(" — ") || JSON.stringify(issue)}`;
        }
        return `${key}: ${String(issue)}`;
      })
      : []
  ));
  const semanticScore = hasCompleteRubric
    ? rubricScores.reduce((sum, score) => sum + score, 0)
    : null;
  const rows = parseRowsFromContent(content);
  return {
    semanticScore,
    hasCompleteRubric,
    hasRemainingIssues,
    remainingIssues,
    rows,
  };
}

function evaluateSemanticCandidate(review, qualityOptions) {
  const rows = mergeRows(review?.rows || [], new Map());
  const quality = assessDecompositionQuality(rows, {
    ...qualityOptions,
    blueprintInventory: {
      ...(qualityOptions.blueprintInventory || {}),
      // The semantic reviewer may legitimately replace a flawed provisional
      // blueprint function. Score the corrected graph on its own endpoints.
      functions: [],
    },
  });
  const acceptable = Boolean(
    rows.length
    && review?.hasCompleteRubric
    && review.semanticScore >= 8
    && !review.hasRemainingIssues
    && quality.score >= 7
    && quality.issues.length === 0
    && rows.length >= quality.minimumRows
    && quality.graph.connectedRatio >= 0.8
  );
  return { review, rows, quality, acceptable };
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

async function fetchChatChunk(systemPrompt, userPrompt, maxTokens = MAX_OUTPUT_TOKENS) {
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
      temperature: FUNCTIONAL_DECOMPOSITION_SAMPLING.temperature,
      top_p: FUNCTIONAL_DECOMPOSITION_SAMPLING.topP,
      max_tokens: maxTokens,
    }),
  });
}

async function fetchOpenAIChunk(systemPrompt, userPrompt, maxTokens = MAX_OUTPUT_TOKENS) {
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
      temperature: FUNCTIONAL_DECOMPOSITION_SAMPLING.temperature,
      top_p: FUNCTIONAL_DECOMPOSITION_SAMPLING.topP,
      max_tokens: maxTokens,
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

async function requestTextWithRetry(fetcher, label, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const resp = await fetcher();
    if (resp.ok) {
      const data = await resp.json();
      const content = extractAIText(data);
      if (content) return content;
      lastError = new Error(`${label} returned no content.`);
      break;
    }

    const errTxt = await resp.text();
    lastError = new Error(`${label} error (${resp.status}): ${errTxt}`);
    if (!TRANSIENT_STATUSES.has(resp.status)) break;
    if (attempt < attempts) await sleep(500 * attempt);
  }
  throw lastError || new Error(`${label} failed.`);
}

async function requestArchitectureBlueprint(systemPrompt, userPrompt, runState = {}) {
  try {
    return await requestTextWithRetry(
      () => fetchChatChunk(systemPrompt, userPrompt, MAX_BLUEPRINT_TOKENS),
      "LLM architecture blueprint",
      2
    );
  } catch (chatError) {
    if ((runState.openAIProxyFailures || 0) >= MAX_OPENAI_PROXY_FAILURES_PER_RUN) throw chatError;
    try {
      return await requestTextWithRetry(
        () => fetchOpenAIChunk(systemPrompt, userPrompt, MAX_BLUEPRINT_TOKENS),
        "LLM architecture blueprint fallback",
        1
      );
    } catch (openAIError) {
      runState.openAIProxyFailures = (runState.openAIProxyFailures || 0) + 1;
      throw new Error(`${chatError.message}; ${openAIError.message}`);
    }
  }
}

async function requestSemanticReview(systemPrompt, userPrompt, runState = {}) {
  try {
    return await requestTextWithRetry(
      () => fetchChatChunk(systemPrompt, userPrompt),
      "LLM semantic architecture review",
      2
    );
  } catch (chatError) {
    if ((runState.openAIProxyFailures || 0) >= MAX_OPENAI_PROXY_FAILURES_PER_RUN) throw chatError;
    try {
      return await requestTextWithRetry(
        () => fetchOpenAIChunk(systemPrompt, userPrompt),
        "LLM semantic architecture review fallback",
        1
      );
    } catch (openAIError) {
      runState.openAIProxyFailures = (runState.openAIProxyFailures || 0) + 1;
      throw new Error(`${chatError.message}; ${openAIError.message}`);
    }
  }
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
    const allRows = [];
    const runState = { openAIProxyFailures: 0 };
    context.onStage?.("Planning the domain-specific functional architecture...");
    const blueprintRequest = buildArchitectureBlueprintRequest(prompt);
    let architectureBlueprint = "";
    try {
      architectureBlueprint = await requestArchitectureBlueprint(
        blueprintRequest.systemPrompt,
        blueprintRequest.userPrompt,
        runState
      );
    } catch (blueprintError) {
      console.warn("Lite architecture blueprint generation failed; continuing with direct decomposition.", blueprintError);
    }
    context.onStage?.("Generating interfaces from the architecture blueprint...");
    const requests = buildChunkRequests(prompt, architectureBlueprint);

    for (const req of requests) {
      try {
        const rows = await requestChunk(req.systemPrompt, req.userPrompt, runState);
        allRows.push(...rows);
      } catch (chunkErr) {
        console.warn(`Lite decomposition chunk ${req.index + 1}/${req.total} failed`, chunkErr);
      }
    }

    const requestMeta = requests[0] || {};
    let bestRows = mergeRows(allRows, requestMeta.subsystemByComponent || new Map());
    let bestQuality = null;
    const semanticReviewRequired = ["detailed-functional", "multi-level"].includes(requestMeta.abstractionLevel);
    let semanticReviewAccepted = !semanticReviewRequired;
    let semanticRescueAttempted = false;
    if (bestRows.length && requestMeta.blueprintInventory?.functions?.length >= 4) {
      context.onStage?.("Reviewing decomposition depth, coverage, connectivity, and feedback...");
      bestQuality = assessDecompositionQuality(bestRows, {
        abstractionLevel: requestMeta.abstractionLevel,
        blueprintInventory: requestMeta.blueprintInventory,
        systemName: requestMeta.systemName,
      });
      for (let repairAttempt = 0; repairAttempt < 2 && (bestQuality.score < 8 || bestQuality.issues.length); repairAttempt += 1) {
        try {
          context.onStage?.(`Refining the decomposition (quality pass ${repairAttempt + 1} of 2)...`);
          const repairRequest = buildRepairRequest(
            prompt,
            architectureBlueprint,
            bestRows,
            bestQuality
          );
          const repairedRows = mergeRows(
            await requestChunk(repairRequest.systemPrompt, repairRequest.userPrompt, runState),
            requestMeta.subsystemByComponent || new Map()
          );
          const repairedQuality = assessDecompositionQuality(repairedRows, {
            abstractionLevel: requestMeta.abstractionLevel,
            blueprintInventory: requestMeta.blueprintInventory,
            systemName: requestMeta.systemName,
          });
          if (repairedRows.length && repairedQuality.score > bestQuality.score) {
            bestRows = repairedRows;
            bestQuality = repairedQuality;
          } else {
            break;
          }
        } catch (repairError) {
          console.warn("Lite decomposition quality repair failed; returning the best available draft.", repairError);
          break;
        }
      }

      if (["detailed-functional", "multi-level"].includes(requestMeta.abstractionLevel)) {
        try {
          context.onStage?.("Performing an independent domain and interface-semantics review...");
          const semanticRequest = buildSemanticReviewRequest(
            prompt,
            architectureBlueprint,
            bestRows,
            bestQuality
          );
          const semanticReview = parseSemanticReview(await requestSemanticReview(
            semanticRequest.systemPrompt,
            semanticRequest.userPrompt,
            runState
          ));
          const qualityOptions = {
            abstractionLevel: requestMeta.abstractionLevel,
            blueprintInventory: requestMeta.blueprintInventory,
            systemName: requestMeta.systemName,
          };
          let semanticCandidate = evaluateSemanticCandidate(semanticReview, qualityOptions);
          if (!semanticCandidate.acceptable) {
            semanticRescueAttempted = true;
            context.onStage?.("Repairing the rejected semantic candidate (final quality pass)...");
            const rescueRows = semanticCandidate.rows.length ? semanticCandidate.rows : bestRows;
            const rescueQuality = assessDecompositionQuality(rescueRows, qualityOptions);
            const rescueRequest = buildSemanticRescueRequest(
              prompt,
              architectureBlueprint,
              rescueRows,
              rescueQuality,
              semanticReview
            );
            const rescuedReview = parseSemanticReview(await requestSemanticReview(
              rescueRequest.systemPrompt,
              rescueRequest.userPrompt,
              runState
            ));
            semanticCandidate = evaluateSemanticCandidate(rescuedReview, qualityOptions);
          }
          if (semanticCandidate.acceptable) {
            bestRows = semanticCandidate.rows;
            bestQuality = semanticCandidate.quality;
            semanticReviewAccepted = true;
          }
        } catch (semanticReviewError) {
          console.warn("Lite semantic architecture review failed; returning the best structurally reviewed draft.", semanticReviewError);
        }
      }
    }

    const resultRows = bestRows.length ? bestRows : fallbackRowsFromPrompt(prompt);
    const finalQuality = bestQuality || assessDecompositionQuality(resultRows, {
      abstractionLevel: requestMeta.abstractionLevel,
      blueprintInventory: requestMeta.blueprintInventory,
      systemName: requestMeta.systemName,
    });
    const meetsQualityTarget = finalQuality.score >= 8
      && finalQuality.issues.length === 0
      && semanticReviewAccepted;
    context.onQuality?.({
      score: finalQuality.score,
      issues: finalQuality.issues,
      meetsTarget: meetsQualityTarget,
      semanticReviewRequired,
      semanticReviewAccepted,
      semanticRescueAttempted,
    });
    setResponse(JSON.stringify(resultRows, null, 2));
  } catch (err) {
    console.error("Failed to fetch LLM decomposition:", err);
    setResponse(JSON.stringify(fallbackRowsFromPrompt(prompt), null, 2));
  } finally {
    setPrompt("");
  }
};
