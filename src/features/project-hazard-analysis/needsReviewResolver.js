import { backendURL, buildAIAuthOpts } from "../../components/backendConfig";
import {
  getStoredActiveAIProvider,
  getStoredAIProviderModelPreference,
} from "../../lib/aiProviderConfig";
import { normalizeControlActionType } from "./hazardSafetyModel";
import {
  auditSafetyClassificationRecord,
  normalizeClassificationConfidence,
  normalizeProtectionStatus,
  normalizeSafetyClassification,
  normalizeSafetyClassificationRule,
} from "./safetySignificancePolicy";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalized = (value) => clean(value).toLowerCase();

export function stakeholderAnswerEstablishesEvidence(answer = "") {
  const value = normalized(answer);
  if (!value) return false;
  const uncertainty = /\b(?:not established|not documented|undocumented|unknown|not known|not evidenced|unconfirmed|tbd|requires? confirmation|insufficient evidence)\b/;
  const clauses = value.split(/[.;\n]+/).map((clause) => clause.trim()).filter(Boolean);
  if (!clauses.some((clause) => uncertainty.test(clause))) return true;
  return clauses.some((clause) => !uncertainty.test(clause)
    && /\b(?:shall|uses?|provides?|prevents?|permits?|inhibits?|rejects?|transitions?|occurs?|requires?|within|before|after)\b/.test(clause));
}

export const NEEDS_REVIEW_GROUPS = Object.freeze({
  U1: {
    id: "U1",
    title: "Authority and responsibility",
    question: "What authority, responsibility, and intervention capability do the named operators, controllers, external services, and receiving functions have in these scenarios?",
    guidance: "Identify who may command, inhibit, override, acknowledge, or initiate a protective response, including limits by mode and unavailable communication paths.",
  },
  U2: {
    id: "U2",
    title: "Safeguards and fallback behavior",
    question: "Which independent safeguards, fallback behaviors, interlocks, monitors, or safe-state responses protect these interfaces when the control action is missing, incorrect, or unavailable?",
    guidance: "State whether each protection is implemented, independent, available in the named mode, and capable of acting before harm. Say explicitly when no credited protection exists.",
  },
  U3: {
    id: "U3",
    title: "Timing and interface contracts",
    question: "What timing, freshness, validity, ordering, duration, timeout, or revocation contracts govern these interfaces in the listed operational contexts?",
    guidance: "Describe the contract and receiver behavior without inventing numerical limits. Use named TBD parameters when limits have not been established.",
  },
  U4: {
    id: "U4",
    title: "Causal-chain and architecture evidence",
    question: "What additional architecture evidence determines whether these deviations can produce a hazardous state or whether their effects terminate as mission or reliability impacts?",
    guidance: "Describe exposure, downstream behavior, dependencies, containment, recovery, and the point where any physical-harm chain is created or broken.",
  },
});

const HEADER_ALIASES = {
  classification: ["Safety Classification"],
  rule: ["Safety Classification Rule", "Classification Rule"],
  safetySignificant: ["Safety Significant"],
  applicability: ["Guide Phrase Applicable", "Applicability"],
  rationale: [
    "Safety Significance Rationale",
    "Proposed Safety Assessment Rationale",
    "Classification Evidence",
    "Protection Assessment",
    "Guide Phrase Applicability Rationale",
  ],
  from: ["Function (From)", "From Function", "Controller"],
  action: ["Control Action", "Action"],
  to: ["Function (To)", "To Function", "Controlled Process"],
  subsystem: ["Subsystem Allocation", "Subsystem"],
  scenario: ["Operational Scenario", "Scenario"],
  mode: ["Operational Mode", "Mode"],
  guidePhrase: ["Guide Phrase", "Guideword"],
  sourceRowId: ["Raw Analysis Row ID", "Raw Row ID", "Analysis Row ID"],
};

export const NEEDS_REVIEW_MUTABLE_FIELDS = Object.freeze([
  "Guide Phrase Applicable",
  "Guide Phrase Applicability Rationale",
  "Control Action Type",
  "Proposed Safety Assessment",
  "Proposed Safety Assessment Rationale",
  "Safety Classification",
  "Safety Classification Rule",
  "Causal Path Type",
  "Causal Effect",
  "Resulting System State",
  "Intermediate Safety Function",
  "Intermediate Safety Effect",
  "Protection Assessment",
  "Protection Status",
  "Physical-Harm Chain Termination",
  "Classification Evidence",
  "Classification Confidence",
  "Safety Significant",
  "Safety Significance Rationale",
]);

function headerIndex(headers, aliases) {
  const candidates = aliases.map(normalized);
  return headers.findIndex((header) => candidates.includes(normalized(header)));
}

function readCell(headers, row, aliases) {
  const index = headerIndex(headers, aliases);
  return index >= 0 ? clean(row?.[index]) : "";
}

function writeCell(headers, row, label, value) {
  const index = headerIndex(headers, [label]);
  if (index >= 0) row[index] = clean(value);
}

