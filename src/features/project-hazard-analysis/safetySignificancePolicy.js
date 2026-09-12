const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalized = (value) => text(value).toLowerCase();

export const SAFETY_CLASSIFICATION = Object.freeze({
  DIRECT: "Safety — Direct",
  RELATED: "Safety — Related",
  MISSION: "Mission/Reliability",
  REVIEW: "Needs Review",
  NOT_APPLICABLE: "Not Applicable",
});

export const SAFETY_PATH_TYPE = Object.freeze({
  DIRECT: "Direct",
  CONTRIBUTORY: "Contributory",
  NONE: "None",
  UNCERTAIN: "Uncertain",
});

export const PROTECTION_STATUS = Object.freeze({
  EFFECTIVE: "Effective",
  INEFFECTIVE: "Ineffective/Unavailable",
  ABSENT: "Absent",
  UNKNOWN: "Unknown",
});

const DIRECT_RULE = /^D[1-3]$/i;
const RELATED_RULE = /^R[1-4]$/i;
const MISSION_RULE = /^M[1-4]$/i;
const REVIEW_RULE = /^U[1-4]$/i;
const NOT_APPLICABLE_RULE = /^N[1-4]$/i;
const HARM_PATH = /\b(?:L[1-3]\b|collision|crash|injur\w*|fatal\w*|death|physical harm|strik(?:e|ing)|crush\w*|burn\w*|electrocut\w*|toxic release|environmental harm|hazardous energy|unsafe (?:proximity|separation|clearance)|loss of (?:safe )?separation|unintended (?:physical )?(?:motion|movement|actuation)|loss of (?:vehicle|machine|motion|physical) control|vehicle instability|rollover|physical (?:asset|property|equipment|infrastructure) damage)\b/i;
const NEGATED_HARM_ASSERTION = /\b(?:no|not|without|cannot|does not|do not|fails? to|did not)\b[^.;\n]{0,100}\b(?:L[1-3]|physical harm|harm path|mishap|collision|crash|injur\w*|fatal\w*|death|hazardous state|hazardous outcome|physical damage|environmental harm)\b/gi;

function isSubstantiveClassificationEvidence(value = "") {
  const candidate = normalized(value);
  if (!candidate) return false;
  if (/^not applicable\b/.test(candidate)) return false;
  return !/^(?:n\/?a|none|unknown|tbd|to be determined|not established|not documented|not defined|unconfirmed)[.!]?$/.test(candidate);
}

export function normalizeProtectionStatus(value = "", assessment = "") {
  const candidate = normalized(`${value} ${assessment}`);
  if (/\b(?:absent|none|no (?:independent |credited |documented |evidenced |identified )?(?:protection|barrier|safeguard|fallback|check|interlock)(?:\s+(?:is|was|has been))?\s*(?:documented|implemented|present|identified)?|does not exist|not present)\b/.test(candidate)
    && !/\b(?:unknown|unconfirmed|not confirmed|requires? confirmation|pending confirmation|tbd)\b/.test(candidate)) {
    return PROTECTION_STATUS.ABSENT;
  }
  if (/\b(?:unknown|unconfirmed|not confirmed|not established|not evidenced|not verified|requires? (?:project )?confirmation|pending confirmation|tbd|cannot be (?:determined|credited)|insufficient evidence)\b/.test(candidate)
    || /\bno\b[^.;]{0,70}\b(?:confirmed|credited|evidenced|established|verified)\b/.test(candidate)) {
    return PROTECTION_STATUS.UNKNOWN;
  }
  if (/\b(?:ineffective|unavailable|failed|degraded|bypassed|defeated|not effective|does not prevent|cannot prevent|insufficient|inadequate)\b/.test(candidate)) {
    return PROTECTION_STATUS.INEFFECTIVE;
  }
  if (/\b(?:absent|none|no (?:independent |credited |documented |evidenced |identified )?(?:protection|barrier|safeguard|fallback|check|interlock)|does not exist|not present)\b/.test(candidate)) {
    return PROTECTION_STATUS.ABSENT;
  }
  if (/\b(?:effective|available|operational|active|adequate|credited)\b/.test(candidate)) {
    return PROTECTION_STATUS.EFFECTIVE;
  }
  return PROTECTION_STATUS.UNKNOWN;
}

