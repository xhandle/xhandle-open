// Eval fixture: autonomous transport vehicle autonomy stack.
//
// Interfaces come from the project's real functional decomposition
// (functional_decomposition_2026-09-09.csv). The operational context is the one
// the project actually runs with, reproduced verbatim below — an earlier draft
// of this fixture used three contexts I invented, and most of its
// non-applicable labels turned out to rest on architecture facts that context
// does not state. Those items were removed rather than relabelled by guess; see
// UNSUPPORTED_ITEMS at the bottom of this file for what they were and what the
// context would have to say to restore them.
//
// Sampled, not expanded: 25 interfaces x 7 guide phrases would be 175 unlabelled
// rows. These interfaces span the archetypes where classification is hardest —
// authority path, safety-critical feedback, advisory input to a safety decision,
// continuously refreshed state, external reporting, and external authority.
//
// Reviewed and approved 2026-09-09 by the project safety engineer (20 years'
// experience), covering the operational context and all expected values, with
// two subsequent changes:
//   - FD-15 corrected from non-applicable to applicable (engineer-confirmed).
//   - FD-19 added to restore a non-applicable case; PENDING CONFIRMATION.
// Single-rater: a second qualified reviewer with recorded inter-rater agreement
// is still needed before these scores are treated as calibration evidence.

const OPERATIONAL_SCENARIO = "Vehicle departs staging area and merges into active urban traffic to begin an assigned mission route";
const OPERATIONAL_MODE = "mission execution";
const OPERATING_CONDITIONS = "Daytime or nighttime urban roadway, mixed traffic including pedestrians and cyclists, intersections, nominal sensor/compute/comms availability";
const CONTEXT_ASSUMPTIONS = "ODD includes public urban roads; ODD boundaries, ODD entry checks, and traffic interaction rules are TBD pending project confirmation; ride is autonomous with no in-vehicle safety operator unless specified";

const OPERATIONAL_CONTEXT = `
Operational scenario: ${OPERATIONAL_SCENARIO}
Operational mode: ${OPERATIONAL_MODE}
Operating conditions: ${OPERATING_CONDITIONS}
Assumptions: ${CONTEXT_ASSUMPTIONS}
`.trim();

const CTX = {
  operationalContextId: "CTX-1",
  operationalScenario: OPERATIONAL_SCENARIO,
  operationalMode: OPERATIONAL_MODE,
  operatingConditions: OPERATING_CONDITIONS,
  contextAssumptions: CONTEXT_ASSUMPTIONS,
};

const CANONICAL_HAZARDS = [
  { id: "H-AV-1", title: "Vehicle fails to execute a required control action, resulting in collision with a road user" },
  { id: "H-AV-2", title: "Vehicle executes unintended or unsafe motion in traffic" },
  { id: "H-AV-3", title: "Vehicle continues autonomous operation outside its validated capability" },
];

// Interface descriptions are taken from the decomposition CSV rather than
// invented, so every field the pipeline may quote as evidence is real.
const actuationCommand = {
  subsystem: "Command Generation & Vehicle Control Interface",
  from: "Actuation Command Transmission",
  fromDetails: "Sends the validated control command to the vehicle actuation interface.",
  controlAction: "Actuation Command",
  controlActionDetails: "Discrete steer/throttle/brake command with sequence ID.",
  to: "Vehicle Platform (External)",
  toDetails: "Vehicle actuators execute commanded steering, propulsion, and braking.",
  ...CTX,
};

const actuationFeedback = {
  subsystem: "Command Generation & Vehicle Control Interface",
  from: "Actuator Response Reporting",
  fromDetails: "Vehicle reports actual actuator state and command acceptance.",
  controlAction: "Actuation Status Feedback",
  controlActionDetails: "Command acceptance/rejection, achieved actuator position, fault flags.",
  to: "Actuation Command Transmission",
  toDetails: "Command Generation confirms execution and detects actuation faults.",
  ...CTX,
};

const riskAssessment = {
  subsystem: "Prediction & Situation Assessment",
  from: "Situational Risk Assessment",
  fromDetails: "Evaluates hazard likelihood and severity of the current situation.",
  controlAction: "Situation Risk Assessment",
  controlActionDetails: "Identified conflicts, risk level, recommended constraints.",
  to: "Behavior Decision Making",
  toDetails: "Behavior & Motion Planning selects a maneuver considering assessed risk.",
  ...CTX,
};

const dynamicState = {
  subsystem: "Localization & State Estimation",
  from: "Vehicle State Estimation",
  fromDetails: "Estimates vehicle velocity, acceleration, and yaw rate.",
  controlAction: "Vehicle Dynamic State",
  controlActionDetails: "Speed, heading rate, acceleration with confidence.",
  to: "Trajectory Generation",
  toDetails: "Behavior & Motion Planning uses current dynamic state as the trajectory's initial condition.",
  ...CTX,
};

const missionStatus = {
  subsystem: "Mission & Task Management",
  from: "Task Sequencing",
  fromDetails: "Tracks mission progress and completion.",
  controlAction: "Mission Status Report",
  controlActionDetails: "Progress, completed segments, ETA, exceptions.",
  to: "Fleet/Remote Operations System (External)",
  toDetails: "Fleet system receives mission progress for tracking/dispatch decisions.",
  ...CTX,
};