function policyRecordFromRow(headers, row) {
  const fields = Object.fromEntries(headers.map((header, index) => [clean(header), clean(row[index])]));
  return {
    guidePhrase: fields["Guide Phrase"],
    guidePhraseApplicable: fields["Guide Phrase Applicable"],
    safetyClassification: fields["Safety Classification"],
    safetyClassificationRule: fields["Safety Classification Rule"] || fields["Classification Rule"],
    causalPathType: fields["Causal Path Type"],
    causalEffect: fields["Causal Effect"],
    resultingSystemState: fields["Resulting System State"],
    intermediateSafetyFunction: fields["Intermediate Safety Function"],
    intermediateSafetyEffect: fields["Intermediate Safety Effect"],
    protectionAssessment: fields["Protection Assessment"],
    protectionStatus: fields["Protection Status"],
    physicalHarmChainTermination: fields["Physical-Harm Chain Termination"],
    classificationEvidence: fields["Classification Evidence"],
    proposedSafetyAssessment: fields["Proposed Safety Assessment"],
    safetySignificant: fields["Safety Significant"],
    losses: fields.Losses || fields.Loss,
    hazards: fields.Hazards || fields.Hazard,
    causalScenario: fields["Causal Scenario"],
    safetyExposurePath: fields["Safety Exposure Path"],
  };
}

function hasCompletePolicySchema(headers) {
  const available = new Set(headers.map(normalized));
  return [
    "causal effect",
    "resulting system state",
    "protection assessment",
    "physical-harm chain termination",
  ].every((header) => available.has(header))
    && (["hazards", "hazard"].some((header) => available.has(header)))
    && (["losses", "loss"].some((header) => available.has(header)));
}

function inferRuleFamily(headers, row) {
  const explicit = readCell(headers, row, HEADER_ALIASES.rule).toUpperCase().match(/\bU[1-4]\b/)?.[0];
  if (explicit) return explicit;
  const basis = HEADER_ALIASES.rationale.map((aliases) => readCell(headers, row, [aliases])).join(" ");
  if (/authority|responsib|permission|intervention|operator|ownership/i.test(basis)) return "U1";
  if (/protect|barrier|safeguard|fallback|safe state|redundan|interlock/i.test(basis)) return "U2";
  if (/timing|deadline|fresh|sequence|order|duration|timeout|revocation|latency/i.test(basis)) return "U3";
  return "U4";
}

function isNeedsReviewRow(headers, row) {
  return [
    readCell(headers, row, HEADER_ALIASES.classification),
    readCell(headers, row, HEADER_ALIASES.safetySignificant),
    readCell(headers, row, HEADER_ALIASES.applicability),
  ].some((value) => /^needs review$/i.test(value));
}

function stableScopeSignature(rows) {
  return rows.map((entry) => [
    entry.sourceRowId,
    entry.from,
    entry.action,
    entry.to,
    entry.scenario,
    entry.mode,
    entry.guidePhrase,
  ].join("|")).join("\n");
}

export function extractNeedsReviewRows(summary = []) {
  const headers = Array.isArray(summary?.[0]) ? summary[0].map(clean) : [];
  if (!headers.length) return [];
  return summary.slice(1).map((row, index) => ({
    sourceRowIndex: index + 1,
    row,
    headers,
  })).filter(({ row }) => isNeedsReviewRow(headers, row)).map((entry) => ({
    ...entry,
    sourceRowId: readCell(headers, entry.row, HEADER_ALIASES.sourceRowId),
    ruleFamily: inferRuleFamily(headers, entry.row),
    from: readCell(headers, entry.row, HEADER_ALIASES.from),
    action: readCell(headers, entry.row, HEADER_ALIASES.action),
    to: readCell(headers, entry.row, HEADER_ALIASES.to),
    subsystem: readCell(headers, entry.row, HEADER_ALIASES.subsystem),
    scenario: readCell(headers, entry.row, HEADER_ALIASES.scenario),
    mode: readCell(headers, entry.row, HEADER_ALIASES.mode),
    guidePhrase: readCell(headers, entry.row, HEADER_ALIASES.guidePhrase),
    rationale: HEADER_ALIASES.rationale.map((aliases) => readCell(headers, entry.row, [aliases])).filter(Boolean).join(" "),
  }));
}

export function buildNeedsReviewResolutionGroups(summary = [], savedAnswers = {}) {
  const grouped = new Map();
  extractNeedsReviewRows(summary).forEach((entry) => {
    if (!grouped.has(entry.ruleFamily)) grouped.set(entry.ruleFamily, []);
    grouped.get(entry.ruleFamily).push(entry);
  });
  return Object.keys(NEEDS_REVIEW_GROUPS).filter((id) => grouped.has(id)).map((id) => {
    const rows = grouped.get(id);
    const interfaces = Array.from(new Set(rows.map((entry) => (
      [entry.from, entry.action, entry.to].filter(Boolean).join(" → ")
    )).filter(Boolean)));
    const contexts = Array.from(new Set(rows.map((entry) => (
      [entry.scenario, entry.mode].filter(Boolean).join(" · ")
    )).filter(Boolean)));
    const scopeSignature = stableScopeSignature(rows);
    const saved = savedAnswers?.[id] || {};
    return {
      ...NEEDS_REVIEW_GROUPS[id],
      rows,
      affectedRowIndexes: rows.map((entry) => entry.sourceRowIndex),
      affectedRowIds: rows.map((entry) => entry.sourceRowId).filter(Boolean),
      interfaces,
      contexts,
      scopeSignature,
      savedAnswer: clean(saved.answer),
      answeredAt: saved.updatedAt || "",
      scopeChanged: Boolean(saved.scopeSignature && saved.scopeSignature !== scopeSignature),
    };
  });
}

