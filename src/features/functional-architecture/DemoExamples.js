/**
 * xHandle: demo examples functional-architecture workflow.
 * This file supports xHandle's functional-architecture flow, where users describe a system, generate functional decomposition rows, and turn those rows into diagram-ready structure.
 * Functional decomposition is the upstream model that later feeds hazard analysis, reporting, traceability, and other AI-assisted engineering workflows throughout the application.
 * Related files: src/App.js, src/components/diagrams/LiteSummaryDiagramReactFlow.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

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
  EO/IR Sensor → provides video frames → Onboard AI
  GPS/IMU → provides pose/velocity → Flight Controller
  Onboard AI → sends guidance commands → Flight Controller
  Flight Controller → drives motor/servo commands → Actuator Suite (Motors/Servos)
  Comms Module → uplinks telemetry → Ground Station
  Ground Station → sends mission updates → Comms Module
  Onboard AI → sends status/events → Comms Module
  Power System → supplies power → all components
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
  Camera → provides images → Vision Processor
  Vision Processor → sends object poses → Path Planner
  Path Planner → sends joint trajectories → Arm Controller
  Arm Controller → actuates → End Effector
  Safety PLC → enables/disables motion → Arm Controller
  Conveyor Controller → provides part arrival events → Path Planner
  HMI → sends start/stop/recipe → Safety PLC
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
  Order Manager → dispatches tasks → Fleet Manager
  Fleet Manager → assigns missions → AMR Unit
  AMR Unit (Localization) → publishes pose → Fleet Manager
  AMR Unit (Obstacle Detection) → signals stop/slow → Motion Controller
  Motion Controller → drives wheels → AMR Unit
  AMR Unit → reports status/telemetry → Fleet Manager
  Packing Station HMI → requests totes → Order Manager
  Charging Dock → provides charge status → AMR Unit
  Wi-Fi AP → transports data → all components
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
  Flow Sensor → provides flow/volume → Control CPU
  Pressure Sensor → provides airway pressure → Control CPU
  Control CPU → commands → Valve Actuator
  Control CPU → commands → Blower
  Control CPU → sends alarms/events → Alarm Module
  Clinician UI → sets modes/parameters → Control CPU
  Power Supply → provides power → all components
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
  Server Agents → send metrics → Monitoring Server
  Network Switches → send traffic data → Monitoring Server
  Environmental Sensors → send temp/humidity → Monitoring Server
  Monitoring Server → sends alerts → Alerting System
  Admin Dashboard → queries data → Monitoring Server
  Backup Server → syncs → Monitoring Server
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
  Market Data Feed → sends price updates → Trading Engine
  Trading Engine → sends trade signals → Risk Manager
  Risk Manager → approves/rejects → Order Router
  Order Router → sends orders → Exchange Gateway
  Exchange Gateway → confirms executions → Order Router
  Monitoring Dashboard → displays metrics → Trading Engine
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
  Web Chat Interface → sends messages → NLP Engine
  NLP Engine → queries → Knowledge Base
  NLP Engine → updates → Context Manager
  NLP Engine → triggers escalation → Escalation Service
  Escalation Service → sends case → CRM Integration
  CRM Integration → provides customer history → NLP Engine
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
        Sensor Suite → sends raw detections/signals → Data Fusion & Tracking Module
        Data Fusion & Tracking Module → generates integrated tactical picture → AI Decision-Support Module
        AI Decision-Support Module → classifies, prioritizes, and recommends actions → Human Tactical Operator
        Human Tactical Operator → validates/modifies tactical plan → Command & Control Interface
        Command & Control Interface → issues approved commands → Weapon / Maneuver Control System
        Weapon / Maneuver Control System → executes engagement or maneuver → Sensor Suite (feedback loop)
        AI Decision-Support Module → requests jamming/decoys → Electronic Warfare System
        Secure Comms Link → exchanges tactical data with allied platforms → Data Fusion & Tracking Module
        Mission Data Recorder & Analytics Module → logs events & outcomes → Human Tactical Operator (post-mission review)
      `.trim(),
      ops:
        'Persistent surveillance, multi-sensor fusion, automated threat classification, human-in-the-loop decision-making, tactical coordination with allied assets, execution of weapon/maneuver/EW actions, and post-action analysis for continuous improvement.',
    },
  }
  ];
  
/**
 * getExample reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param key Input consumed by this step of the xHandle workflow.
 * @returns the normalized data requested by this module.
 */
  export function getExample(key) {
    return EXAMPLES.find((x) => x.key === key);
  }
  
  export const EXAMPLE_OPTIONS = EXAMPLES.map((x) => ({ value: x.key, label: x.label }));
  
  export default EXAMPLES;
  