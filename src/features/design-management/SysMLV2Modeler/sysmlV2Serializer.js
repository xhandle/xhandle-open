import { addSysMLElement, addSysMLRelationship, createSysMLV2Model, saveSysMLV2Model } from "./sysmlV2Store";

function indent(level) {
  return "  ".repeat(level);
}

function safeName(name) {
  return String(name || "Unnamed").replace(/[^\w]/g, "_");
}

function docLine(text, level) {
  return text ? `${indent(level)}doc /* ${String(text).replace(/\*\//g, "* /")} */` : null;
}

export function serializeSysMLV2Text(model) {
  if (!model) return "";
  const elements = model.elements || [];
  const relationships = model.relationships || [];
  const root = elements.find((el) => el.id === model.rootElementId) || elements.find((el) => el.type === "Package");
  const packageName = safeName(root?.name || model.name || "SystemModel");
  const lines = [`package ${packageName} {`];

  elements.filter((el) => el.id !== root?.id).forEach((el) => {
    const name = safeName(el.name);
    if (el.type === "PartDefinition") {
      lines.push(`${indent(1)}part def ${name} {`);
      if (docLine(el.description, 2)) lines.push(docLine(el.description, 2));
      (el.attributes || []).forEach((attr) => lines.push(`${indent(2)}attribute ${safeName(attr.name || attr)};`));
      (el.ports || []).forEach((port) => lines.push(`${indent(2)}port ${safeName(port.name || port)};`));
      lines.push(`${indent(1)}}`);
    } else if (el.type === "PartUsage") {
      lines.push(`${indent(1)}part ${name}${el.metadata?.definitionName ? ` : ${safeName(el.metadata.definitionName)}` : ""};`);
    } else if (/Requirement/.test(el.type)) {
      lines.push(`${indent(1)}requirement def ${name} {`);
      if (docLine(el.description || el.metadata?.text, 2)) lines.push(docLine(el.description || el.metadata?.text, 2));
      lines.push(`${indent(1)}}`);
    } else if (/Action/.test(el.type)) {
      lines.push(`${indent(1)}action def ${name} {`);
      (el.metadata?.inputs || []).forEach((input) => lines.push(`${indent(2)}in ${safeName(input)};`));
      (el.metadata?.outputs || []).forEach((output) => lines.push(`${indent(2)}out ${safeName(output)};`));
      if (docLine(el.description, 2)) lines.push(docLine(el.description, 2));
      lines.push(`${indent(1)}}`);
    } else if (/Interface/.test(el.type)) {
      lines.push(`${indent(1)}interface def ${name};`);
    } else if (/VerificationCase/.test(el.type)) {
      lines.push(`${indent(1)}verification case ${name};`);
    } else if (/AnalysisCase/.test(el.type)) {
      lines.push(`${indent(1)}analysis case ${name};`);
    } else if (/State/.test(el.type)) {
      lines.push(`${indent(1)}state def ${name};`);
    } else if (/Constraint/.test(el.type)) {
      lines.push(`${indent(1)}constraint def ${name}${el.metadata?.expression ? ` { ${el.metadata.expression} }` : ";"} `);
    } else if (el.type === "Package") {
      lines.push(`${indent(1)}package ${name};`);
    }
  });

  const byId = new Map(elements.map((el) => [el.id, el]));
  relationships.forEach((rel) => {
    const source = safeName(byId.get(rel.sourceId)?.name);
    const target = safeName(byId.get(rel.targetId)?.name);
    if (!source || !target) return;
    if (rel.type === "connects") lines.push(`${indent(1)}connect ${source} to ${target};`);
    else if (rel.type === "satisfies") lines.push(`${indent(1)}satisfy ${source} to ${target};`);
    else if (rel.type === "verifies") lines.push(`${indent(1)}verify ${source} to ${target};`);
    else if (rel.type === "allocates") lines.push(`${indent(1)}allocate ${source} to ${target};`);
    else if (rel.type === "contains") lines.push(`${indent(1)}contain ${source} to ${target};`);
    else lines.push(`${indent(1)}${rel.type} ${source} to ${target};`);
  });

  lines.push("}");
  return lines.join("\n");
}