export function containsAffirmativeHarmPath(record = {}) {
  const affirmativeFields = [
    record.losses,
    record.loss,
    record.hazards,
    record.hazard,
    record.causalScenario,
    record.safetyExposurePath,
    record.causalEffect,
    record.resultingSystemState,
    record.intermediateSafetyEffect,
    record.classificationEvidence,
    record.safetySignificanceRationale,
    record.proposedSafetyAssessmentRationale,
  ];
  return affirmativeFields.some((value) => {
    const source = text(value);
    if (!source) return false;
    const withoutNegatedClaims = source.replace(NEGATED_HARM_ASSERTION, " ");
    return HARM_PATH.test(withoutNegatedClaims);
  });
}

export function normalizeSafetyClassificationRule(value = "", classification = SAFETY_CLASSIFICATION.REVIEW, {
  guidePhrase = "",
  evidence = "",
} = {}) {
  const familyByClassification = {
    [SAFETY_CLASSIFICATION.DIRECT]: "D",
    [SAFETY_CLASSIFICATION.RELATED]: "R",
    [SAFETY_CLASSIFICATION.MISSION]: "M",
    [SAFETY_CLASSIFICATION.REVIEW]: "U",
    [SAFETY_CLASSIFICATION.NOT_APPLICABLE]: "N",
  };
  const family = familyByClassification[classification] || "U";
  const allowedMaximum = family === "D" ? 3 : 4;
  const match = text(value).toUpperCase().match(/\b([DRMNU])\s*[-:]?\s*([1-4])\b/);
  if (match && match[1] === family && Number(match[2]) <= allowedMaximum) return `${match[1]}${match[2]}`;

  const basis = normalized(`${evidence} ${value}`);
  const guide = normalized(guidePhrase);
  if (family === "D") {
    if (/protect|barrier|safeguard|shutdown|brak|contain/.test(basis)) return "D3";
    if (/command|authoriz|select|maintain|enable|mode/.test(basis)) return "D2";
    return "D1";
  }
  if (family === "R") {
    if (/common.?cause|shared dependency/.test(basis)) return "R4";
    if (/authority|mode|responsibility|transition/.test(basis)) return "R3";
    if (/protect|barrier|safeguard|shutdown|brak|contain|monitor|recover|warning/.test(basis)) return "R2";
    return "R1";
  }
  if (family === "M") {
    if (/report|status|fleet|dispatch|advisory|tracking/.test(basis)) return "M3";
    if (/safe (?:hold|shutdown|stop)|demonstrably safe|safe degraded/.test(basis)) return "M4";
    if (/effective|independent|contained/.test(basis)) return "M2";
    return "M1";
  }
  if (family === "N") {
    if (/too early|too late/.test(guide)) return "N1";
    if (/wrong order/.test(guide)) return "N2";
    if (/stopped too soon|applied too long/.test(guide)) return "N3";
    return "N4";
  }
  if (/authority/.test(basis)) return "U1";
  if (/protect|barrier|fallback|safe state|redundan/.test(basis)) return "U2";
  if (/timing|deadline|fresh|sequence|duration|exposure|time.to.harm/.test(basis)) return "U3";
  return "U4";
}

export function normalizeSafetyClassification(value, {
  applicable = true,
  proposedAssessment = "",
  contributionType = "",
  causalPathType = "",
} = {}) {
  if (!applicable) return SAFETY_CLASSIFICATION.NOT_APPLICABLE;
  const candidate = normalized(value);
  if (/not applicable/.test(candidate)) return SAFETY_CLASSIFICATION.NOT_APPLICABLE;
  if (/needs review|uncertain|indeterminate|unknown/.test(candidate)) return SAFETY_CLASSIFICATION.REVIEW;
  if (/safety.*direct|direct safety/.test(candidate)) return SAFETY_CLASSIFICATION.DIRECT;
  if (/safety.*related|related safety|contributory/.test(candidate)) return SAFETY_CLASSIFICATION.RELATED;
  if (/mission|reliability|non-?safety/.test(candidate)) return SAFETY_CLASSIFICATION.MISSION;

  const path = normalized(causalPathType);
  const contribution = normalized(contributionType);
  const proposed = normalized(proposedAssessment);
  if (/^direct/.test(path) || /^direct safety control/.test(contribution)) return SAFETY_CLASSIFICATION.DIRECT;
  if (/contribut/.test(path) || /safety-critical feedback|indirect safety contributor/.test(contribution)) {
    return SAFETY_CLASSIFICATION.RELATED;
  }
  if (/^safety\b/.test(proposed)) return SAFETY_CLASSIFICATION.REVIEW;
  if (/mission|reliability/.test(proposed)) return SAFETY_CLASSIFICATION.MISSION;
  return SAFETY_CLASSIFICATION.REVIEW;
}