const missionGoal = {
  subsystem: "Fleet/Remote Operations System (External)",
  from: "Mission Assignment",
  fromDetails: "Operator/fleet system assigns a transport mission with destination and constraints.",
  controlAction: "Mission Goal Command",
  controlActionDetails: "Destination, priority, operational constraints, full-autonomy authorization.",
  to: "Mission Goal Interpretation",
  toDetails: "Mission & Task Management parses the command into an internal goal representation.",
  ...CTX,
};

function item(id, base, guidePhrase, expected) {
  return { id, ...base, guidePhrase, expected };
}

export const autonomyStackFixture = {
  fixtureId: "autonomy-stack-001",
  domain: "autonomous-transport",
  labelStatus: "approved",
  operationalContext: OPERATIONAL_CONTEXT,
  organizationContext: "",
  canonicalHazards: CANONICAL_HAZARDS,
  items: [
    // --- Authority path: sole route from autonomy to the actuators ---
    item("FD-1", actuationCommand, "Not providing the control action causes a hazard", {
      applicable: "yes",
      rationale: "The actuation command is the only path from the autonomy to the vehicle actuators; its absence leaves the vehicle without commanded steering or braking while merging into urban traffic.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-1",
      forbiddenRequirementClaims: [],
    }),
    item("FD-2", actuationCommand, "Providing the control action causes a hazard", {
      applicable: "yes",
      rationale: "An incorrect or out-of-range steer, throttle, or brake value is executed directly by the actuators, producing unintended motion among pedestrians and cyclists.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-2",
      forbiddenRequirementClaims: [],
    }),
    item("FD-3", actuationCommand, "The control action is provided too late", {
      applicable: "yes",
      rationale: "Merging and intersection negotiation bound the control cycle; a late command leaves the vehicle tracking a stale target through a changing scene.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-1",
      forbiddenRequirementClaims: [],
    }),
    // The command carries a sequence ID, but no supplied context states that the
    // platform rejects an out-of-order one. Without a stated containment
    // mechanism there is no basis to decline this deviation.
    item("FD-4", actuationCommand, "The control action is provided in the wrong order", {
      applicable: "yes",
      rationale: "The command carries a sequence ID but no supplied context establishes that out-of-order commands are rejected, so a superseded steer or brake value can be actuated after a newer one.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-2",
      forbiddenRequirementClaims: [],
    }),
    item("FD-5", actuationCommand, "The control action is applied too long", {
      applicable: "yes",
      rationale: "A held steer or brake value continues to be actuated past the conditions it was computed for, producing motion inconsistent with the current scene.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-2",
      forbiddenRequirementClaims: [],
    }),

    // --- Safety-critical feedback: the stated actuation fault detection path ---
    item("FD-6", actuationFeedback, "Not providing the control action causes a hazard", {
      applicable: "yes",
      rationale: "This interface is where Command Generation confirms execution and detects actuation faults; without it a rejected or unachieved command goes undetected in traffic.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-1",
      forbiddenRequirementClaims: [],
    }),
    item("FD-7", actuationFeedback, "Providing the control action causes a hazard", {
      applicable: "yes",
      rationale: "Feedback reporting acceptance or an achieved position the actuator did not reach masks a real actuation fault from the function responsible for detecting it.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-1",
      forbiddenRequirementClaims: [],
    }),
    item("FD-8", actuationFeedback, "The control action is provided too late", {
      applicable: "yes",
      rationale: "Fault detection is bounded by the control cycle; feedback arriving after the next command lets the autonomy commit further commands on an unconfirmed actuator state.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-1",
      forbiddenRequirementClaims: [],
    }),
    item("FD-9", actuationFeedback, "The control action is stopped too soon", {
      applicable: "yes",
      rationale: "Cessation mid-manoeuvre removes actuation fault detection while the vehicle is executing a commanded trajectory in mixed traffic.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-1",
      forbiddenRequirementClaims: [],
    }),

    // --- Advisory input a safety decision consumes ---
    item("FD-10", riskAssessment, "Not providing the control action causes a hazard", {
      applicable: "yes",
      rationale: "Behavior Decision Making selects manoeuvres considering assessed risk; without the assessment, manoeuvre selection at urban intersections proceeds without identified conflicts.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-1",
      forbiddenRequirementClaims: [],
    }),
    item("FD-11", riskAssessment, "The control action is provided too late", {
      applicable: "yes",
      rationale: "The assessment is consumed at a manoeuvre decision point; arriving after it means the manoeuvre is selected without the current conflict set among pedestrians and cyclists.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-1",
      forbiddenRequirementClaims: [],
    }),
    item("FD-12", riskAssessment, "The control action is applied too long", {
      applicable: "yes",
      rationale: "A risk assessment retained past its validity keeps the planner acting on a conflict set that no longer describes the intersection.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-1",
      forbiddenRequirementClaims: [],
    }),

    // --- Continuously refreshed state vector ---
    item("FD-13", dynamicState, "The control action is applied too long", {
      applicable: "yes",
      rationale: "A stale dynamic state used as the trajectory initial condition produces a trajectory computed from a speed and yaw rate the vehicle no longer has.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-2",
      forbiddenRequirementClaims: [],
    }),
    item("FD-14", dynamicState, "The control action is stopped too soon", {
      applicable: "yes",
      rationale: "Cessation of the state stream leaves trajectory generation without a current initial condition while the vehicle is in motion in traffic.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-1",
      forbiddenRequirementClaims: [],
    }),
    // Corrected 2026-09-09. This was labelled non-applicable on the reasoning
    // that each estimate supersedes the previous one. That conflates generation
    // order with delivery order: absent sequence enforcement, an older sample
    // can arrive after a newer one and overwrite it, and the planner then pairs
    // a stale dynamic state with a current pose.
    item("FD-15", dynamicState, "The control action is provided in the wrong order", {
      applicable: "yes",
      rationale: "No supplied context establishes sequence or timestamp enforcement on this interface, so a superseded state sample can be delivered after a newer one and become the trajectory's initial condition.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-2",
      forbiddenRequirementClaims: [],
    }),

    // --- External reporting: the over-classification anchor ---
    item("FD-16", missionStatus, "Not providing the control action causes a hazard", {
      applicable: "yes",
      rationale: "Loss of the status report degrades fleet tracking and dispatch accuracy; its stated consumer is fleet dispatch, and no vehicle control or protective function receives it.",
      safetySignificant: "no",
      canonicalHazardId: null,
      forbiddenRequirementClaims: [],
    }),
    item("FD-17", missionStatus, "The control action is provided too late", {
      applicable: "yes",
      rationale: "A late progress update makes fleet ETA and dispatch decisions stale; no vehicle function holds a deadline on it.",
      safetySignificant: "no",
      canonicalHazardId: null,
      forbiddenRequirementClaims: [],
    }),

    // --- External authority admitting the vehicle to autonomous operation ---
    item("FD-18", missionGoal, "Providing the control action causes a hazard", {
      applicable: "yes",
      rationale: "The command carries full-autonomy authorization and operational constraints; an incorrect destination or authorization admits the vehicle to autonomous urban operation whose ODD boundaries are still TBD.",
      safetySignificant: "yes",
      canonicalHazardId: "H-AV-3",
      forbiddenRequirementClaims: [],
    }),

    // PENDING ENGINEER CONFIRMATION — added after the 2026-09-09 review.
    // Correcting FD-15 left the corpus with no non-applicable item, which makes
    // over-application unmeasurable. This reasoning is the pipeline's own from
    // the 2026-09-09 run, and it rests on the supplied scenario rather than on
    // an operational context this fixture does not carry.
    item("FD-19", missionGoal, "Not providing the control action causes a hazard", {
      applicable: "no",
      rationale: "The scenario states the vehicle has already departed staging under an assigned mission, which presupposes the goal command was provided and parsed. Absent the command the vehicle remains staged and never enters traffic, so no adverse state arises during the described maneuver.",
      safetySignificant: null,
      canonicalHazardId: null,
      forbiddenRequirementClaims: [],
    }),
  ],
};

