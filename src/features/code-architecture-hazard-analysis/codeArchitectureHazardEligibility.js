import { isNonProductionCallPath } from '../code-architecture-context/functionalDecompositionScope';

export const CODE_ARCHITECTURE_LIFECYCLE_PHASES = Object.freeze([
  "Runtime",
  "Initialization",
  "Configuration",
  "Mode Transition",
  "Shutdown",
  "Deployment/Update",
  "Test/Verification",
  "Static Structure",
  "Needs Review",
]);

export const CODE_ARCHITECTURE_INTERFACE_TYPES = Object.freeze([
  "Command",
  "Data",
  "State Estimate",
  "Feedback/Status",
  "Event",
  "Configuration/Authority",
  "Resource/Energy",
  "Function Call",
  "Structural Relationship",
  "Needs Review",
]);

export const CODE_ARCHITECTURE_HAZARD_ELIGIBILITY = Object.freeze({
  INCLUDE: "Include",
  EXCLUDE: "Exclude",
  NEEDS_REVIEW: "Needs Review",
});

const ELIGIBILITY_VALUES = new Set(Object.values(CODE_ARCHITECTURE_HAZARD_ELIGIBILITY));
const LIFECYCLE_VALUES = new Set(CODE_ARCHITECTURE_LIFECYCLE_PHASES);
const INTERFACE_VALUES = new Set(CODE_ARCHITECTURE_INTERFACE_TYPES);

const textForRow = (row = {}) => [
  row.from,
  row.fromFile,
  row.fromDetails,
  row.action,
  row.controlActionDetails,
  row.controlDetails,
  row.to,
  row.toFile,
  row.toDetails,
  row.architecture?.subsystem,
  row.architecture?.csci,
  row.architecture?.csc,
  row.architecture?.csu,
].map((value) => String(value || "").toLowerCase()).join(" ");

const pathForRow = (row = {}) => [row.fromFile, row.toFile]
  .map((value) => String(value || "").replace(/\\/g, "/").toLowerCase())
  .join(" ");

const matches = (text, expression) => expression.test(text);

function inferredInterfaceType(text) {
  if (matches(text, /\b(pose|state estimate|locali[sz]|position|orientation|velocity estimate|tracked object|world model)\b/)) return "State Estimate";
  if (matches(text, /\b(status|feedback|health|diagnostic|monitor|heartbeat|acknowledg|fault report)\b/)) return "Feedback/Status";
  if (matches(text, /\b(command|request|authorize|authority|inhibit|enable|disable|brak|steer|throttle|actuat|setpoint)\b/)) return "Command";
  if (matches(text, /\b(config|calibrat|parameter|checkpoint|tokenizer|weight|dtype|credential|policy)\b/)) return "Configuration/Authority";
  if (matches(text, /\b(power|energy|force|torque|pressure|resource|memory|compute budget)\b/)) return "Resource/Energy";
  if (matches(text, /\b(event|interrupt|trigger|alert|notification|timeout)\b/)) return "Event";
  if (matches(text, /\b(data|frame|image|point cloud|trajectory|prediction|measurement|signal|message|stream|token|output)\b/)) return "Data";
  if (matches(text, /\b(call|invoke|execute|run|forward|process|compute|generate|validate|load|initialize)\b/)) return "Function Call";
  return "Needs Review";
}

function result(lifecyclePhase, interfaceType, hazardAnalysisEligibility, rationale) {
  return {
    lifecyclePhase,
    interfaceType,
    hazardAnalysisEligibility,
    hazardAnalysisEligibilityRationale: rationale,
    hazardAnalysisEligibilitySource: "deterministic",
  };
}