function fieldValue(update, field) {
  if (Object.prototype.hasOwnProperty.call(update || {}, field)) return update[field];
  const camel = field.replace(/^[A-Z]/, (value) => value.toLowerCase()).replace(/[^a-zA-Z0-9]+(.)/g, (_, value) => value.toUpperCase());
  return update?.[camel];
}

function providerDecision(update) {
  return clean(update?.normalizedDecision || update?.decision || fieldValue(update, "Safety Classification"));
}

function namedEvidenceGap(update) {
  return clean(update?.remainingEvidenceGap || update?.evidenceGap || update?.materialEvidenceGap);
}

export function normalizeNeedsReviewClassificationDecision(update = {}, currentFields = {}, originalRule = "U4") {
  const resolvedField = (field) => {
    const supplied = fieldValue(update, field);
    return supplied === undefined || supplied === null ? currentFields[field] : supplied;
  };
  const requested = normalizeSafetyClassification(providerDecision(update), {
    applicable: !/^no$/i.test(clean(fieldValue(update, "Guide Phrase Applicable"))),
    proposedAssessment: fieldValue(update, "Proposed Safety Assessment"),
    causalPathType: fieldValue(update, "Causal Path Type"),
  });
  let classification = requested;
  const protectionAssessment = clean(resolvedField("Protection Assessment"));
  const protectionStatus = normalizeProtectionStatus(fieldValue(update, "Protection Status"), protectionAssessment);
  const causalEffect = clean(resolvedField("Causal Effect"));
  const resultingSystemState = clean(resolvedField("Resulting System State"));
  const intermediateSafetyFunction = clean(resolvedField("Intermediate Safety Function"));
  const intermediateSafetyEffect = clean(resolvedField("Intermediate Safety Effect"));
  const harmChainTermination = clean(resolvedField("Physical-Harm Chain Termination"));
  const classificationEvidence = clean(resolvedField("Classification Evidence"));
  const evidenceGap = namedEvidenceGap(update);
  let downgradeReason = "";
  if (!clean(update?.normalizedDecision)) downgradeReason = "Provider update omitted the required normalizedDecision";
  else if (classification === "Safety — Direct" && (!causalEffect || !resultingSystemState)) {
    downgradeReason = "the direct causal effect and resulting hazardous state are not both established";
  } else if (classification === "Safety — Related" && (!causalEffect || !resultingSystemState || !intermediateSafetyFunction || !intermediateSafetyEffect)) {
    downgradeReason = "the contributory path does not establish its causal effect, resulting state, and intermediate safety function";
  } else if (classification === "Mission/Reliability" && !harmChainTermination) {
    downgradeReason = "the response does not identify where the physical-harm chain terminates";
  } else if (classification === "Needs Review" && !evidenceGap) {
    downgradeReason = "Needs Review requires a concise, named material evidence gap";
  }
  if (downgradeReason && classification !== "Needs Review") classification = "Needs Review";
  if (!classificationEvidence) downgradeReason ||= "Classification Evidence is required";
  const suppliedRule = clean(fieldValue(update, "Safety Classification Rule")).toUpperCase();
  const defaults = {
    "Safety — Direct": { path: "Direct", rule: "D1", significant: "Yes", assessment: "Safety", applicable: "Yes" },
    "Safety — Related": { path: "Contributory", rule: "R1", significant: "Yes", assessment: "Safety", applicable: "Yes" },
    "Mission/Reliability": { path: "None", rule: "M1", significant: "No", assessment: "Mission/Reliability", applicable: "Yes" },
    "Not Applicable": { path: "None", rule: "N1", significant: "No", assessment: "Mission/Reliability", applicable: "No" },
    "Needs Review": { path: "Uncertain", rule: /^U[1-4]$/.test(originalRule) ? originalRule : "U4", significant: "Needs Review", assessment: "Mission/Reliability", applicable: "" },
  }[classification];
  const requiredPrefix = defaults.rule[0];
  const rulePattern = requiredPrefix === "D" ? /^D[1-3]$/ : new RegExp(`^${requiredPrefix}[1-4]$`);
  const rationale = clean(fieldValue(update, "Safety Significance Rationale")
    || fieldValue(update, "Proposed Safety Assessment Rationale")
    || (classification === "Needs Review" ? `Needs review: ${evidenceGap || downgradeReason}.` : classificationEvidence));
  const applicabilityRationale = clean(fieldValue(update, "Guide Phrase Applicability Rationale") || classificationEvidence);
  const decision = {
    "Safety Classification": classification,
    "Safety Classification Rule": normalizeSafetyClassificationRule(
      rulePattern.test(suppliedRule) ? suppliedRule : defaults.rule,
      classification,
      { evidence: `${classificationEvidence} ${protectionAssessment}` },
    ),
    "Causal Path Type": defaults.path,
    "Safety Significant": defaults.significant,
    "Proposed Safety Assessment": defaults.assessment,
    "Protection Status": protectionStatus,
    "Protection Assessment": protectionAssessment || (protectionStatus === "Absent"
      ? "No safeguard, check, interlock, fallback, or independent protection is documented for this context."
      : protectionStatus === "Unknown" ? "Protection independence or effectiveness is not confirmed; it is not credited in this decision." : ""),
    "Guide Phrase Applicable": defaults.applicable || clean(fieldValue(update, "Guide Phrase Applicable")) || "Needs Review",
    "Guide Phrase Applicability Rationale": applicabilityRationale,
    "Proposed Safety Assessment Rationale": rationale,
    "Safety Significance Rationale": rationale,
    "Classification Evidence": classificationEvidence,
    "Classification Confidence": normalizeClassificationConfidence(fieldValue(update, "Classification Confidence")),
    "Causal Effect": classification === "Mission/Reliability" ? clean(fieldValue(update, "Causal Effect")) : causalEffect,
    "Resulting System State": classification === "Mission/Reliability" ? clean(fieldValue(update, "Resulting System State")) : resultingSystemState,
    "Intermediate Safety Function": classification === "Safety — Related" ? intermediateSafetyFunction : "",
    "Intermediate Safety Effect": classification === "Safety — Related" ? intermediateSafetyEffect : "",
    "Physical-Harm Chain Termination": classification === "Mission/Reliability" ? harmChainTermination : "",
  };
  if (classification === "Not Applicable") {
    Object.assign(decision, {
      "Causal Effect": "",
      "Resulting System State": "",
      "Intermediate Safety Function": "",
      "Intermediate Safety Effect": "",
      "Protection Assessment": "Not applicable because the guide phrase cannot affect this interface in the stated context.",
      "Protection Status": "Absent",
      "Physical-Harm Chain Termination": "The deviation is not applicable to this interface and context.",
    });
  }
  return { decision, errors: downgradeReason ? [downgradeReason] : [], evidenceGap };
}

