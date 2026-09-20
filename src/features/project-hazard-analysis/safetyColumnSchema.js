import {
  SAFETY_CLASSIFICATION,
  normalizeSafetyClassification,
  normalizeSafetyPathType,
  safetySignificanceValue,
} from "./safetySignificancePolicy";

const clean = (value) => String(value ?? "").trim();

export const SAFETY_DETAIL_HEADERS = Object.freeze([
  "Safety Classification Rule",
  "Causal Path Type",
  "Intermediate Safety Function",
  "Intermediate Safety Effect",
  "Protection Assessment",
  "Classification Confidence",
  "Safety Significant",
  "Safety Significance Rationale",
]);

const SAFETY_DETAIL_HEADER_SET = new Set(SAFETY_DETAIL_HEADERS);

export function isSafetyDetailHeader(header) {
  return SAFETY_DETAIL_HEADER_SET.has(clean(header));
}

export function safetyColumnDisplayLabel(header) {
  return clean(header) === "Classification Evidence" ? "Classification Rationale" : clean(header);
}

export function getSafetyDetailEntries(headers = [], row = []) {
  return headers.reduce((entries, header, index) => {
    if (!isSafetyDetailHeader(header)) return entries;
    const value = clean(row?.[index]);
    if (!value) return entries;
    entries.push({ header: clean(header), label: safetyColumnDisplayLabel(header), value });
    return entries;
  }, []);
}

export function reconcileDerivedSafetyColumns(headers = [], sourceRow = []) {
  const row = [...sourceRow];
  const index = Object.fromEntries(headers.map((header, headerIndex) => [clean(header), headerIndex]));
  const classificationIndex = index["Safety Classification"];
  if (classificationIndex === undefined) return row;

  const classification = normalizeSafetyClassification(row[classificationIndex], {
    applicable: !/^no$|^not applicable$/i.test(clean(row[index["Guide Phrase Applicable"]])),
    causalPathType: row[index["Causal Path Type"]],
  });
  if (!clean(row[classificationIndex])) return row;
  row[classificationIndex] = classification;

  const pathIndex = index["Causal Path Type"];
  if (pathIndex !== undefined) row[pathIndex] = normalizeSafetyPathType(row[pathIndex], classification);

  const significanceIndex = index["Safety Significant"];
  if (significanceIndex !== undefined && classification !== SAFETY_CLASSIFICATION.REVIEW) {
    row[significanceIndex] = safetySignificanceValue(classification);
  }
  return row;
}

