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

const ADJUDICATED_SIGNIFICANCE = /^(?:Yes|No)$/i;

function resolveClassification(headers = [], row = []) {
  const index = Object.fromEntries(headers.map((header, headerIndex) => [clean(header), headerIndex]));
  const classificationIndex = index["Safety Classification"];
  if (classificationIndex === undefined || !clean(row?.[classificationIndex])) return null;
  return {
    index,
    classificationIndex,
    classification: normalizeSafetyClassification(row[classificationIndex], {
      applicable: !/^no$|^not applicable$/i.test(clean(row[index["Guide Phrase Applicable"]])),
      causalPathType: row[index["Causal Path Type"]],
    }),
  };
}

export function reconcileDerivedSafetyColumns(headers = [], sourceRow = []) {
  const row = [...sourceRow];
  const resolved = resolveClassification(headers, row);
  if (!resolved) return row;
  const { index, classificationIndex, classification } = resolved;
  row[classificationIndex] = classification;

  const pathIndex = index["Causal Path Type"];
  if (pathIndex !== undefined) row[pathIndex] = normalizeSafetyPathType(row[pathIndex], classification);

  // Safety Significant is governed by the reviewer, not derived from the
  // classification. Seed it only while it has never been adjudicated; an
  // explicit Yes or No is a human engineering decision and is never rewritten
  // here. A settled classification that disagrees with it is a conflict for the
  // reviewer to resolve -- see derivedSignificanceConflict() -- not something
  // this function may silently correct on the way to storage.
  const significanceIndex = index["Safety Significant"];
  if (significanceIndex !== undefined
    && classification !== SAFETY_CLASSIFICATION.REVIEW
    && !ADJUDICATED_SIGNIFICANCE.test(clean(row[significanceIndex]))) {
    row[significanceIndex] = safetySignificanceValue(classification);
  }
  return row;
}

/**
 * Report a governed Safety Significant decision that the row's settled Safety
 * Classification contradicts. Returns null when there is nothing to resolve:
 * no classification, no adjudicated decision, or the two already agree.
 */
export function derivedSignificanceConflict(headers = [], row = []) {
  const resolved = resolveClassification(headers, row);
  if (!resolved) return null;
  const { index, classification } = resolved;
  const significanceIndex = index["Safety Significant"];
  if (significanceIndex === undefined || classification === SAFETY_CLASSIFICATION.REVIEW) return null;

  const governed = clean(row?.[significanceIndex]);
  if (!ADJUDICATED_SIGNIFICANCE.test(governed)) return null;

  const derived = safetySignificanceValue(classification);
  if (governed.toLowerCase() === derived.toLowerCase()) return null;
  return { governed, derived, classification };
}

export function describeSignificanceConflict(conflict) {
  if (!conflict) return "";
  return `Safety Significant = ${conflict.governed} is a governed review decision, but Safety Classification ${conflict.classification} implies ${conflict.derived}. Re-review the significance decision or change the classification; neither value was altered automatically.`;
}