export function applyNeedsReviewResolutionUpdates(summary = [], updates = [], allowedRowIds = []) {
  const headers = Array.isArray(summary?.[0]) ? summary[0] : [];
  if (!headers.length) {
    return {
      summary,
      updatedRowIndexes: [],
      changedRowIndexes: [],
      resolvedRowIndexes: [],
      ignoredRowIndexes: [],
      rejectedUpdates: [],
    };
  }
  const idIndex = headerIndex(headers, HEADER_ALIASES.sourceRowId);
  const allowed = new Set((allowedRowIds || []).map(clean).filter(Boolean));
  const nextRows = summary.slice(1).map((row) => [...row]);
  const rowsById = new Map();
  nextRows.forEach((row, index) => {
    const id = clean(row?.[idIndex]);
    if (!id) return;
    if (rowsById.has(id)) rowsById.set(id, -1);
    else rowsById.set(id, index);
  });
  const mutable = new Set(NEEDS_REVIEW_MUTABLE_FIELDS);
  const updatedRowIndexes = [];
  const changedRowIndexes = [];
  const resolvedRowIndexes = [];
  const ignoredRowIndexes = [];
  const rejectedUpdates = [];

  (Array.isArray(updates) ? updates : []).forEach((update) => {
    const sourceRowId = clean(update?.sourceRowId || update?.["Raw Analysis Row ID"] || update?.rawAnalysisRowId);
    const rowOffset = rowsById.get(sourceRowId);
    if (!sourceRowId || !Number.isInteger(rowOffset) || rowOffset < 0 || (allowed.size && !allowed.has(sourceRowId))) {
      rejectedUpdates.push({ sourceRowId, error: !sourceRowId
        ? "Provider update omitted the required sourceRowId."
        : rowOffset === -1 ? `Raw Analysis Row ID ${sourceRowId} is duplicated.` : `Raw Analysis Row ID ${sourceRowId} is outside the requested scope or does not exist.` });
      return;
    }
    const sourceRowIndex = rowOffset + 1;
    const row = nextRows[rowOffset];
    const beforeRow = [...row];
    const beforeClassification = normalizeSafetyClassification(readCell(headers, row, HEADER_ALIASES.classification));
    const originalRule = readCell(headers, row, HEADER_ALIASES.rule).toUpperCase();
    const currentFields = Object.fromEntries(headers.map((header, index) => [header, row[index]]));
    const normalizedResult = normalizeNeedsReviewClassificationDecision(update, currentFields, originalRule);
    const governed = normalizedResult.decision;
    if (normalizedResult.errors.length) {
      rejectedUpdates.push({ sourceRowId, error: normalizedResult.errors.join("; ") });
      return;
    }
    governed["Control Action Type"] = normalizeControlActionType(
      fieldValue(update, "Control Action Type") || currentFields["Control Action Type"],
      {
        from: currentFields["Function (From)"],
        fromDetails: currentFields["Function (From) Details"],
        controlAction: currentFields["Control Action"],
        controlActionDetails: currentFields["Control Action Details"],
        to: currentFields["Function (To)"],
        toDetails: currentFields["Function (To) Details"],
      },
    );
    headers.forEach((header, columnIndex) => {
      if (!mutable.has(header)) return;
      const supplied = Object.prototype.hasOwnProperty.call(governed, header)
        ? governed[header]
        : fieldValue(update, header);
      if (supplied !== undefined && supplied !== null) row[columnIndex] = clean(supplied);
    });
    // Older imported summaries may not contain the complete governed evidence
    // schema. Audit only complete records; otherwise preserve the legacy
    // resolver behavior instead of treating absent columns as absent evidence.
    if (hasCompletePolicySchema(headers)) {
      const audited = auditSafetyClassificationRecord(policyRecordFromRow(headers, row), {
        from: currentFields["Function (From)"],
        controlAction: currentFields["Control Action"],
        to: currentFields["Function (To)"],
        guidePhrase: currentFields["Guide Phrase"],
      });
      writeCell(headers, row, "Safety Classification", audited.safetyClassification);
      writeCell(headers, row, "Safety Classification Rule", audited.safetyClassificationRule);
      writeCell(headers, row, "Causal Path Type", audited.causalPathType);
      writeCell(headers, row, "Proposed Safety Assessment", audited.proposedSafetyAssessment);
      writeCell(headers, row, "Safety Significant", audited.safetySignificant);
      if (audited.validationFindings.length) {
        beforeRow.forEach((value, index) => { row[index] = value; });
        rejectedUpdates.push({ sourceRowId, error: audited.validationFindings.join("; ") });
        return;
      }
    }
    updatedRowIndexes.push(sourceRowIndex);
    if (row.some((value, index) => value !== beforeRow[index])) changedRowIndexes.push(sourceRowIndex);
    const afterClassification = normalizeSafetyClassification(readCell(headers, row, HEADER_ALIASES.classification));
    if (beforeClassification === "Needs Review" && afterClassification !== "Needs Review") {
      resolvedRowIndexes.push(sourceRowIndex);
    }
  });

  return {
    summary: [headers, ...nextRows],
    updatedRowIndexes: Array.from(new Set(updatedRowIndexes)).sort((a, b) => a - b),
    changedRowIndexes: Array.from(new Set(changedRowIndexes)).sort((a, b) => a - b),
    resolvedRowIndexes: Array.from(new Set(resolvedRowIndexes)).sort((a, b) => a - b),
    ignoredRowIndexes: Array.from(new Set(ignoredRowIndexes)).sort((a, b) => a - b),
    rejectedUpdates,
  };
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw;
  try { return JSON.parse(fenced); } catch {}
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(fenced.slice(start, end + 1)); } catch {}
  }
  return null;
}

