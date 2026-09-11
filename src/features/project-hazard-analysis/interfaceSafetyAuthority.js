// Per-interface safety authority classification.
//
// Safety significance is largely a property of the receiving function's role in
// the architecture, not of the guide phrase applied to it. Asking a model
// per-row "is this a direct safety control or safety-critical feedback?" gets
// "yes" for almost every interface in an autonomy stack, because almost
// everything feeds the driving task. The property that actually separates a
// brake command from a status report sent to a fleet dashboard is whether the
// receiver holds real-time actuation or protective authority — and that is
// knowable once per interface from the decomposition.
//
// Direction of caution: this classifier can only ever DEMOTE a row out of
// Safety, and only on positive evidence that the receiver sits outside the
// authority path. Anything uncertain stays CONTROL_LOOP, which permits Safety.
// Under-classifying a real hazard is the worse error, so ambiguity resolves
// toward Safety, and every demotion records its reason for engineer review.

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalized = (value) => text(value).toLowerCase();

export const RECEIVER_AUTHORITY = {
  ACTUATION: "actuation",
  PROTECTIVE: "protective",
  CONTROL_LOOP: "control-loop",
  ADVISORY_EXTERNAL: "advisory-external",
  REPORTING_ONLY: "reporting-only",
};

// Authorities whose receiver can hold a real-time safety role. A row whose
// receiver is outside this set cannot reach an exposed entity through this
// interface, however the row's prose is worded.
export const SAFETY_CAPABLE_AUTHORITIES = new Set([
  RECEIVER_AUTHORITY.ACTUATION,
  RECEIVER_AUTHORITY.PROTECTIVE,
  RECEIVER_AUTHORITY.CONTROL_LOOP,
]);

export function authorityPermitsSafety(authority) {
  return SAFETY_CAPABLE_AUTHORITIES.has(authority);
}

const EXTERNAL_RECEIVER = /\(external\)|\bexternal\b/i;
// Receivers that consume records rather than act on them in real time.
const OFF_PATH_RECEIVER = /\b(?:fleet|remote operation|remote ops|dispatch|telemetry|maintenance log|log service|logging|analytics|reporting service|back ?office|workshop)\b/i;
// Control actions whose purpose is to inform a human or record a state.
const REPORT_ACTION = /\b(?:report|status|notification|alert|record|log|progress|advisory)\b/i;
// Reports concerning faults or degradation read as safety-adjacent but are
// still off-path when their receiver holds no real-time authority.
const FAULT_FLAVOURED = /\b(?:fault|degradation|error|failure|health|anomaly)\b/i;
const ACTUATOR_RECEIVER = /\b(?:actuator|actuation|vehicle platform|plant|motor|valve|brake|steering|propulsion)\b/i;
const COMMAND_ACTION = /\b(?:command|actuation|request|setpoint|directive|demand)\b/i;
const PROTECTIVE_RECEIVER = /\b(?:minimum-risk|minimum risk|safety monitor|fault management|arbitration|protective|safe state|emergency)\b/i;
const PROTECTIVE_ACTION = /\b(?:minimum-risk|minimum risk|fault detection|protective|safe stop|override|inhibit)\b/i;

/**
 * Classifies the receiving end of one interface.
 *
 * `overrides` maps a "From|Control Action|To" key (case-insensitive) to an
 * explicit authority, for the cases an engineer judges differently from the
 * heuristic. The override always wins — the heuristic is a starting point for
 * review, not an authority in its own right.
 */
export function classifyReceiverAuthority(item = {}, overrides = {}) {
  const from = text(item.from);
  const controlAction = text(item.controlAction);
  const to = text(item.to);
  const key = `${from}|${controlAction}|${to}`.toLowerCase();
  const override = overrides[key] || overrides[normalized(to)];
  if (override) {
    return { authority: override, basis: "engineer override", overridden: true };
  }

  const receiver = `${to} ${text(item.toDetails)}`;
  const action = `${controlAction} ${text(item.controlActionDetails)}`;

  // Off-path first: an external receiver that consumes reports has no real-time
  // authority even when the report concerns a fault.
  const externalReceiver = EXTERNAL_RECEIVER.test(to) || OFF_PATH_RECEIVER.test(to);
  if (externalReceiver && OFF_PATH_RECEIVER.test(receiver) && REPORT_ACTION.test(action)) {
    return {
      authority: FAULT_FLAVOURED.test(action)
        ? RECEIVER_AUTHORITY.ADVISORY_EXTERNAL
        : RECEIVER_AUTHORITY.REPORTING_ONLY,
      basis: `Receiver "${to}" consumes ${FAULT_FLAVOURED.test(action) ? "an advisory fault report" : "a status record"} and holds no real-time actuation or protective authority.`,
      overridden: false,
    };
  }

  if (ACTUATOR_RECEIVER.test(receiver) && COMMAND_ACTION.test(action)) {
    return {
      authority: RECEIVER_AUTHORITY.ACTUATION,
      basis: `Receiver "${to}" executes commanded physical actuation.`,
      overridden: false,
    };
  }

  if (PROTECTIVE_RECEIVER.test(receiver) || PROTECTIVE_ACTION.test(action)) {
    return {
      authority: RECEIVER_AUTHORITY.PROTECTIVE,
      basis: `Receiver "${to}" participates in the fault-detection or protective-response path.`,
      overridden: false,
    };
  }

  // Default. Everything not positively identified as off-path keeps its ability
  // to be classified Safety.
  return {
    authority: RECEIVER_AUTHORITY.CONTROL_LOOP,
    basis: `Receiver "${to}" is treated as part of the control path; no evidence places it outside real-time authority.`,
    overridden: false,
  };
}

export function buildAuthorityOverrides(entries = []) {
  return (Array.isArray(entries) ? entries : []).reduce((map, entry) => {
    const key = `${text(entry?.from)}|${text(entry?.controlAction)}|${text(entry?.to)}`.toLowerCase();
    if (entry?.authority) map[key] = entry.authority;
    return map;
  }, {});
}

/**
 * Summarises the authority mix across a decomposition. Used to review the
 * classification before trusting it: a stack where nothing is off-path, or
 * where most things are, is a signal the heuristic needs overrides.
 */
export function summarizeInterfaceAuthorities(items = [], overrides = {}) {
  const byInterface = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = `${text(item?.from)}|${text(item?.controlAction)}|${text(item?.to)}`;
    if (!byInterface.has(key)) {
      byInterface.set(key, { key, item, ...classifyReceiverAuthority(item, overrides), rowCount: 0 });
    }
    byInterface.get(key).rowCount += 1;
  });
  const interfaces = Array.from(byInterface.values());
  const counts = interfaces.reduce((totals, entry) => ({
    ...totals,
    [entry.authority]: (totals[entry.authority] || 0) + 1,
  }), {});
  return {
    interfaces,
    counts,
    offPathInterfaces: interfaces.filter((entry) => !authorityPermitsSafety(entry.authority)),
  };
}