export function classifyCodeArchitectureHazardEligibility(row = {}) {
  const existingEligibility = ELIGIBILITY_VALUES.has(row.hazardAnalysisEligibility)
    ? row.hazardAnalysisEligibility
    : "";
  const existingLifecycle = LIFECYCLE_VALUES.has(row.lifecyclePhase) ? row.lifecyclePhase : "";
  const existingInterface = INTERFACE_VALUES.has(row.interfaceType) ? row.interfaceType : "";
  if (existingEligibility && row.hazardAnalysisEligibilitySource === "analyst-override") {
    return {
      lifecyclePhase: existingLifecycle || "Needs Review",
      interfaceType: existingInterface || "Needs Review",
      hazardAnalysisEligibility: existingEligibility,
      hazardAnalysisEligibilityRationale: String(row.hazardAnalysisEligibilityRationale || "Analyst override."),
      hazardAnalysisEligibilitySource: "analyst-override",
    };
  }

  // Stored legacy assessments keep their original interpretation on load.
  if (!row.classificationPolicyVersion && existingEligibility) return {
    lifecyclePhase: existingLifecycle || "Needs Review", interfaceType: existingInterface || "Needs Review",
    hazardAnalysisEligibility: existingEligibility,
    hazardAnalysisEligibilityRationale: row.hazardAnalysisEligibilityRationale || "Stored legacy assessment (unverified provenance).",
    hazardAnalysisEligibilitySource: row.hazardAnalysisEligibilitySource || "legacy-stored",
  };
  if (row.classificationPolicyVersion === 3) {
    const e = row.relationshipEvidence || {};
    const kind = e.supported ? e.kind : row.grounding?.relationshipType;
    const path = e.supported ? e.fromFile : row.grounding?.currentFile || row.fromFile;
    if (["structural_inheritance", "structural_member", "inheritance"].includes(kind)) return result("Static Structure", "Structural Relationship", "Exclude", "Structural relationship, not an executable call.");
    if (isNonProductionCallPath(path)) return result("Test/Verification", "Function Call", "Exclude", "Call originates in a test/example source path; excluded from production screening.");
    const evidencedCall = e.supported && ["direct_call", "imported_call", "call_expression"].includes(kind);
    const modelCall = !e.supported && e.extractionMethod === 'model-only' &&
      (["direct_call", "constructor_body_call", "imported_call", "call_expression"].includes(kind) || /^\s*(call|invoke)\b/i.test(row.action || ''));
    if (!evidencedCall && !modelCall) return result("Needs Review", "Needs Review", "Needs Review", "Executable call evidence has not been established. Unsupported proposals require review.");
    // Screen all production calls consistently. Domain vocabulary is not proof
    // of relevance (or irrelevance); hazard generation uses the project context.
    return result("Needs Review", "Function Call", "Include", evidencedCall
      ? `Source-supported production call included for assessment independent of domain or symbol names. ${e.targetResolution === 'unresolved-runtime-target' ? 'Receiver/runtime target remains unresolved.' : e.targetResolution === 'import-reference' ? 'Import reference is evidenced; runtime dispatch is not proven.' : 'Lexical call syntax is evidenced; execution reachability is not proven.'} Lifecycle, hazards, severity and guide-phrase applicability must be assessed in project context.`
      : "Model-extracted production call included for assessment; no syntax inventory is available for this language. Call completeness, target resolution and lifecycle are unverified. Inclusion does not establish a hazard or guide-phrase applicability.");
  }
  if (row.classificationPolicyVersion === 2) {
    const e = row.relationshipEvidence;
    if (!e?.supported) return result("Needs Review", "Needs Review", "Needs Review", "Model-only relationship: source-supported call evidence has not been established.");
    if (["structural_inheritance", "structural_member"].includes(e.kind)) return result("Static Structure", "Structural Relationship", "Exclude", "Source-defined structural relationship, not an executable exchange.");
    const path = String(e.fromFile || "").toLowerCase();
    if (/(^|\/)(tests?|__tests__|fixtures?|examples?|mocks?|demos?|benchmarks?)(\/|$)|(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(path)) return result("Test/Verification", "Function Call", "Exclude", "Evidenced call in a test/example source path.");
    if (!["direct_call", "imported_call", "call_expression"].includes(e.kind)) return result("Needs Review", "Needs Review", "Needs Review", "Source relationship kind requires review.");
    // Eligibility is a screening decision, not a dispatch-resolution claim.
    // Caller and source-module roles let math/library and receiver calls within
    // operational code participate even when their target names are generic.
    const words = value => String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.:/-]/g, " ").toLowerCase();
    const symbols = words(`${e.from} ${e.to}`);
    const sourceContext = `${symbols} ${words(path)}`;
    const operational = /\b(control|command|sensor|trajectory|traj|predict|prediction|forward|inference|perception|planning|localization|localisation|feedback|health|watchdog|fault|safety|clamp|validate|brake|steer|motion|pose|telemetry|geometry|rotation|kinematics|diffusion)\b|\baction space\b/.test(sourceContext);
    if (!operational) return result("Needs Review", "Function Call", "Needs Review", "Call syntax is evidenced; operational relevance is not established by its source symbols or module role.");
    const initialization = /\b(initialize|initialise|init|configure|load|calibrate)\b/.test(words(e.from));
    const type = inferredInterfaceType(symbols);
    return result(initialization ? "Initialization" : "Runtime", initialization ? "Configuration/Authority" : type === "Needs Review" ? "Function Call" : type,
      "Include", `Source-supported call in operationally relevant code; assess potential effects. ${e.targetResolution === "unresolved-runtime-target" ? "Receiver/runtime target remains unresolved." : e.targetResolution === "import-reference" ? "Import reference is evidenced; runtime dispatch is not proven." : "Lexical target is evidenced."} Inclusion does not establish a hazard or guide-phrase applicability.`);
  }
  if (row.classificationPolicyVersion === 1) {
    const e = row.relationshipEvidence;
    if (!e?.supported) return result("Needs Review", "Needs Review", "Needs Review", "Model-only relationship: supported executable or structural evidence has not been established.");
    if (e.kind === "structural_inheritance") return result("Static Structure", "Structural Relationship", "Exclude", "Source-defined base-class relationship, not an executable exchange.");
    if (e.kind === "structural_member") return result("Static Structure", "Structural Relationship", "Exclude", "Source-defined class membership, not an executable exchange.");
    const paths = `${e.fromFile} ${e.toFile}`;
    const symbols = `${e.from} ${e.to}`.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.]/g, " ").toLowerCase();
    if (/(^|[ /])(tests?|fixtures?|examples?|mocks?)([/ ]|$)|_test\.py/.test(paths)) return result("Test/Verification", "Function Call", "Exclude", "Evidenced relationship in a test/example source path.");
    if (e.kind !== "direct_call") return result("Needs Review", "Needs Review", "Needs Review", "Unsupported relationship kind.");
    const consequential = /\b(control|command|sensor|model|safety|trajectory|authority)\b/.test(symbols);
    if (/\b(initialize|init|configure|load|calibrate)\b/.test(symbols) && consequential) return result("Initialization", "Configuration/Authority", "Include", "Evidenced initialization call with consequential source symbols; assess its operational consequence.");
    if (/\b(control|command|sensor|trajectory|predict|forward|feedback|health|watchdog|fault|safety|clamp|validate|brake|steer|motion|pose|telemetry)\b/.test(symbols)) return result("Runtime", inferredInterfaceType(symbols) === "Needs Review" ? "Function Call" : inferredInterfaceType(symbols), "Include", "Evidenced executable call with operational/protective source symbols; eligibility does not assert a hazard.");
    return result("Needs Review", "Function Call", "Needs Review", "Executable call verified; operational consequence is not established by supported source evidence.");
  }
  const text = textForRow(row);
  const paths = pathForRow(row);
  const action = String(row.action || "").trim().toLowerCase();
  const structural = matches(action, /^define\b|^declare\b|^expose\b|^export\b|^import\b/) ||
    matches(text, /\b(structural[_ -]?member|class member|static definition|defined at import time|repository component boundary)\b/) ||
    matches(paths, /(^|[\s/])__init__\.py\b/);
  if (structural) {
    return result("Static Structure", "Structural Relationship", "Exclude", "Static definition or structural relationship; it does not represent an operational exchange or consequential lifecycle action.");
  }

  if (matches(paths, /(^|[\s/])(tests?|__tests__|fixtures?|mocks?|examples?|demos?|benchmarks?)([\s/]|$)|(?:^|[/\s])[^/\s]+(?:_test\.py|\.test\.[a-z]+|\.spec\.[a-z]+)/)) {
    return result("Test/Verification", inferredInterfaceType(text), "Exclude", "Test, fixture, example, demo, or benchmark-only relationship; excluded from production operational hazard analysis.");
  }

  if (matches(paths, /(^|[\s/])(docs?|documentation|visuali[sz]ation|notebooks?)([\s/]|$)/) &&
      !matches(text, /\b(runtime|operator|alert|safety|fault|control|command|actuat)\b/)) {
    return result("Static Structure", inferredInterfaceType(text), "Exclude", "Documentation or non-operational visualization utility with no evidenced runtime safety effect.");
  }

  const interfaceType = inferredInterfaceType(text);
  if (matches(text, /\b(safety|fault|failure|watchdog|interlock|fallback|failover|minimum[- ]risk|emergency|protective|health monitor|recovery|degraded mode)\b/)) {
    return result("Runtime", interfaceType === "Needs Review" ? "Feedback/Status" : interfaceType, "Include", "Runtime safety monitoring, fault handling, protective action, or recovery behavior can change the hazardous system state.");
  }

  if (matches(text, /\b(mode transition|enter mode|exit mode|startup|start-up|shutdown|shut down|power down|activate mode|deactivate mode)\b/)) {
    const phase = matches(text, /\b(shutdown|shut down|power down)\b/) ? "Shutdown" : "Mode Transition";
    return result(phase, interfaceType === "Needs Review" ? "Event" : interfaceType, "Include", "Lifecycle or mode-transition behavior can enable, disable, or alter operational authority and is hazard-analysis relevant.");
  }

  const consequentialConfiguration = matches(text, /\b(initialize|initialise|startup|load|configure|configuration|calibrat|checkpoint|tokenizer|weight|dtype|set parameter|validate config|model config)\b/) &&
    matches(text, /\b(runtime|inference|model|trajectory|control|command|sensor|pose|planning|actuat|safety|validat|corrupt|inconsistent|precision|authority)\b/);
  if (consequentialConfiguration) {
    const phase = matches(text, /\b(config|calibrat|parameter|authority)\b/) ? "Configuration" : "Initialization";
    return result(phase, interfaceType === "Needs Review" ? "Configuration/Authority" : interfaceType, "Include", "Initialization or configuration content establishes consequential runtime behavior and can propagate into operational outputs or authority.");
  }

  if (matches(text, /\b(runtime|inference|forward|sensor|perception|locali[sz]|pose|world model|predict|trajectory|planning|control|command|actuat|brak|steer|throttle|navigation|operator|vehicle|robot|flight|motion|telemetry|padding|tensor|torch|numpy|eos)\b/)) {
    return result("Runtime", interfaceType === "Needs Review" ? "Function Call" : interfaceType, "Include", "Operational runtime interface whose omission, content, timing, ordering, or duration can affect system behavior.");
  }

  if (matches(text, /\b(deploy|update|upgrade|install|migration|rollback)\b/)) {
    return result("Deployment/Update", interfaceType, "Needs Review", "Deployment or update relationship may affect runtime behavior, but the supplied row does not establish its operational consequence.");
  }

  return result("Needs Review", interfaceType, "Needs Review", "The code relationship is not clearly operational, consequential initialization/configuration, or safely excludable from the supplied evidence.");
}

export function ensureCodeArchitectureHazardEligibility(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row = {}) => ({
    ...row,
    ...classifyCodeArchitectureHazardEligibility(row),
  }));
}

export function summarizeCodeArchitectureHazardEligibility(rows = []) {
  return ensureCodeArchitectureHazardEligibility(rows.filter(row => row?.lineage?.status !== "historical")).reduce((summary, row) => {
    if (row.hazardAnalysisEligibility === "Include") summary.include += 1;
    else if (row.hazardAnalysisEligibility === "Exclude") summary.exclude += 1;
    else summary.needsReview += 1;
    summary.total += 1;
    return summary;
  }, { total: 0, include: 0, exclude: 0, needsReview: 0 });
}

export function isCodeArchitectureHazardEligible(row = {}) {
  return row.lineage?.status !== "historical" && classifyCodeArchitectureHazardEligibility(row).hazardAnalysisEligibility === "Include";
}
