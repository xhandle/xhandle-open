// Synthetic control contracts and known deviations. No repository/customer data.
const domains = [
  {controller:'Brake controller',action:'Apply braking',target:'Brake actuator',context:'Vehicle approaching a stopped queue',loss:'Occupants injured in a collision',hazard:'Vehicle enters occupied stopping space',condition:'the stopping path is occupied',constraint:'provide braking before the vehicle enters occupied stopping space'},
  {controller:'Door controller',action:'Lock platform doors',target:'Door latch',context:'Train preparing to depart with passengers boarding',loss:'Passenger injured by movement through an open door',hazard:'Train moves while a platform door is unlocked',condition:'the train is preparing to move',constraint:'keep platform doors locked throughout train movement'},
  {controller:'Thermal controller',action:'Disable heater',target:'Heater relay',context:'Reactor temperature reaching its permitted operating boundary',loss:'Personnel injured by thermal release',hazard:'Reactor operates above its permitted temperature',condition:'the reactor reaches its temperature boundary',constraint:'disable heating before the permitted temperature is exceeded'},
  {controller:'Flight controller',action:'Deploy landing gear',target:'Gear actuator',context:'Aircraft approaching landing with deployment conditions satisfied',loss:'Occupants injured during landing',hazard:'Aircraft reaches touchdown with gear retracted',condition:'the aircraft is approaching touchdown',constraint:'complete gear deployment before touchdown'},
];
const categories = [
  {phrase:'Not provided',deviation:'is omitted when required'},
  {phrase:'Provided when not needed',deviation:'is provided while its enabling conditions are false'},
  {phrase:'Too late',deviation:'is provided after its required response boundary'},
  {phrase:'Stopped too soon',deviation:'is terminated before its required completion condition'},
];
// Unsafe provision has a different context and consequence from omission.
// A safe action cannot inherit an omission hazard just because both share a row.
const unsafeProvision = [
  {context:'Clear road with a close following vehicle and no braking demand',condition:'the road ahead is clear and a following vehicle occupies the rear gap',hazard:'Vehicle decelerates abruptly into an occupied following gap',loss:'Occupants injured in a rear-end collision',constraint:'withhold braking when no braking demand exists and abrupt deceleration endangers a following vehicle'},
  {context:'Station fire with passengers using the platform doors to evacuate',condition:'the platform doors form the active evacuation route',hazard:'The evacuation route remains locked during a station fire',loss:'Passengers injured by smoke exposure',constraint:'leave the evacuation route unlocked during active evacuation'},
  {context:'Cold reactor batch requiring heating to reach its process temperature',condition:'the batch is below its required process temperature',hazard:'Reactor remains below its required process temperature',loss:'Batch lost because the process cannot reach its required temperature',constraint:'maintain heating while required process conditions call for it',classification:'Mission/Reliability'},
  {context:'Aircraft cruise above the gear deployment speed envelope',condition:'the aircraft exceeds the gear deployment speed limit',hazard:'Aircraft operates with deployed landing gear above its permitted speed envelope',loss:'Occupants injured following loss of aircraft control',constraint:'prevent gear deployment outside its validated speed envelope'},
];
export function syntheticStpaCases(copies=1) {
  return Array.from({length:copies},(_,copy)=>domains.flatMap((base,domainIndex)=>categories.map((category,categoryIndex)=>{
    const domain=categoryIndex===1?{...base,...unsafeProvision[domainIndex]}:base;
    const id=`SYN-${copy}-${domainIndex}-${categoryIndex}`;
    const source={id,from:domain.controller,action:domain.action,to:domain.target,phrase:category.phrase,
      context:{scenario:domain.context,conditions:domain.condition},
      evidence:{code:`// Synthetic fault: ${domain.action} ${category.deviation}.`,contract:`${domain.controller} must ${domain.constraint}.`,systemModel:`In this scenario, the stated deviation produces this system condition: ${domain.hazard}. Consequence: ${domain.loss}.`},
    };
    const assessment={id,assessedAction:domain.action,applicable:'Yes',applicabilityRationale:`${domain.action} governs the state of ${domain.target}.`,
      classification:domain.classification || 'Safety — Direct',classificationRationale:domain.classification==='Mission/Reliability'?'The effect terminates at loss of the process batch; this synthetic contract specifies no physical-harm propagation.':`The actuator state produces the hazardous condition: ${domain.hazard}.`,assumptions:'No additional assumptions.',
      uca:`${domain.controller}: ${domain.action} ${category.deviation} when ${domain.condition}.`,
      loss:domain.loss,hazard:domain.hazard,
      causalScenario:`An incorrect process-model state causes ${domain.action} to violate its control contract when ${domain.condition}; ${domain.hazard.toLowerCase()} leads to ${domain.loss.toLowerCase()}.`,
      causalFactor:'The controller uses an incorrect process-model state for the control decision.',
      safetyConstraint:`The ${domain.controller} shall ${domain.constraint}.`,
      softwareRequirement:`The software shall enforce the enabling and completion conditions for ${domain.action} using current validated feedback.`,
      verification:`Inject the incorrect controller state when ${domain.condition}; verify ${domain.action} satisfies its enabling and completion contract and ${domain.target} reaches the required state.`,
    };
    return {source,assessment,category:categoryIndex};
  }))).flat();
}
