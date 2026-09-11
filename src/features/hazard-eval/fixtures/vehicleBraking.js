// Seed eval fixture: service brake control, highway deceleration.
//
// Reviewed and approved 2026-09-09. FD-10 was corrected during review: it had
// been labelled mission-only while FD-8 reached the same open-loop pressure
// state and was labelled safety-significant. FD-15 and FD-16 were added so the
// corpus keeps a legitimate applicable-but-mission-only case after that fix.

const OPERATIONAL_CONTEXT = `
System: passenger vehicle service brake control.
Scenario CTX-1 — Highway deceleration: vehicle in motion at 90-120 km/h on a dry
sealed surface, driver-commanded deceleration, all subsystems nominal and
powered. The brake controller is the sole authority for service brake pressure.
Scenario CTX-2 — Stationary hold: vehicle at zero speed on a graded surface,
transmission in park, driver present.

Architecture assumptions:
- On loss of controller power the brake actuator reverts to its mechanically
  applied fail-safe position with no controller command required.
- The wheel speed estimate is advisory to the antilock function only; it is not
  in the pressure-command authority path.
- Driver mechanical brake pedal linkage remains available independently of the
  controller in every scenario.
- The brake system is required to remain safe without the maintenance status
  report. The report is not in any control, protective, or driver-facing path.
`.trim();

const CANONICAL_HAZARDS = [
  { id: "H-BRK-1", title: "Vehicle fails to decelerate when deceleration is commanded" },
  { id: "H-BRK-2", title: "Vehicle decelerates when deceleration is not commanded" },
  { id: "H-BRK-3", title: "Wheel lockup causes loss of directional control" },
];

const commandInterface = {
  from: "Brake Controller",
  fromDetails: "Computes and issues service brake pressure commands; sole pressure authority.",
  controlAction: "Brake pressure command",
  controlActionDetails: "Commanded hydraulic pressure setpoint issued at 100 Hz to the brake actuator.",
  to: "Brake Actuator",
  toDetails: "Applies hydraulic pressure to the friction brakes; reverts to mechanically applied fail-safe position on power loss.",
  operationalContextId: "CTX-1",
  operationalScenario: "Highway deceleration",
  operationalMode: "Normal braking",
  operatingConditions: "90-120 km/h, dry sealed surface, all subsystems nominal and powered",
  contextAssumptions: "On loss of controller power the brake actuator reverts to its mechanically applied fail-safe position with no controller command required. Driver mechanical pedal linkage remains available.",
};

const feedbackInterface = {
  from: "Wheel Speed Sensor",
  fromDetails: "Measures per-wheel rotational speed; advisory to the antilock function only.",
  controlAction: "Wheel speed estimate",
  controlActionDetails: "Per-wheel speed estimate published at 100 Hz; not in the pressure-command authority path.",
  to: "Brake Controller",
  toDetails: "Consumes wheel speed for antilock modulation; falls back to open-loop pressure control when the estimate is unavailable.",
  operationalContextId: "CTX-1",
  operationalScenario: "Highway deceleration",
  operationalMode: "Normal braking",
  operatingConditions: "90-120 km/h, dry sealed surface, all subsystems nominal and powered",
  contextAssumptions: "The wheel speed estimate is advisory to the antilock function only; it is not in the pressure-command authority path.",
};

// A real interface with no path to an exposed entity. The corpus needs at least
// one of these: with only safety-significant rows, the over-classification
// metric has nothing to detect, because there is nothing to over-classify.
const diagnosticInterface = {
  from: "Brake Controller",
  fromDetails: "Publishes accumulated fault counters and actuator health for maintenance.",
  controlAction: "Brake system status report",
  controlActionDetails: "Periodic maintenance status record; not consumed by any control, protective, or driver-facing function.",
  to: "Maintenance Log Service",
  toDetails: "Stores status records for workshop diagnosis; has no actuation or advisory authority.",
  operationalContextId: "CTX-1",
  operationalScenario: "Highway deceleration",
  operationalMode: "Normal braking",
  operatingConditions: "90-120 km/h, dry sealed surface, all subsystems nominal and powered",
  contextAssumptions: "The brake system is required to remain safe without the maintenance status report. The report is not in any control, protective, or driver-facing path.",
};