function parseDoc(line) {
  return line.match(/doc\s*\/\*\s*([\s\S]*?)\s*\*\//)?.[1] || "";
}

export function parseSysMLV2TextSubset(text) {
  const warnings = [];
  const errors = [];
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const packageLine = lines.find((line) => /^package\s+\w+/i.test(line));
  const modelName = packageLine?.match(/^package\s+(\w+)/i)?.[1] || "ImportedSysMLModel";
  const elements = [];
  const relationships = [];
  let current = null;

  lines.forEach((line) => {
    if (/^package\s+\w+\s*\{?$/i.test(line) || line === "}") return;
    let match = line.match(/^part\s+def\s+(\w+)/i);
    if (match) {
      current = { type: "PartDefinition", name: match[1], attributes: [], ports: [] };
      elements.push(current);
      return;
    }
    match = line.match(/^part\s+(\w+)(?:\s*:\s*(\w+))?/i);
    if (match) {
      elements.push({ type: "PartUsage", name: match[1], metadata: { definitionName: match[2] || "" } });
      current = null;
      return;
    }
    match = line.match(/^requirement\s+def\s+(\w+)/i);
    if (match) {
      current = { type: "RequirementDefinition", name: match[1], description: "" };
      elements.push(current);
      return;
    }
    match = line.match(/^action\s+def\s+(\w+)/i);
    if (match) {
      current = { type: "ActionDefinition", name: match[1], metadata: { inputs: [], outputs: [] } };
      elements.push(current);
      return;
    }
    match = line.match(/^interface\s+def\s+(\w+)/i);
    if (match) {
      elements.push({ type: "InterfaceDefinition", name: match[1] });
      current = null;
      return;
    }
    match = line.match(/^verification\s+case\s+(\w+)/i);
    if (match) {
      elements.push({ type: "VerificationCase", name: match[1] });
      current = null;
      return;
    }
    match = line.match(/^analysis\s+case\s+(\w+)/i);
    if (match) {
      elements.push({ type: "AnalysisCase", name: match[1] });
      current = null;
      return;
    }
    match = line.match(/^attribute\s+(\w+)/i);
    if (match && current) {
      current.attributes = [...(current.attributes || []), { name: match[1] }];
      return;
    }
    match = line.match(/^port\s+(\w+)/i);
    if (match && current) {
      current.ports = [...(current.ports || []), { name: match[1] }];
      return;
    }
    match = line.match(/^in\s+(\w+)/i);
    if (match && current) {
      current.metadata = { ...(current.metadata || {}), inputs: [...(current.metadata?.inputs || []), match[1]] };
      return;
    }
    match = line.match(/^out\s+(\w+)/i);
    if (match && current) {
      current.metadata = { ...(current.metadata || {}), outputs: [...(current.metadata?.outputs || []), match[1]] };
      return;
    }
    if (/^doc\s*\/\*/i.test(line) && current) {
      current.description = parseDoc(line);
      return;
    }
    match = line.match(/^(connect|satisfy|verify|trace|allocate|derive|refine)\s+(\w+)\s+to\s+(\w+)/i);
    if (match) {
      const typeMap = { connect: "connects", satisfy: "satisfies", verify: "verifies", trace: "traces", allocate: "allocates", derive: "derives", refine: "refines" };
      relationships.push({ type: typeMap[match[1]] || "traces", sourceName: match[2], targetName: match[3], label: match[1] });
      return;
    }
    if (line !== "{" && line !== "};") warnings.push(`Unsupported SysML textual subset line preserved as warning: ${line}`);
  });

  if (!elements.length) errors.push("No supported SysML v2 subset elements were found.");
  return { modelName, elements, relationships, warnings, errors };
}

export function importSysMLV2TextSubset(text) {
  const parsed = parseSysMLV2TextSubset(text);
  if (parsed.errors.length) return { status: "error", ...parsed };
  let model = createSysMLV2Model({ name: parsed.modelName, description: "Imported from SysML v2 textual subset." });
  const byName = new Map();
  parsed.elements.forEach((entry) => {
    const result = addSysMLElement(model.id, entry);
    model = result.model;
    byName.set(entry.name, result.element.id);
  });
  parsed.relationships.forEach((entry) => {
    const sourceId = byName.get(entry.sourceName);
    const targetId = byName.get(entry.targetName);
    if (!sourceId || !targetId) {
      parsed.warnings.push(`Skipped relationship ${entry.type}: ${entry.sourceName} to ${entry.targetName}; endpoint not found.`);
      return;
    }
    model = addSysMLRelationship(model.id, { ...entry, sourceId, targetId }).model;
  });
  saveSysMLV2Model(model);
  return { status: "success", model, warnings: parsed.warnings, errors: [] };
}

