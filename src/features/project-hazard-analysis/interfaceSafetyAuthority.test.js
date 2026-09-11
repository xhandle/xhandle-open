import {
  RECEIVER_AUTHORITY,
  authorityPermitsSafety,
  buildAuthorityOverrides,
  classifyReceiverAuthority,
  summarizeInterfaceAuthorities,
} from "./interfaceSafetyAuthority";

// Interfaces taken verbatim from the project's autonomy-stack decomposition.
const actuationCommand = {
  from: "Actuation Command Transmission",
  controlAction: "Actuation Command",
  controlActionDetails: "Discrete steer/throttle/brake command with sequence ID.",
  to: "Vehicle Platform (External)",
  toDetails: "Vehicle actuators execute commanded steering, propulsion, and braking.",
};

const faultReport = {
  from: "Minimum-Risk Maneuver Arbitration",
  controlAction: "Autonomy Fault/Degradation Report",
  controlActionDetails: "Fault cause, triggered response, vehicle state.",
  to: "Fleet/Remote Operations System (External)",
  toDetails: "Remote operations receives the fault alert and vehicle status for awareness/intervention.",
};

const missionStatus = {
  from: "Task Sequencing",
  controlAction: "Mission Status Report",
  controlActionDetails: "Progress, completed segments, ETA, exceptions.",
  to: "Fleet/Remote Operations System (External)",
  toDetails: "Fleet system receives mission progress for tracking/dispatch decisions.",
};

const riskAssessment = {
  from: "Situational Risk Assessment",
  controlAction: "Situation Risk Assessment",
  controlActionDetails: "Identified conflicts, risk level, recommended constraints.",
  to: "Behavior Decision Making",
  toDetails: "Behavior & Motion Planning selects a maneuver considering assessed risk.",
};

const mrmCommand = {
  from: "Minimum-Risk Maneuver Arbitration",
  controlAction: "Minimum-Risk Maneuver Command",
  controlActionDetails: "Override trajectory/command directive, for example a controlled stop.",
  to: "Trajectory Generation",
  toDetails: "Behavior & Motion Planning overrides the normal trajectory with a minimum-risk trajectory.",
};

describe("receiver authority classification", () => {
  test("treats a receiver that executes physical actuation as actuation authority", () => {
    expect(classifyReceiverAuthority(actuationCommand).authority).toBe(RECEIVER_AUTHORITY.ACTUATION);
    expect(authorityPermitsSafety(RECEIVER_AUTHORITY.ACTUATION)).toBe(true);
  });

  test("places the protective override path in protective authority", () => {
    expect(classifyReceiverAuthority(mrmCommand).authority).toBe(RECEIVER_AUTHORITY.PROTECTIVE);
  });

  // The case the per-row causal gate cannot see: everything about this row reads
  // as safety-critical except the one thing that matters, which is that the
  // receiver cannot act on it in real time.
  test("classifies a fault report to an external fleet system as advisory-external", () => {
    const result = classifyReceiverAuthority(faultReport);
    expect(result.authority).toBe(RECEIVER_AUTHORITY.ADVISORY_EXTERNAL);
    expect(authorityPermitsSafety(result.authority)).toBe(false);
    expect(result.basis).toMatch(/no real-time actuation or protective authority/);
  });

  test("classifies a mission status record to an external fleet system as reporting-only", () => {
    const result = classifyReceiverAuthority(missionStatus);
    expect(result.authority).toBe(RECEIVER_AUTHORITY.REPORTING_ONLY);
    expect(authorityPermitsSafety(result.authority)).toBe(false);
  });

  test("defaults an unrecognised receiver to control-loop so Safety stays available", () => {
    const result = classifyReceiverAuthority(riskAssessment);
    expect(result.authority).toBe(RECEIVER_AUTHORITY.CONTROL_LOOP);
    // Under-classifying a real hazard is the worse error, so ambiguity must
    // resolve toward permitting Safety.
    expect(authorityPermitsSafety(result.authority)).toBe(true);
  });

  test("never demotes an internal control-path receiver, however it is worded", () => {
    const internalReport = {
      from: "Autonomy Health Monitoring",
      controlAction: "Autonomy Health Status",
      controlActionDetails: "Per-subsystem health/fault indication, degraded-confidence flags.",
      to: "Behavior Decision Making",
      toDetails: "Behavior planning constrains available maneuvers based on health status.",
    };
    expect(authorityPermitsSafety(classifyReceiverAuthority(internalReport).authority)).toBe(true);
  });

  test("lets an engineer override the heuristic", () => {
    const overrides = buildAuthorityOverrides([
      { ...missionStatus, authority: RECEIVER_AUTHORITY.CONTROL_LOOP },
    ]);
    const result = classifyReceiverAuthority(missionStatus, overrides);
    expect(result.authority).toBe(RECEIVER_AUTHORITY.CONTROL_LOOP);
    expect(result.overridden).toBe(true);
    expect(authorityPermitsSafety(result.authority)).toBe(true);
  });
});

describe("authority summary", () => {
  test("reports the off-path interfaces for review", () => {
    const items = [actuationCommand, mrmCommand, riskAssessment, faultReport, missionStatus];
    const summary = summarizeInterfaceAuthorities(items);
    expect(summary.interfaces).toHaveLength(5);
    expect(summary.offPathInterfaces.map((entry) => entry.item.controlAction)).toEqual([
      "Autonomy Fault/Degradation Report",
      "Mission Status Report",
    ]);
    expect(summary.counts[RECEIVER_AUTHORITY.ACTUATION]).toBe(1);
  });

  test("counts repeated guide-phrase rows once per interface", () => {
    const summary = summarizeInterfaceAuthorities([faultReport, faultReport, faultReport]);
    expect(summary.interfaces).toHaveLength(1);
    expect(summary.interfaces[0].rowCount).toBe(3);
  });
});