function parsedResolutionUpdates(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  const candidates = [
    parsed.updates,
    parsed.rows,
    parsed.results,
    parsed.classifications,
    parsed.data?.updates,
    parsed.data?.rows,
    parsed.output?.updates,
  ];
  const list = candidates.find(Array.isArray);
  if (list) return list;
  return clean(parsed.sourceRowId || parsed.rawAnalysisRowId || parsed["Raw Analysis Row ID"]) ? [parsed] : [];
}

function balancedJsonObjects(text) {
  const raw = String(text || "");
  const objects = [];
  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const character = raw[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try { objects.push(JSON.parse(raw.slice(start, index + 1))); } catch {}
          start = index;
          break;
        }
      }
    }
  }
  return objects;
}

function parseResolutionUpdates(text) {
  const raw = String(text || "").trim();
  const direct = parsedResolutionUpdates(parseJsonObject(raw));
  if (direct.length) return direct;
  const fencedBlocks = Array.from(raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (match) => match[1]);
  for (const block of fencedBlocks) {
    const updates = parsedResolutionUpdates(parseJsonObject(block));
    if (updates.length) return updates;
  }
  return balancedJsonObjects(raw)
    .flatMap(parsedResolutionUpdates)
    .filter((update) => clean(update?.sourceRowId || update?.rawAnalysisRowId || update?.["Raw Analysis Row ID"]));
}

function contentText(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n").trim();
  if (value && typeof value === "object") {
    return contentText(value.text || value.content || value.value || value.output_text || value.message);
  }
  return "";
}

function extractText(payload) {
  return [
    payload?.choices?.[0]?.message?.content,
    payload?.choices?.[0]?.text,
    payload?.result,
    payload?.answer,
    payload?.content,
    payload?.message,
    payload?.text,
    payload?.data?.result,
    payload?.data?.content,
    payload?.output,
    payload?.output_text,
    payload?.candidates?.[0]?.content?.parts,
  ].map(contentText).find(Boolean) || "";
}

function draftText(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).map((item) => `- ${item}`).join("\n");
  if (value && typeof value === "object") return contentText(value);
  return String(value || "").trim();
}

