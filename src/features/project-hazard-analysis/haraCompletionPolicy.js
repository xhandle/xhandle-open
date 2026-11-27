import { normalizeHaraRating, haraText } from './projectHara';
import { unresolvedStpaValue } from './stpaAcceptance';
import { completePracticalHaraQuality } from './haraPracticalQuality';

export const HARA_COMPLETION_POLICY = 'projects-hara-practical-v1';
export const practicalProjectHara = sheets => sheets?.haraCompletionPolicy === HARA_COMPLETION_POLICY;
const good = value => !unresolvedStpaValue(value);
export function haraMinimumIssues(row = {}) {
  const issues = [];
  for (const [field,prefix,max] of [['severity','S',3],['exposure','E',4],['controllability','C',3]]) {
    if (!normalizeHaraRating(row[field], prefix, max) && !(row.evidenceBasis === 'SOTIF concern' && /^not applicable/i.test(haraText(row[field])))) issues.push(`Complete ${field}`);
  }
  for (const field of ['hazardousEvent','potentialHarm','personsAtRisk','severityRationale','exposureRationale','controllabilityRationale','safetyGoal','safeState','safeStateJustification','ftti','fttiRationale']) {
    if (!good(row[field])) issues.push(`Complete ${field}`);
  }
  if (!/\bshall\b/i.test(row.safetyGoal || '')) issues.push('Provide an item-level shall safety goal');
  return issues;
}
export function mergeHaraCandidate(previous = {}, next = {}) {
  return {...previous, ...Object.fromEntries(Object.entries(next).filter(([,value]) => typeof value === 'string' && good(value)))};
}
export function completeProjectHaraAssessment(candidate = {}, input = {}) {
  const e = input.evidence || {}, row = {...candidate, id: input.id};
  const action = e['Control Action'] || 'the modeled interaction';
  const source = e['Function (From)'] || 'the source function', receiver = e['Function (To)'] || 'the receiving function';
  const situation = row.operationalSituation || e['Operational Scenario'] || 'the stated operating situation';
  const narrative = [e['Causal Scenario'], e.Loss, e.Hazard, e['Operating Conditions'], situation, row.hazardousEvent, row.potentialHarm].join(' ');
  const physical = /pedestrian|cyclist|occupant|passenger|collision|injur|fatal|death|crush|rollover|vehicle motion/i.test(narrative);
  const defaults = {
    itemFunction: `${source}: ${action} supplied to ${receiver}`,
    malfunction: `The result of “${action}” has the selected deviation at ${receiver}.`,
    vehicleHazard: physical ? 'Vehicle motion or stopping is inconsistent with the operating situation and exposes people to contact.' : 'The item cannot maintain its intended functional behavior in the operating situation.',
    operationalSituation: situation,
    hazardousEvent: `During ${situation}, the selected deviation of “${action}” affects ${receiver} and the dependent item behavior.`,
    potentialHarm: physical ? 'People near or inside the vehicle can suffer serious or fatal contact injuries.' : 'People depending on the item can be exposed to harm when its required function is unavailable or incorrect.',
    personsAtRisk: physical ? 'People near or inside the vehicle in the operating situation' : 'People exposed to the item in the operating situation',
    severity: physical ? 'S3' : 'S2',
    severityRationale: physical ? 'Vehicle contact can cause life-threatening or fatal injury; use this severity for the unmitigated event.' : 'Use S2 as the engineering estimate for serious injury from loss or incorrect execution of the modeled function.',
    exposure: /maintenance|repair|servicing/i.test(situation) ? 'E2' : /curb|loading|pickup|drop.off|parking/i.test(situation) ? 'E3' : 'E4',
    exposureRationale: `Assume ${situation} occurs ${/maintenance|repair|servicing/i.test(situation) ? 'occasionally' : /curb|loading|pickup|drop.off|parking/i.test(situation) ? 'regularly during the intended mission' : 'frequently during intended operation'}. This estimates the operating situation's frequency and duration independently of malfunction probability.`,
    controllability: physical ? 'C3' : 'C2',
    controllabilityRationale: physical ? 'Assume people close to the vehicle have limited time and space to avoid the resulting contact. Do not credit the malfunctioning item with its own proposed safeguards.' : 'Assume the exposed person can take a normal avoidance action when the loss of function becomes apparent; no internal repair or restart is credited as harm avoidance.',
    safetyGoal: e.Hazard ? `The vehicle/item shall prevent the hazardous state “${e.Hazard}” during ${situation}.` : physical ? 'The vehicle shall prevent unintended motion or loss of stopping control from causing contact with people.' : 'The item shall maintain the harm-prevention function needed by exposed people during intended use.',
    safetyGoalRationale: `The objective interrupts the path from the modeled interaction deviation to harm during ${situation}.`,
    safeState: 'Prevent hazardous movement and maintain controllable deceleration or standstill as appropriate to vehicle state, surrounding traffic and exposed people.',
    safeStateJustification: 'The required response limits the hazardous item behavior while preserving stopping and control functions needed to avoid secondary harm.',
    ftti: physical ? 't_hazard: time from fault occurrence to hazardous vehicle motion/contact' : 't_hazard: time from fault occurrence to hazardous loss of the required function',
    fttiRationale: physical ? `For ${situation}, bound t_hazard by the earliest hazardous motion or contact after the fault. For closing motion use available clearance divided by relative closing speed, accounting for acceleration and stopping distance. Detection plus the complete stopping/control response must finish before this bound; a freshness or diagnostic threshold is a response allocation, not the bound itself.` : `For ${situation}, t_hazard ends when the fault first causes the hazardous loss of the required function. Allocate detection plus the complete harm-prevention response inside this event-specific interval, independently of diagnostic and reporting periods.`,
    assumptions: `The modeled interaction supports the item during ${situation}; the selected deviation is assessed before crediting newly proposed safeguards.`,
    itemDefinition: `Vehicle/item functions supporting ${situation}, including ${source}, ${receiver} and their modeled interface.`,
    evidenceBasis: 'E/E malfunction', decisionBasis: 'Engineering judgment',
  };
  for (const [field,fallback] of Object.entries(defaults)) if (!good(row[field])) row[field] = fallback;
  for (const [field,prefix,max] of [['severity','S',3],['exposure','E',4],['controllability','C',3]]) {
    const normalized = normalizeHaraRating(row[field],prefix,max);
    if (normalized) row[field] = normalized;
    else if (row.evidenceBasis !== 'SOTIF concern') row[field] = defaults[field];
  }
  if (!/\bshall\b/i.test(row.safetyGoal)) row.safetyGoal = defaults.safetyGoal;
  // Optional evidence remains optional. Never manufacture a supporting quote,
  // executed verification, documented timing budget or human acceptance.
  for (const key of Object.keys(row)) if (typeof row[key] === 'string' && unresolvedStpaValue(row[key])) row[key] = '';
  row.gaps = ''; row.hazardMappingReview = '';
  return completePracticalHaraQuality(row, defaults);
}