function item(id, base, guidePhrase, expected) {
  return { id, ...base, guidePhrase, expected };
}

export const vehicleBrakingFixture = {
  fixtureId: "vehicle-braking-001",
  domain: "vehicle-braking",
  labelStatus: "approved",
  operationalContext: OPERATIONAL_CONTEXT,
  organizationContext: "",
  canonicalHazards: CANONICAL_HAZARDS,
  items: [
    item("FD-1", commandInterface, "Not providing the control action causes a hazard", {
      applicable: "yes",
      rationale: "The controller is the sole pressure authority in CTX-1; absence of the command leaves the vehicle without commanded service braking at highway speed.",
      safetySignificant: "yes",
      canonicalHazardId: "H-BRK-1",
      forbiddenRequirementClaims: [],
    }),
    item("FD-2", commandInterface, "Providing the control action causes a hazard", {
      applicable: "yes",
      rationale: "Unrequested pressure at 90-120 km/h produces uncommanded deceleration with following-traffic exposure.",
      safetySignificant: "yes",
      canonicalHazardId: "H-BRK-2",
      forbiddenRequirementClaims: [],
    }),
    item("FD-3", commandInterface, "The control action is provided too late", {
      applicable: "yes",
      rationale: "Stopping distance at highway speed is bounded by the deceleration onset point; a late command extends it into the exposure envelope.",
      safetySignificant: "yes",
      canonicalHazardId: "H-BRK-1",
      forbiddenRequirementClaims: [],
    }),
    item("FD-4", commandInterface, "The control action is provided too early", {
      applicable: "yes",
      rationale: "Pressure applied before the driver's deceleration request is a form of uncommanded deceleration.",
      safetySignificant: "yes",
      canonicalHazardId: "H-BRK-2",
      forbiddenRequirementClaims: [],
    }),
    item("FD-5", commandInterface, "The control action is stopped too soon", {
      applicable: "yes",
      rationale: "Releasing pressure before the deceleration target is reached leaves the vehicle short of the required speed reduction.",
      safetySignificant: "yes",
      canonicalHazardId: "H-BRK-1",
      forbiddenRequirementClaims: [],
    }),
    item("FD-6", commandInterface, "The control action is applied too long", {
      applicable: "yes",
      rationale: "Sustained pressure past the driver's release is uncommanded deceleration and can induce wheel lockup.",
      safetySignificant: "yes",
      canonicalHazardId: "H-BRK-3",
      forbiddenRequirementClaims: [],
    }),
    // Ordering has no meaning for a continuously-issued scalar setpoint with no
    // prerequisite sequence. This is the classic case the pipeline should
    // decline, and historically does not.
    item("FD-7", commandInterface, "The control action is provided in the wrong order", {
      applicable: "no",
      rationale: "The pressure command is a continuously refreshed scalar setpoint with no prerequisite ordering relationship; there is no sequence for it to violate.",
      safetySignificant: null,
      canonicalHazardId: null,
      forbiddenRequirementClaims: [],
    }),
    item("FD-8", feedbackInterface, "Not providing the control action causes a hazard", {
      applicable: "yes",
      rationale: "Loss of the estimate disables antilock modulation; the controller falls back to open-loop pressure, which permits lockup on a low-friction patch.",
      safetySignificant: "yes",
      canonicalHazardId: "H-BRK-3",
      forbiddenRequirementClaims: [],
    }),
    item("FD-9", feedbackInterface, "The control action is provided too late", {
      applicable: "yes",
      rationale: "A stale estimate past the antilock decision point produces modulation against a wheel state that no longer holds.",
      safetySignificant: "yes",
      canonicalHazardId: "H-BRK-3",
      forbiddenRequirementClaims: [],
    }),
    // Reaches the same open-loop pressure state as FD-8, so it carries the same
    // classification. Cessation mid-stop is if anything the worse case: antilock
    // modulation is lost while the vehicle is already braking at highway speed.
    item("FD-10", feedbackInterface, "The control action is stopped too soon", {
      applicable: "yes",
      rationale: "Cessation mid-stop reverts the controller to open-loop pressure while braking is already underway, permitting lockup on a low-friction patch.",
      safetySignificant: "yes",
      canonicalHazardId: "H-BRK-3",
      forbiddenRequirementClaims: [],
    }),
    item("FD-11", feedbackInterface, "Providing the control action causes a hazard", {
      applicable: "no",
      rationale: "The estimate is published unconditionally at a fixed rate and is advisory only; its presence cannot itself create an adverse controller state.",
      safetySignificant: null,
      canonicalHazardId: null,
      forbiddenRequirementClaims: [],
    }),
    item("FD-12", feedbackInterface, "The control action is applied too long", {
      applicable: "no",
      rationale: "A speed estimate has no application duration; it is superseded by the next 100 Hz sample rather than remaining applied.",
      safetySignificant: null,
      canonicalHazardId: null,
      forbiddenRequirementClaims: [],
    }),
    // Power-loss context: any requirement demanding a controller command on
    // power loss contradicts the stated passive fail-safe assumption.
    item("FD-13", {
      ...commandInterface,
      operationalContextId: "CTX-3",
      operationalScenario: "Controller power loss during deceleration",
      operationalMode: "Degraded",
      operatingConditions: "90-120 km/h, controller supply voltage lost mid-stop",
      contextAssumptions: "On loss of controller power the brake actuator reverts to its mechanically applied fail-safe position with no controller command required.",
    }, "Not providing the control action causes a hazard", {
      applicable: "no",
      rationale: "The actuator's mechanically applied fail-safe position is reached without any controller command, so absence of the command in this context does not remove braking.",
      safetySignificant: null,
      canonicalHazardId: null,
      forbiddenRequirementClaims: [
        "shall command brake application on power loss",
        "shall transmit a brake pressure command when power is lost",
        "shall maintain communication with the brake actuator during power loss",
      ],
    }),
    item("FD-14", {
      ...commandInterface,
      operationalContextId: "CTX-2",
      operationalScenario: "Stationary hold",
      operationalMode: "Park",
      operatingConditions: "Zero speed, graded surface, transmission in park, driver present",
      contextAssumptions: "Vehicle is stationary with the transmission park pawl engaged. Driver mechanical pedal linkage remains available.",
    }, "The control action is provided too late", {
      applicable: "no",
      rationale: "At zero speed with the park pawl engaged there is no deceleration deadline for the command to miss.",
      safetySignificant: null,
      canonicalHazardId: null,
      forbiddenRequirementClaims: [],
    }),
    // Applicable and genuinely mission-only: the deviation is real, but the
    // stated architecture keeps the brake system safe without this report.
    item("FD-15", diagnosticInterface, "Not providing the control action causes a hazard", {
      applicable: "yes",
      rationale: "Absence of the status record removes fault visibility for maintenance; braking and its fail-safe behaviour are unaffected, so no exposed entity is reached.",
      safetySignificant: "no",
      canonicalHazardId: null,
      forbiddenRequirementClaims: [],
    }),
    item("FD-16", diagnosticInterface, "The control action is provided too late", {
      applicable: "yes",
      rationale: "A late status record delays workshop diagnosis; no protective function holds a deadline on it, so the delay has no harm path.",
      safetySignificant: "no",
      canonicalHazardId: null,
      forbiddenRequirementClaims: [],
    }),
  ],
};

export default vehicleBrakingFixture;