const RESOLUTION_INPUT_FIELDS = new Set([
  "Function (From)",
  "Function (From) Details",
  "Control Action",
  "Control Action Details",
  "Function (To)",
  "Function (To) Details",
  "Control Action Type",
  "Subsystem Allocation",
  "Guide Phrase",
  "Guide Phrase Applicable",
  "Guide Phrase Applicability Rationale",
  "Unsafe Control Action",
  "Canonical Loss ID",
  "Canonical Hazard ID",
  "Loss",
  "Hazard",
  "Causal Scenario",
  "Causal Factor",
  "Proposed Safety Assessment Rationale",
  "Safety Classification",
  "Safety Classification Rule",
  "Causal Path Type",
  "Causal Effect",
  "Resulting System State",
  "Intermediate Safety Function",
  "Intermediate Safety Effect",
  "Protection Assessment",
  "Protection Status",
  "Physical-Harm Chain Termination",
  "Classification Evidence",
  "Safety Significance Rationale",
  "Operational Scenario",
  "Operational Mode",
  "Operating Conditions",
  "Context Assumptions",
]);

function compactResolutionRow(entry) {
  const cells = Object.fromEntries(entry.headers
    .map((header, index) => [header, clean(entry.row?.[index])])
    .filter(([header, value]) => value && RESOLUTION_INPUT_FIELDS.has(header)));
  return { sourceRowId: entry.sourceRowId, ...cells };
}