export async function assessPracticalHara(inputs, {request,signal,onProgress=()=>{},canRecover}) {
  const accepted=new Map(), candidates=new Map();
  const check=()=>{if(signal?.aborted)throw new DOMException('HARA generation cancelled.','AbortError');};
  async function assess(batch, correction=false) {
    check();
    try {
      const response=await request(batch,correction?batch.map(input=>candidates.get(input.id)||{id:input.id}):null);
      check();
      const decoded=typeof response==='string'?JSON.parse(response.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')):response;
      const rows=Array.isArray(decoded)?decoded:decoded?.assessments;
      if(!Array.isArray(rows))return;
      const counts=new Map();for(const row of rows)counts.set(row?.id,(counts.get(row?.id)||0)+1);
      for(const row of rows){
        if(!batch.some(input=>input.id===row?.id)||counts.get(row.id)!==1)continue;
        const candidate=mergeHaraCandidate(candidates.get(row.id),row);candidates.set(row.id,candidate);
        if(!haraMinimumIssues(candidate).length)accepted.set(row.id,candidate);
      }
    }catch(error){check();if(error?.name==='AbortError'||!canRecover(error,signal))throw error;}
  }
  await assess(inputs);
  for(const input of inputs.filter(input=>!accepted.has(input.id))){
    onProgress({message:`Completing HARA assessment ${input.id}…`});
    await assess([input],true);
  }
  check();
  return new Map(inputs.map(input=>[input.id,completeProjectHaraAssessment(accepted.get(input.id)||candidates.get(input.id),input)]));
}