export function normalizeSafetyPathType(value, classification = SAFETY_CLASSIFICATION.REVIEW) {
  if (classification === SAFETY_CLASSIFICATION.DIRECT) return SAFETY_PATH_TYPE.DIRECT;
  if (classification === SAFETY_CLASSIFICATION.RELATED) return SAFETY_PATH_TYPE.CONTRIBUTORY;
  if (classification === SAFETY_CLASSIFICATION.MISSION || classification === SAFETY_CLASSIFICATION.NOT_APPLICABLE) return SAFETY_PATH_TYPE.NONE;
  if (classification === SAFETY_CLASSIFICATION.REVIEW) return SAFETY_PATH_TYPE.UNCERTAIN;
  const candidate = normalized(value);
  if (/^direct\b/.test(candidate)) return SAFETY_PATH_TYPE.DIRECT;
  if (/contribut|indirect|related/.test(candidate)) return SAFETY_PATH_TYPE.CONTRIBUTORY;
  if (/^none\b|no path|terminat/.test(candidate)) return SAFETY_PATH_TYPE.NONE;
  return SAFETY_PATH_TYPE.UNCERTAIN;
}

export function safetyClassificationRollup(classification) {
  return classification === SAFETY_CLASSIFICATION.DIRECT || classification === SAFETY_CLASSIFICATION.RELATED
    ? "Safety"
    : "Mission/Reliability";
}

export function safetySignificanceValue(classification) {
  if (classification === SAFETY_CLASSIFICATION.DIRECT || classification === SAFETY_CLASSIFICATION.RELATED) return "Yes";
  if (classification === SAFETY_CLASSIFICATION.REVIEW) return "Needs Review";
  return "No";
}

