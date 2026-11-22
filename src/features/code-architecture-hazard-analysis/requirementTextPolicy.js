// Output-language policy only. Never edit source values, decomposition,
// operational contexts, imported evidence or verification stimuli.
export const REQUIREMENT_TEXT_GUIDANCE = `Requirement text policy: generated software requirements, controller safety constraints and safety goals must not contain metrics, quality/confidence scores, percentages or numerical limits/targets. Do not spell a numeric target out in words to evade this rule: use 'inhibit positive motion' or 'source-defined stopped output', not 'zero speed target'. Reference an existing source parameter by its exact name instead of repeating its value. If the source uses a literal without a parameter name, reference the source-defined predicate/state transition by its function name and describe the required behavior qualitatively; do not invent a parameter. Keep source values unchanged in evidence, scenario conditions and verification test inputs/expected results. Do not invent a deadline, dwell, tolerance, confidence level or performance budget, even as a proposed/validated/configured future parameter. Place missing quantitative design information in assumptions/rationale, not as an invented metric in a requirement. This explicit output policy takes precedence over organization examples asking for metrics. Requirements must still identify the responsible software, triggering state/event, required behavior and observable result.`;

export function requirementTextIssues(row,source={}) {
  const errors=[];
  const fields={softwareRequirement:'Software Safety Requirement',safetyConstraint:'Safety Constraint',safetyGoal:'Safety Goal'};
  for(const [field,label] of Object.entries(fields)) {
    const value=row[field];if(typeof value!=='string')continue;
    // Existing analyst-authored text is governed input, not newly generated text.
    if(source.reviewedValues?.[label]===value)continue;
    const numeric=/(?:^|[^\p{L}\p{N}_])[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u;
    if(numeric.test(value))errors.push(`${field}: generated requirement text must not contain numeric values or limits; reference the exact source parameter or source-defined predicate and keep values in verification/evidence.`);
    if(/\bzero\b/i.test(value))errors.push(`${field}: describe the inhibited/stopped state qualitatively rather than repeating a numeric target in words.`);
    if(/\b(?:(?:proposed|validated|configured|defined)\s+(?:[\w-]+\s+){0,3}(?:deadline|latency|tolerance|timing budget)|(?:deadline|latency|tolerance)\s+(?:configuration\s+)?parameter)\b/i.test(value))errors.push(`${field}: remove the invented metric parameter; use an existing source identifier or a qualitative source predicate and put missing design evidence in assumptions.`);
    if(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\s*(?:milliseconds?|microseconds?|seconds?|minutes?|hours?|cycles?|metres?|meters?|m\/s|percent|%)\b/i.test(value))errors.push(`${field}: do not spell numerical limits out as words; use the source parameter or qualitative predicate.`);
    if(/\b(?:quality score|confidence score|evaluation score|benchmark score|percentage|percentile|accuracy target|uptime target|throughput target|error[- ]rate target)\b/i.test(value))errors.push(`${field}: remove evaluation metrics or invented metric targets from generated requirement text.`);
  }
  return errors;
}
