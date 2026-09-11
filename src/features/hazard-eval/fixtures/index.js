import autonomyStackFixture from "./autonomyStack";
import vehicleBrakingFixture from "./vehicleBraking";

export const HAZARD_EVAL_FIXTURES = [
  vehicleBrakingFixture,
  autonomyStackFixture,
];

export function getHazardEvalFixture(fixtureId) {
  return HAZARD_EVAL_FIXTURES.find((fixture) => fixture.fixtureId === fixtureId) || null;
}

export function getApprovedHazardEvalFixtures() {
  return HAZARD_EVAL_FIXTURES.filter((fixture) => fixture.labelStatus === "approved");
}

export default HAZARD_EVAL_FIXTURES;