async function requestResolutionChunk({ group, answer, projectName, organizationContext, rows, signal }) {
  const prompt = `
Re-evaluate only the supplied Needs Review hazard-analysis rows using the stakeholder-provided architecture evidence. Return strict JSON only.

Project: ${projectName || "Untitled project"}
Question category: ${group.id} — ${group.title}
Question: ${group.question}
Stakeholder architecture evidence:
${answer}

${organizationContext || "No organization calibration profile is enabled for this project."}

Rows to re-evaluate:
${JSON.stringify(rows.map(compactResolutionRow), null, 2)}

Return:
{
  "updates": [
    {
      "sourceRowId": "exact Raw Analysis Row ID from the input row",
      "normalizedDecision": "Safety — Direct | Safety — Related | Mission/Reliability | Needs Review | Not Applicable",
      "Guide Phrase Applicable": "Yes | No | Needs Review",
      "Control Action Type": "canonical interface semantic type",
      "Safety Classification": "Safety — Direct | Safety — Related | Mission/Reliability | Needs Review | Not Applicable",
      "Safety Classification Rule": "matching D1-D3, R1-R4, M1-M4, N1-N4, or U1-U4 rule",
      "Protection Status": "Effective | Ineffective/Unavailable | Absent | Unknown",
      "Classification Evidence": "specific row evidence plus stakeholder architecture evidence",
      "Classification Confidence": "High | Medium | Low",
      "Safety Significance Rationale": "concise final rationale",
      "Causal Effect": "include only when correcting or completing the supplied value",
      "Resulting System State": "include only when correcting or completing the supplied value",
      "Intermediate Safety Function": "include only for a corrected or completed contributory path",
      "Intermediate Safety Effect": "include only for a corrected or completed contributory path",
      "Physical-Harm Chain Termination": "include only for Mission/Reliability",
      "remainingEvidenceGap": "required only for Needs Review; one named material missing fact"
    }
  ]
}

Rules:
- Re-evaluate every supplied row independently in its exact scenario, mode, guide phrase, interface, and causal context.
- Type the directed interface from its action and endpoint details. Observed/current/estimated state, execution response, feedback, and health/fault status are observational data, not commands merely because the receiver acts on them.
- Treat the stakeholder answer as project architecture evidence, not as permission to force a definitive result. Keep Needs Review when the answer does not resolve the row's actual evidence gap.
- Do not generalize a safeguard, authority, contract, or fallback to an interface or mode the answer does not cover.
- Safety — Direct requires a complete causal path from the deviation to a hazardous state and credible physical harm without another safety-function failure.
- Safety — Related requires a named intermediate safety function and the contributory effect on it.
- Mission/Reliability requires an explicit point where the physical-harm chain terminates.
- Not Applicable requires a concrete semantic or architectural reason the exact guide phrase cannot affect the receiver in this context.
- An unconfirmed protection is Unknown, not Effective. An explicitly absent protection is Absent.
- Unknown protection status does not by itself invalidate an otherwise complete direct or contributory physical-harm path. Classify the evidenced path and retain Unknown as the separate protection-status finding.
- Do not retain Needs Review merely because no safeguard is confirmed. Use Needs Review only when the causal path, applicability, authority, interface contract, or chain termination needed for classification remains genuinely unresolved.
- Do not invent numerical thresholds, authority, safeguards, implementation status, or evidence.
- Preserve supplied causal fields that are already adequate; do not repeat or rewrite long text unless a correction is necessary.
- Include every supplied sourceRowId exactly once and copy it byte-for-byte. normalizedDecision is required and controls the atomic dependent-field mapping. Do not change row identity, interface, context, hazard, loss, causal scenario, mitigation, constraint, or requirement fields.
  `.trim();
  const provider = getStoredActiveAIProvider();
  const model = getStoredAIProviderModelPreference(provider, { includeDefault: true });
  const timeoutController = new AbortController();
  let timedOut = false;
  const forwardAbort = () => timeoutController.abort();
  const timeoutId = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, 180_000);
  signal?.addEventListener?.("abort", forwardAbort, { once: true });
  let response;
  try {
    response = await fetch(`${backendURL}/api/chat`, {
      method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
      signal: timeoutController.signal,
      body: JSON.stringify({
        provider,
        model,
        messages: [
          { role: "system", content: "Perform an evidence-disciplined safety-classification re-evaluation. Return complete strict JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: Math.min(8000, Math.max(2600, rows.length * 320)),
      }),
    });
  } catch (error) {
    if (timedOut) throw new Error("Needs Review re-evaluation timed out before the AI returned a complete result.");
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener?.("abort", forwardAbort);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Needs Review resolution failed (${response.status}). ${detail}`.trim());
  }
  const rawText = extractText(await response.json());
  const updates = parseResolutionUpdates(rawText);
  if (!updates.length) {
    const error = new Error("The AI response could not be parsed as Needs Review row updates.");
    error.code = "INVALID_NEEDS_REVIEW_UPDATES";
    throw error;
  }
  return updates;
}

async function requestResolutionRowsWithRecovery(options, rows, depth = 0) {
  if (!rows.length) return [];
  try {
    const updates = await requestResolutionChunk({ ...options, rows });
    const returned = new Set(updates.map((update) => clean(update?.sourceRowId || update?.rawAnalysisRowId || update?.["Raw Analysis Row ID"])).filter(Boolean));
    const missingRows = rows.filter((entry) => !returned.has(entry.sourceRowId));
    if (!missingRows.length || depth >= 4) return updates;
    const recovered = await requestResolutionRowsWithRecovery(options, missingRows, depth + 1);
    return [...updates, ...recovered];
  } catch (error) {
    if (error?.code !== "INVALID_NEEDS_REVIEW_UPDATES") throw error;
    if (rows.length === 1 || depth >= 4) return [];
    const midpoint = Math.ceil(rows.length / 2);
    const left = await requestResolutionRowsWithRecovery(options, rows.slice(0, midpoint), depth + 1);
    const right = await requestResolutionRowsWithRecovery(options, rows.slice(midpoint), depth + 1);
    return [...left, ...right];
  }
}

export async function resolveNeedsReviewGroupWithAI({
  group,
  answer,
  projectName,
  organizationContext = "",
  signal,
  chunkSize = 8,
  concurrency = 2,
  onProgress,
  onChunk,
} = {}) {
  if (!group?.rows?.length) return { updates: [], missingRowIds: [], completedRows: 0 };
  if (group.rows.some((entry) => !entry.sourceRowId)) throw new Error("Every Needs Review row must have a stable Raw Analysis Row ID before resolution.");
  if (!clean(answer)) throw new Error("Add architecture evidence before resolving this question.");
  if (!stakeholderAnswerEstablishesEvidence(answer)) {
    return {
      updates: group.rows.map((entry) => ({
        sourceRowId: entry.sourceRowId,
        normalizedDecision: "Needs Review",
        "Guide Phrase Applicable": "Needs Review",
        "Safety Classification": "Needs Review",
        "Safety Classification Rule": group.id,
        "Protection Status": "Unknown",
        "Classification Evidence": clean(answer),
        "Safety Significance Rationale": `Needs review: the stakeholder response does not establish the row-specific ${group.title.toLowerCase()} evidence needed to close this gap.`,
        remainingEvidenceGap: `Row-specific ${group.title.toLowerCase()} evidence`,
      })),
      missingRowIds: [],
      completedRows: group.rows.length,
    };
  }
  const updates = [];
  const chunks = [];
  for (let index = 0; index < group.rows.length; index += chunkSize) chunks.push(group.rows.slice(index, index + chunkSize));
  let nextChunkIndex = 0;
  let completedRows = 0;
  const worker = async () => {
    while (nextChunkIndex < chunks.length) {
      if (signal?.aborted) throw new DOMException("Resolution canceled", "AbortError");
      const chunkIndex = nextChunkIndex;
      nextChunkIndex += 1;
      const rows = chunks[chunkIndex];
      onProgress?.({ completedRows, totalRows: group.rows.length, activeRows: rows.length });
      const chunkUpdates = await requestResolutionRowsWithRecovery({
        group,
        answer: clean(answer),
        projectName,
        organizationContext,
        signal,
      }, rows);
      updates.push(...chunkUpdates);
      await onChunk?.({ updates: chunkUpdates, rowIds: rows.map((entry) => entry.sourceRowId) });
      completedRows += rows.length;
      onProgress?.({ completedRows, totalRows: group.rows.length, activeRows: 0 });
    }
  };
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, chunks.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const deduplicatedUpdates = Array.from(new Map(updates.map((update) => [
    clean(update?.sourceRowId || update?.rawAnalysisRowId || update?.["Raw Analysis Row ID"]),
    update,
  ])).values()).filter((update) => clean(update?.sourceRowId || update?.rawAnalysisRowId || update?.["Raw Analysis Row ID"]));
  const returned = new Set(deduplicatedUpdates.map((update) => clean(update?.sourceRowId || update?.rawAnalysisRowId || update?.["Raw Analysis Row ID"])));
  return {
    updates: deduplicatedUpdates,
    missingRowIds: group.affectedRowIds.filter((id) => !returned.has(id)),
    completedRows,
  };
}

export async function draftNeedsReviewAnswerWithAI({
  group,
  projectName,
  organizationContext = "",
  functionalDecomposition = [],
  signal,
} = {}) {
  if (!group?.rows?.length) throw new Error("This review question has no linked hazard rows.");
  const hazardEvidence = group.rows.map((entry) => ({
    sourceRowIndex: entry.sourceRowIndex,
    interface: [entry.from, entry.action, entry.to].filter(Boolean).join(" → "),
    subsystem: entry.subsystem,
    scenario: entry.scenario,
    mode: entry.mode,
    guidePhrase: entry.guidePhrase,
    currentReviewRationale: entry.rationale,
  }));
  const architectureRows = (Array.isArray(functionalDecomposition) ? functionalDecomposition : []).slice(0, 240).map((row, index) => ({
    rowIndex: index + 1,
    subsystem: clean(row?.subsystem),
    fromFunction: clean(row?.fromFunction),
    fromDetails: clean(row?.fromDetails || row?.fromFunctionDetails),
    controlAction: clean(row?.controlAction),
    controlDetails: clean(row?.controlDetails || row?.controlActionDetails),
    toFunction: clean(row?.toFunction),
    toDetails: clean(row?.toDetails || row?.toFunctionDetails),
  }));
  const prompt = `
Draft a proposed stakeholder answer to one grouped hazard-analysis architecture question. Return strict JSON only.

Project: ${projectName || "Untitled project"}
Question category: ${group.id} — ${group.title}
Question: ${group.question}
Guidance: ${group.guidance}

Organization profile and governed context:
${organizationContext || "No organization calibration profile is enabled for this project."}

Current functional decomposition:
${JSON.stringify(architectureRows, null, 2)}

Needs Review evidence:
${JSON.stringify(hazardEvidence, null, 2)}

Return:
{
  "answer": "A concise, editable architecture-evidence answer for the user",
  "evidenceGaps": ["specific unresolved fact the user may need to confirm"]
}

Rules:
- Use only the supplied organization profile, functional decomposition, operational contexts, and hazard-row evidence.
- Distinguish documented project facts from organization policy, inference, proposal, and unknown information.
- Do not claim that a safeguard, fallback, authority, timing contract, implementation, or verification exists unless the supplied evidence establishes it.
- Cover material differences between affected interfaces or modes. Do not imply one rule applies universally when evidence differs.
- Where evidence is absent, write “Not established in the available project evidence” and identify the exact decision or artifact needed.
- Do not invent numerical thresholds. Use named TBD parameters when a contract clearly needs a value that has not been provided.
- The answer will be reviewed and edited by a human before it is used to re-evaluate classifications.
- Keep the answer useful and concise: generally 2-6 short paragraphs or bullets.
  `.trim();
  const provider = getStoredActiveAIProvider();
  const model = getStoredAIProviderModelPreference(provider, { includeDefault: true });
  const timeoutController = new AbortController();
  let timedOut = false;
  const forwardAbort = () => timeoutController.abort();
  const timeoutId = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, 120_000);
  signal?.addEventListener?.("abort", forwardAbort, { once: true });
  let response;
  try {
    response = await fetch(`${backendURL}/api/chat`, {
      method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
      signal: timeoutController.signal,
      body: JSON.stringify({
        provider,
        model,
        messages: [
          { role: "system", content: "Draft an evidence-grounded architecture answer for human review. Return complete strict JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 2200,
      }),
    });
  } catch (error) {
    if (timedOut) throw new Error("The AI review timed out before it returned a proposed answer.");
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener?.("abort", forwardAbort);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI architecture review failed (${response.status}). ${detail}`.trim());
  }
  const rawText = extractText(await response.json());
  const parsed = parseJsonObject(rawText);
  const evidenceGaps = (Array.isArray(parsed?.evidenceGaps) ? parsed.evidenceGaps : [])
    .map(clean)
    .filter(Boolean);
  let answer = draftText(
    parsed?.answer
    || parsed?.proposedAnswer
    || parsed?.draftAnswer
    || parsed?.draft
    || parsed?.review
  );
  let fallback = false;
  const trimmedRawText = rawText.trimStart();
  const rawTextLooksStructured = trimmedRawText.startsWith("{") || trimmedRawText.startsWith("[");
  if (!clean(answer) && rawText && !rawTextLooksStructured) answer = rawText.trim();
  if (!clean(answer)) {
    fallback = true;
    answer = `Not established in the available project evidence. xHandle did not find confirmed ${group.title.toLowerCase()} evidence that can be applied across the ${group.affectedRowIndexes.length} linked Needs Review rows. Confirm the behavior for the affected interfaces and operational modes before assigning definitive classifications.`;
  }
  return {
    answer: evidenceGaps.length
      ? `${answer}\n\nEvidence still requiring confirmation:\n${evidenceGaps.map((gap) => `- ${gap}`).join("\n")}`
      : answer,
    evidenceGaps,
    fallback,
  };
}