export function validateSafetyClassificationRecord(record = {}, item = {}) {
  const applicable = !/^no\b|^not applicable\b/i.test(text(record.guidePhraseApplicable));
  const classification = normalizeSafetyClassification(record.safetyClassification, {
    applicable,
    proposedAssessment: record.proposedSafetyAssessment,
    contributionType: record.safetyContributionType,
    causalPathType: record.causalPathType,
  });
  const pathType = normalizeSafetyPathType(record.causalPathType, classification);
  const causalEffect = text(record.causalEffect);
  const resultingSystemState = text(record.resultingSystemState);
  const intermediateSafetyFunction = text(record.intermediateSafetyFunction);
  const intermediateSafetyEffect = text(record.intermediateSafetyEffect);
  const protectionAssessment = text(record.protectionAssessment);
  const protectionStatus = normalizeProtectionStatus(record.protectionStatus, protectionAssessment);
  const physicalHarmChainTermination = text(record.physicalHarmChainTermination);
  const classificationRule = normalizeSafetyClassificationRule(
    record.safetyClassificationRule || record.classificationRule,
    classification,
    { guidePhrase: record.guidePhrase || item.guidePhrase, evidence: `${record.classificationEvidence || ""} ${protectionAssessment}` },
  );
  const hasHarmPath = containsAffirmativeHarmPath(record);
  const findings = [];

  if (!applicable) {
    if (classification !== SAFETY_CLASSIFICATION.NOT_APPLICABLE) findings.push("A non-applicable row must use the Not Applicable safety classification.");
    return {
      classification: SAFETY_CLASSIFICATION.NOT_APPLICABLE,
      pathType: SAFETY_PATH_TYPE.NONE,
      classificationRule: normalizeSafetyClassificationRule(
        record.safetyClassificationRule || record.classificationRule,
        SAFETY_CLASSIFICATION.NOT_APPLICABLE,
        { guidePhrase: record.guidePhrase || item.guidePhrase },
      ),
      protectionStatus: PROTECTION_STATUS.ABSENT,
      hasHarmPath: false,
      findings,
    };
  }

  if (classification === SAFETY_CLASSIFICATION.DIRECT) {
    if (pathType !== SAFETY_PATH_TYPE.DIRECT) findings.push("Safety — Direct requires a Direct causal path.");
    if (!isSubstantiveClassificationEvidence(causalEffect)) findings.push("Safety — Direct requires the causal effect on the receiver or controlled process.");
    if (!isSubstantiveClassificationEvidence(resultingSystemState)) findings.push("Safety — Direct requires the resulting hazardous system state.");
    if (!hasHarmPath) findings.push("Safety — Direct requires a traceable L1-L3 mishap or physical-harm path.");
    if (!protectionAssessment) findings.push("Safety — Direct requires an assessment of credited independent protections.");
    if (!DIRECT_RULE.test(classificationRule)) findings.push("Safety — Direct requires a D1-D3 classification rule.");
  } else if (classification === SAFETY_CLASSIFICATION.RELATED) {
    if (pathType !== SAFETY_PATH_TYPE.CONTRIBUTORY) findings.push("Safety — Related requires a Contributory causal path.");
    if (!isSubstantiveClassificationEvidence(causalEffect)) findings.push("Safety — Related requires the causal effect on the receiver or controlled process.");
    if (!isSubstantiveClassificationEvidence(resultingSystemState)) findings.push("Safety — Related requires the resulting system state.");
    if (!isSubstantiveClassificationEvidence(intermediateSafetyFunction)) findings.push("Safety — Related requires a named intermediate safety function, control, barrier, or response.");
    if (!isSubstantiveClassificationEvidence(intermediateSafetyEffect)) findings.push("Safety — Related requires the effect on the intermediate safety function.");
    if (!hasHarmPath) findings.push("Safety — Related requires a traceable contributory path to an L1-L3 mishap or physical harm.");
    if (!protectionAssessment) findings.push("Safety — Related requires an assessment of credited independent protections.");
    if (!RELATED_RULE.test(classificationRule)) findings.push("Safety — Related requires an R1-R4 classification rule.");
  } else if (classification === SAFETY_CLASSIFICATION.MISSION) {
    if (hasHarmPath) findings.push("Mission/Reliability contradicts an asserted L1-L3 or physical-harm path.");
    if (!isSubstantiveClassificationEvidence(physicalHarmChainTermination)) findings.push("Mission/Reliability requires the point where the physical-harm chain terminates.");
    if (classificationRule && !MISSION_RULE.test(classificationRule)) findings.push("Mission/Reliability requires an M1-M4 classification rule.");
  } else if (classification === SAFETY_CLASSIFICATION.REVIEW) {
    if (classificationRule && !REVIEW_RULE.test(classificationRule)) findings.push("Needs Review requires a U1-U4 classification rule.");
  } else if (classification === SAFETY_CLASSIFICATION.NOT_APPLICABLE) {
    if (classificationRule && !NOT_APPLICABLE_RULE.test(classificationRule)) findings.push("Not Applicable requires an N1-N4 classification rule.");
  }

  const receiver = text(item.to);
  if (
    classification === SAFETY_CLASSIFICATION.RELATED
    && /\b(?:fleet|dispatch|logging|analytics|reporting|remote operation)\b/i.test(receiver)
    && !/\b(?:protect|interven|dispatch|emergency|minimum.?risk|safe state|recover)\b/i.test(`${intermediateSafetyFunction} ${intermediateSafetyEffect}`)
  ) {
    findings.push("A reporting or advisory receiver is Safety — Related only when a named protective response and its effect are established.");
  }

  return { classification, pathType, classificationRule, protectionStatus, hasHarmPath, findings };
}

export function normalizeClassificationConfidence(value) {
  const candidate = normalized(value);
  if (/^high\b/.test(candidate)) return "High";
  if (/^low\b/.test(candidate)) return "Low";
  return "Medium";
}

export function auditSafetyClassificationRecord(record = {}, item = {}) {
  const validation = validateSafetyClassificationRecord(record, item);
  const classification = validation.findings.length ? SAFETY_CLASSIFICATION.REVIEW : validation.classification;
  return {
    ...record,
    safetyClassification: classification,
    causalPathType: normalizeSafetyPathType(record.causalPathType, classification),
    safetyClassificationRule: normalizeSafetyClassificationRule(
      record.safetyClassificationRule || record.classificationRule,
      classification,
      { guidePhrase: record.guidePhrase || item.guidePhrase, evidence: validation.findings.join(" ") },
    ),
    proposedSafetyAssessment: safetyClassificationRollup(classification),
    safetySignificant: safetySignificanceValue(classification),
    validationFindings: validation.findings,
  };
}