/**
 * Items removed when the real operational context replaced the invented one,
 * with the context each would need in order to be labelled defensibly.
 *
 * These are not dead notes: they are the concrete gap between what the project's
 * operational context states and what a reviewer needs in order to decline a
 * deviation. Restore them by adding the context, not by relaxing the label.
 */
export const UNSUPPORTED_ITEMS = [
  {
    interface: "Minimum-Risk Maneuver Command (Arbitration → Trajectory Generation)",
    guidePhrases: ["Not providing", "Providing causes", "Too late"],
    blockedBy: "The supplied context states nominal sensor/compute/comms availability, so a fault that would trigger a minimum-risk manoeuvre is not established by it. Analysing this interface needs a degraded or fault-active operational context.",
  },
  {
    interface: "Autonomy Fault/Degradation Report (Arbitration → Fleet/Remote Operations)",
    guidePhrases: ["Not providing", "Too late"],
    blockedBy: "Labelling this mission-only depends on the vehicle being required to reach a minimum-risk condition without any remote response. The supplied context does not say the minimum-risk path is local and comms-independent, so neither a reviewer nor the pipeline can ground a decline.",
  },
  {
    interface: "Mission Goal Command (Fleet → Mission Goal Interpretation), omission and lateness",
    guidePhrases: ["Not providing", "Too late"],
    blockedBy: "Declining these depends on an idle or staging-area holding context in which the vehicle is stationary and no person is exposed to its motion. The supplied context covers departure and merging, not holding.",
  },
  {
    interface: "Actuation Command, wrong order",
    guidePhrases: ["Wrong order"],
    blockedBy: "Declining depends on the vehicle platform rejecting commands with a superseded sequence ID. The decomposition states the sequence ID exists but not that stale commands are rejected. Currently labelled applicable for that reason.",
  },
];

export default autonomyStackFixture;
