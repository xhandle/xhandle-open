// src/examples/DemoExamples.js
// Centralized demo examples for the Prompt Wizard
// Covers multiple industries: Defense, Manufacturing, Logistics, Medical, IT, Finance, AI, etc.

export const EXAMPLES = [
    // Defense / Aerospace
    {
      key: 'drone',
      label: 'Autonomous Target-Tracking Drone',
      data: {
        systemName: 'Autonomous Target-Tracking Drone',
        systemOverview:
          'Provides real-time ISR and autonomous target tracking in contested airspace with onboard AI and secure link to a ground station.',
        functionalComponents:
          'EO/IR Sensor, Flight Controller, Onboard AI, Comms Module, GPS/IMU, Power System, Ground Station, Actuator Suite (Motors/Servos)',
        interactions: `
  The EO/IR Sensor provides video frames to the Onboard AI during surveillance and tracking so targets can be detected, classified, and followed.
  The GPS/IMU provides pose and velocity estimates to the Flight Controller so flight commands can be stabilized against the current aircraft state.
  The Onboard AI sends guidance commands to the Flight Controller after evaluating target movement so the aircraft can adjust heading, altitude, and speed.
  The Flight Controller sends motor and servo commands to the Actuator Suite so the airframe can execute the requested maneuver.
  The Comms Module uplinks telemetry to the Ground Station at mission-defined intervals so operators can monitor vehicle health and mission progress.
  The Ground Station sends mission updates to the Comms Module when operators revise objectives so onboard functions can use the latest tasking.
  The Onboard AI sends status events to the Comms Module when tracking confidence or autonomy state changes so operators receive actionable alerts.
  The Power System supplies regulated power to system components so sensing, computing, communications, and actuation remain within operating limits.
  `.trim(),
        ops:
          'Pre-flight checks, takeoff, climb, cruise, autonomous tracking, handoff to ground, return-to-base, lost-link, landing',
      },
    },
    // Manufacturing
    {
      key: 'robotic_arm',
      label: 'Industrial Robotic Arm (Vision-Guided)',
      data: {
        systemName: 'Vision-Guided Robotic Arm',
        systemOverview:
          'Picks and places items on a conveyor using a camera and path planner with safety interlocks.',
        functionalComponents:
          'Camera, Vision Processor, Path Planner, Arm Controller, End Effector, Safety PLC, Conveyor Controller, HMI',
        interactions: `
  The Camera provides images to the Vision Processor when parts enter the work cell so item position and orientation can be estimated.
  The Vision Processor sends object poses to the Path Planner after image analysis so reachable pick and place motions can be planned.
  The Path Planner sends joint trajectories to the Arm Controller when a valid motion is available so the arm can move without violating constraints.
  The Arm Controller commands the End Effector during pick and place operations so parts can be gripped, moved, and released.
  The Safety PLC enables or disables motion at the Arm Controller when guards, interlocks, or emergency stops change state.
  The Conveyor Controller provides part arrival events to the Path Planner so robot motion can be synchronized with conveyor timing.
  The HMI sends start, stop, and recipe selections to the Safety PLC so production can follow approved operator intent.
  `.trim(),
        ops:
          'Startup, homing, normal production, jam recovery, maintenance, emergency stop',
      },
    },
    // Logistics
    {
      key: 'amr_fleet',
      label: 'Warehouse AMR Fleet',
      data: {
        systemName: 'Warehouse AMR Fleet',
        systemOverview:
          'Autonomous mobile robots coordinate to move totes between storage and packing stations via a fleet manager.',
        functionalComponents:
          'AMR Unit (Localization, Obstacle Detection, Motion Controller), Fleet Manager, Order Manager, Packing Station HMI, Charging Dock, Wi-Fi AP',
        interactions: `
  The Order Manager dispatches task requests to the Fleet Manager when totes are needed so missions can be prioritized across available robots.
  The Fleet Manager assigns missions to each AMR Unit based on location, workload, and battery state so warehouse transport demand is balanced.
  AMR Unit localization publishes pose updates to the Fleet Manager during movement so fleet routing can account for current robot positions.
  AMR Unit obstacle detection signals slow or stop conditions to the Motion Controller when hazards are detected so local motion remains safe.
  The Motion Controller drives wheel commands within the AMR Unit so requested routes are converted into controlled vehicle movement.
  Each AMR Unit reports status and telemetry to the Fleet Manager so mission completion, faults, and battery state remain visible.
  The Packing Station HMI requests totes from the Order Manager when operators need inventory so fulfillment work can continue.
  The Charging Dock provides charge status to the AMR Unit during docking so the robot can manage charging and return-to-service decisions.
  The Wi-Fi AP transports operational data among system components so mission commands, telemetry, and operator requests remain connected.
  `.trim(),
        ops:
          'Shift start, idle, mission execution, congestion handling, battery swap/charge, shift end',
      },
    },
    // Medical
    {
      key: 'ventilator',
      label: 'Medical Ventilator',
      data: {
        systemName: 'ICU Ventilator',
        systemOverview:
          'Delivers controlled breaths based on patient parameters with alarms and clinician UI.',
        functionalComponents:
          'Flow Sensor, Pressure Sensor, Control CPU, Valve Actuator, Blower, Alarm Module, Power Supply, Clinician UI',
        interactions: `
  The Flow Sensor provides flow and volume measurements to the Control CPU during breathing cycles so delivered ventilation can be regulated.
  The Pressure Sensor provides airway pressure measurements to the Control CPU so pressure limits and patient response can be monitored.
  The Control CPU commands the Valve Actuator during inspiration and expiration so airflow routing follows the selected ventilation mode.
  The Control CPU commands the Blower when pressure support is required so the device can deliver the requested breath profile.
  The Control CPU sends alarm events to the Alarm Module when thresholds are violated so clinicians receive timely audible and visual alerts.
  The Clinician UI sends selected modes and parameters to the Control CPU after clinician confirmation so ventilation control uses approved settings.
  The Power Supply provides regulated power to system components so ventilation, sensing, alarms, and the user interface remain available.
  `.trim(),
        ops:
          'Power-on self-test, standby, assist-control, SIMV, pressure support, alarm conditions, battery backup',
      },
    },
    // IT Infrastructure
    {
      key: 'data_center',
      label: 'Enterprise Data Center Monitoring',
      data: {
        systemName: 'Enterprise Data Center Monitoring Platform',
        systemOverview:
          'Monitors servers, network devices, and environmental sensors to ensure uptime and security compliance.',
        functionalComponents:
          'Server Agents, Network Switches, Environmental Sensors, Monitoring Server, Alerting System, Admin Dashboard, Backup Server',
        interactions: `
  Server Agents send performance and health metrics to the Monitoring Server at configured intervals so infrastructure status can be analyzed.
  Network Switches send traffic and port status data to the Monitoring Server so network congestion, faults, and security anomalies can be detected.
  Environmental Sensors send temperature and humidity readings to the Monitoring Server so facility conditions can be checked against operating limits.
  The Monitoring Server sends alert records to the Alerting System when thresholds or policies are violated so responders can be notified.
  The Admin Dashboard queries monitoring data from the Monitoring Server when administrators investigate issues so current and historical status is visible.
  The Backup Server syncs backup status with the Monitoring Server after scheduled jobs so data protection health can be tracked.
  `.trim(),
        ops:
          'Normal operation, alert handling, maintenance mode, backup/restore, security audit',
      },
    },
    // Finance
    {
      key: 'trading_platform',
      label: 'Algorithmic Trading Platform',
      data: {
        systemName: 'High-Frequency Trading Platform',
        systemOverview:
          'Executes algorithmic trades based on real-time market data with risk management safeguards.',
        functionalComponents:
          'Market Data Feed, Trading Engine, Risk Manager, Order Router, Exchange Gateway, Monitoring Dashboard',
        interactions: `
  The Market Data Feed sends price updates to the Trading Engine as market events arrive so strategies can evaluate current opportunities.
  The Trading Engine sends proposed trade signals to the Risk Manager before order placement so exposure, limits, and policy checks can be applied.
  The Risk Manager approves or rejects trade requests for the Order Router so only compliant orders continue toward execution.
  The Order Router sends approved orders to the Exchange Gateway so they can be submitted to the appropriate market venue.
  The Exchange Gateway confirms executions to the Order Router after market response so order state and positions remain accurate.
  The Monitoring Dashboard receives metrics from the Trading Engine so operators can review latency, strategy status, and abnormal behavior.
  `.trim(),
        ops:
          'Market open, strategy execution, risk limit breach, order throttling, market close',
      },
    },
    // AI / Chatbots
    {
      key: 'ai_chatbot',
      label: 'Customer Support AI Chatbot',
      data: {
        systemName: 'AI-Powered Customer Support Chatbot',
        systemOverview:
          'Provides automated responses to customer queries, escalating to human agents when necessary.',
        functionalComponents:
          'Web Chat Interface, NLP Engine, Knowledge Base, Context Manager, Escalation Service, CRM Integration',
        interactions: `
  The Web Chat Interface sends customer messages to the NLP Engine when users submit chat input so intent and entities can be interpreted.
  The NLP Engine queries the Knowledge Base during response generation so answers can use approved support content.
  The NLP Engine updates the Context Manager after each turn so conversation state, user intent, and unresolved issues remain available.
  The NLP Engine triggers the Escalation Service when confidence is low or policy requires human review so the case can move to an agent.
  The Escalation Service sends case details to the CRM Integration so human support staff receive the transcript and issue context.
  The CRM Integration provides customer history to the NLP Engine when available so responses can account for account status and prior cases.
  `.trim(),
        ops:
          'User greeting, query handling, context switching, escalation, feedback collection',
      },
    },
    // AI-Specific Modern Use Cases
   // Defense / Human-AI Teaming
   {
    key: 'tactical_control_ai_human',
    label: 'Tactical Control System (Human + AI)',
    data: {
      systemName: 'Naval Tactical Control System with Human-AI Teaming',
      systemOverview:
        'Integrates multi-sensor fusion, AI-driven threat analysis, and secure communications, enabling coordinated human-AI tactical decision-making across multiple platforms in high-pressure maritime operations.',
      functionalComponents:
        [
          'Sensor Suite (Radar, EO/IR, ESM, Sonar)',
          'Data Fusion & Tracking Module',
          'AI Decision-Support Module',
          'Human Tactical Operator',
          'Command & Control Interface',
          'Electronic Warfare System',
          'Weapon / Maneuver Control System',
          'Secure Comms Link (Ship-to-Ship, Ship-to-Air, Ship-to-Shore)',
          'Mission Data Recorder & Analytics Module'
        ].join(', '),
      interactions: `
        The Sensor Suite sends raw detections and signals to the Data Fusion & Tracking Module during surveillance so tracks can be correlated.
        The Data Fusion & Tracking Module provides an integrated tactical picture to the AI Decision-Support Module so threats can be assessed in context.
        The AI Decision-Support Module provides classifications, priorities, and recommended actions to the Human Tactical Operator for review and approval.
        The Human Tactical Operator submits validated or modified tactical plans through the Command & Control Interface so intent is captured before execution.
        The Command & Control Interface issues approved commands to the Weapon / Maneuver Control System so authorized actions can be carried out.
        The Weapon / Maneuver Control System reports execution feedback to the Sensor Suite and tactical display functions so effects can be observed.
        The AI Decision-Support Module requests jamming or decoy actions from the Electronic Warfare System when threat conditions justify defensive measures.
        The Secure Comms Link exchanges tactical data with allied platforms through the Data Fusion & Tracking Module so shared situational awareness is maintained.
        The Mission Data Recorder & Analytics Module logs events and outcomes for the Human Tactical Operator so post-mission review can improve future decisions.
      `.trim(),
      ops:
        'Persistent surveillance, multi-sensor fusion, automated threat classification, human-in-the-loop decision-making, tactical coordination with allied assets, execution of weapon/maneuver/EW actions, and post-action analysis for continuous improvement.',
    },
  }
  ];
  
  export function getExample(key) {
    return EXAMPLES.find((x) => x.key === key);
  }
  
  export const EXAMPLE_OPTIONS = EXAMPLES.map((x) => ({ value: x.key, label: x.label }));
  
  export default EXAMPLES;
  
