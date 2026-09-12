import { useState, useEffect, useRef } from "react";
import { backendURL, ACCOUNT_ID, getLocalAccessToken } from "./backendConfig";
import {
  FileTypeSelectorModal,
  GITHUB_ANALYSIS_CONTEXT_FILES_KEY,
  GITHUB_ANALYSIS_CONTEXT_TEXT_KEY,
  filterSelectableRepoFiles,
  getDefaultBranch,
  loadGitHubAnalysisContextFromStorage,
  listRepoFilesViaGitHub,
} from "./generateFunctionalDecompositionFromGitHub";
import {
  AI_PROVIDER_EFFORT_OPTIONS,
  AI_PROVIDER_OPTIONS,
  clearUserAIProviderSettings,
  fetchUserAIProviderSettings,
  fetchProviderModelRecords,
  getAIProviderLabel,
  getDefaultProviderModel,
  getProviderKeyHelpText,
  getProviderKeyPlaceholder,
  getProviderModelProfile,
  getProviderModelOptions,
  getStoredAIProviderEffortPreference,
  getStoredAIProviderModelPreference,
  normalizeAIProvider,
  normalizeProviderModel,
  saveUserAIProviderSettings,
  storeAIProviderEffortPreference,
  storeAIProviderModelPreference,
  supportsAIProviderEffort,
  validateProviderApiKey,
} from "../lib/aiProviderConfig";
import {
  backupNow,
  chooseBackupFolder,
  downloadBackupNow,
  getLocalBackupState,
  initializeLocalBackupRuntime,
  recheckBackupFolder,
  restoreFromBackupFile,
  restoreFromConfiguredBackup,
  setAutoBackupEnabled,
  subscribeToLocalBackup,
} from "../lib/localBackupService";
import { notifyBackupDataChanged } from "../lib/localBackupEvents";
import {
  buildEffectiveOrganizationProfileContext,
  createOrganizationProfileRecord,
  getOrganizationProfileIdentity,
  loadOrganizationProfile,
  ORGANIZATION_PROFILE_MAX_CHARS,
  parseOrganizationProfile,
  saveOrganizationProfile,
  validateOrganizationProfile,
} from "../features/organization-profile/organizationProfile";

const VSCODE_EXTENSION_VERSION = "0.0.10";
const VSCODE_EXTENSION_FILENAME = `xhandle-safety-${VSCODE_EXTENSION_VERSION}.vsix`;
const VSCODE_EXTENSION_DOWNLOAD_URL = `/downloads/${VSCODE_EXTENSION_FILENAME}`;
const MAX_ANALYSIS_CONTEXT_FILE_CHARS = 60000;
const SETTINGS_TABS = new Set([
  "openai",
  "organization-profile",
  "vscode",
  "backup",
  "storage",
]);
const STORAGE_DATABASES = [
  "xhandle",
  "xhandle-workspace-graph",
  "xhandle-project-hazard-analysis",
  "xhandle-hazard-analysis-reset",
  "xhandle-project-reports",
  "xhandle-results-review",
  "xhandle-safety-remediation",
  "xhandle-code-architecture-hazard-analysis",
  "xhandle-code-architecture-assurance",
  "TraceabilityDB",
  "TraceabilityMeta",
  "BaselinesDB",
  "SafetyCaseEvidenceDB",
];
const LOCAL_STORAGE_CATEGORY_DETAILS = {
  codeArchitecture: {
    label: "Code architecture workspace",
    description: "Repository analysis context, architecture metadata, and related diagram state. Removing it clears locally cached code-analysis work but does not change source repositories.",
  },
  projects: {
    label: "Projects, requirements, and diagrams",
    description: "Locally saved project definitions, functional decompositions, requirements, risk registers, and diagram layouts. Removing it can delete project work from this browser.",
  },
  analysis: {
    label: "Safety analysis and review results",
    description: "Generated hazard, safety, review, remediation, safety-case, verification, and traceability results. Removing it clears this locally stored analysis evidence.",
  },
  settings: {
    label: "Application preferences",
    description: "Organization profile, backup preferences, repository selection, collaborator layout, and other non-secret settings. Removing it resets those preferences.",
  },
  credentials: {
    label: "Credentials and API keys",
    description: "Locally cached access tokens and provider keys. Removing them may disconnect integrations or require credentials to be entered again. Never selected automatically.",
  },
  other: {
    label: "Other xHandle browser data",
    description: "Additional xHandle records that do not match a known category. Review carefully before deleting them.",
  },
};
const INDEXED_DB_STORE_DETAILS = {
  "xhandle:copilot_baseline": ["Code architecture analysis", "Generated architecture rows derived from connected source code. Removing them clears cached analysis results, not repository files."],
  "xhandle:code_index": ["Source-code index", "Indexed source files and symbols used by code analysis and source linking. Removing it requires the repository to be indexed again."],
  "xhandle:diagram_positions": ["Code diagram layouts", "Manually arranged positions for code-architecture diagrams. Removing them resets those layouts."],
  "xhandle-results-review:reviewItems": ["Analysis review decisions", "Review statuses, comments, and decisions recorded against generated analysis results."],
  "xhandle-code-architecture-hazard-analysis:hazardAnalysisRuns": ["Code hazard-analysis runs", "Saved code-architecture hazard analyses and their run history."],
  "xhandle-code-architecture-assurance:artifactRows": ["Code assurance artifacts", "Generated assurance artifacts, evidence, and traceability rows for analyzed source code."],
  "xhandle-project-hazard-analysis:analyses": ["Project hazard analyses", "Complete hazard-analysis results saved for each project. Removing them clears results from the Hazard Analysis tab."],
  "xhandle-hazard-analysis-reset:snapshots": ["Hazard-analysis undo snapshots", "Temporary snapshots used to restore a project after clearing its hazard analysis."],
  "xhandle-project-reports:safetyIssueReports": ["Safety issue reports", "Generated stakeholder-facing safety issue reports saved for each project."],
  "xhandle-workspace-graph:workspaces": ["Workspace settings", "Workspace identity and configuration used to organize locally stored engineering work."],
  "xhandle-workspace-graph:projects": ["Workspace project index", "Project entries used to connect artifacts, analyses, evidence, and source material."],
  "xhandle-workspace-graph:folders": ["Workspace folders", "Folder structure used to organize projects and engineering artifacts."],
  "xhandle-workspace-graph:artifacts": ["Engineering artifacts", "Generated and imported engineering artifacts represented in the workspace graph."],
  "xhandle-workspace-graph:relationships": ["Artifact traceability links", "Links showing how requirements, hazards, evidence, reviews, and other artifacts relate to one another."],
  "xhandle-workspace-graph:runs": ["Analysis run history", "Records of analysis and generation runs associated with workspace artifacts."],
  "xhandle-workspace-graph:reviews": ["Workspace reviews", "Review records and decisions associated with engineering artifacts."],
  "xhandle-workspace-graph:evidence": ["Workspace evidence", "Evidence records linked to requirements, hazards, safety cases, and other artifacts."],
  "xhandle-workspace-graph:sourceFiles": ["Workspace source files", "Indexed source-file records used for code traceability and evidence links."],
  "xhandle-workspace-graph:summaries": ["Artifact summaries", "Generated summaries used to make large engineering artifacts easier to navigate."],
  "xhandle-workspace-graph:changeLog": ["Workspace change history", "Recorded workspace changes used for auditability and synchronization."],
  "xhandle-safety-remediation:safetyFindings": ["Safety remediation findings", "Safety-relevant findings selected for code or design remediation."],
  "xhandle-safety-remediation:patchProposals": ["Safety patch proposals", "Proposed source-code changes intended to address safety findings."],
  "xhandle-safety-remediation:reviewDecisions": ["Remediation review decisions", "Reviewer approvals, rejections, and comments for proposed safety changes."],
  "xhandle-safety-remediation:summaryArtifacts": ["Remediation summaries", "Generated summaries of safety findings, decisions, and proposed changes."],
  "xhandle-safety-remediation:verificationRuns": ["Remediation verification runs", "Test and verification results for proposed or applied safety changes."],
  "xhandle-safety-remediation:safetyRemediationEvidence": ["Remediation evidence", "Evidence demonstrating how safety findings were addressed and verified."],
  "TraceabilityDB:Folders": ["Project folders", "Top-level folders used to organize projects in the traceability workspace."],
  "TraceabilityDB:Projects": ["Project records", "Core project definitions and project-level configuration."],
  "TraceabilityDB:Notes": ["Project notes", "Notes and supporting text saved against projects."],
  "TraceabilityDB:RequirementFolders": ["Requirement folders", "Folder hierarchy used to organize project requirements."],
  "TraceabilityDB:Requirements": ["Requirements", "Project requirements and the identifiers used to link them to analyses and evidence."],
  "TraceabilityDB:SafetyCases": ["Safety cases", "Structured safety-case arguments and their project associations."],
  "SafetyCaseEvidenceDB:Attachments": ["Safety-case attachments", "Files and supporting evidence attached to safety-case claims and project nodes."],
  "TraceabilityMeta:shaStore": ["Source revision metadata", "Repository revision identifiers used to detect source-code changes between analyses."],
  "BaselinesDB:Baselines": ["Analysis baselines", "Saved baseline snapshots used to compare current results with an earlier system state."],
};
const INDEXED_DB_DATABASE_DETAILS = {
  "xhandle-workspace-graph": ["Workspace", "Connected workspace records used for navigation and traceability."],
  "xhandle-safety-remediation": ["Safety remediation", "Findings, proposed fixes, review decisions, verification runs, and remediation evidence."],
  TraceabilityDB: ["Project traceability", "Projects, requirements, notes, folders, and safety cases used by the traceability workspace."],
};
const CREDENTIAL_STORAGE_KEYS = new Set([
  "githubToken",
  "jiraToken",
  "xhandle.localAIProviderSettings",
  "xhandle.aiProvider.keys",
]);

function storageByteLength(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return new Blob([text]).size;
}

function formatStorageBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isXHandleLocalStorageKey(key = "") {
  return /^xhandle[:.]|^cbaMeta:|^code-architecture-|^architecture-report:|^diagram:|^functional-|^settings\.|^repoOwner$|^repoName$|^githubSelectedExtensions$|^jira|^google/i.test(key);
}

function localStorageCategoryForKey(key = "") {
  if (CREDENTIAL_STORAGE_KEYS.has(key)) return "credentials";
  if (/^cbaMeta:|^xhandle\.codeArchitecture|^xhandle:code-architecture|^code-architecture-|^architecture-report:|^diagram:github|^xhandle:cba-/i.test(key)) return "codeArchitecture";
  if (/^xhandle\.project|^xhandle\.activeProject|^xhandle:requirements|^xhandle:req-|^xhandle:risk|^functional-|^diagram:positions/i.test(key)) return "projects";
  if (/review|remediation|hazard|safety-case|vnv|traceability/i.test(key)) return "analysis";
  if (/backup|settings\.|organizationProfile|repoOwner|repoName|githubSelectedExtensions|jira|google|copilotDock/i.test(key)) return "settings";
  return "other";
}

function localStorageCategoryLabel(id) {
  return LOCAL_STORAGE_CATEGORY_DETAILS[id]?.label || id;
}

function localStorageCategoryDescription(id) {
  return LOCAL_STORAGE_CATEGORY_DETAILS[id]?.description || LOCAL_STORAGE_CATEGORY_DETAILS.other.description;
}

function openRawIndexedDb(name) {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined" || !name) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(name);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  });
}

async function inspectIndexedDbStore(dbName, storeName) {
  const db = await openRawIndexedDb(dbName);
  if (!db || !db.objectStoreNames.contains(storeName)) {
    try { db?.close(); } catch {}
    return null;
  }
  return new Promise((resolve) => {
    let count = 0;
    let bytes = 0;
    let sampleKey = "";
    try {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        count += 1;
        if (!sampleKey) sampleKey = String(cursor.key || "");
        try { bytes += storageByteLength(cursor.value); } catch {}
        cursor.continue();
      };
      tx.oncomplete = () => {
        try { db.close(); } catch {}
        resolve({ count, bytes, sampleKey });
      };
      tx.onerror = () => {
        try { db.close(); } catch {}
        resolve({ count, bytes, sampleKey, error: tx.error?.message || "Unable to inspect store." });
      };
    } catch (error) {
      try { db.close(); } catch {}
      resolve({ count, bytes, sampleKey, error: error?.message || String(error) });
    }
  });
}

async function clearIndexedDbStore(dbName, storeName) {
  const db = await openRawIndexedDb(dbName);
  if (!db || !db.objectStoreNames.contains(storeName)) {
    try { db?.close(); } catch {}
    return false;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => {
        try { db.close(); } catch {}
        resolve(true);
      };
      tx.onerror = () => {
        try { db.close(); } catch {}
        resolve(false);
      };
    } catch {
      try { db.close(); } catch {}
      resolve(false);
    }
  });
}

function indexedDbStoreLabel(dbName, storeName) {
  const exact = INDEXED_DB_STORE_DETAILS[`${dbName}:${storeName}`];
  if (exact) return exact[0];
  const database = INDEXED_DB_DATABASE_DETAILS[dbName];
  if (database) {
    const readableStore = String(storeName || "records")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/^./, (letter) => letter.toUpperCase());
    return `${database[0]} · ${readableStore}`;
  }
  return "Application data";
}

function indexedDbStoreDescription(dbName, storeName) {
  const exact = INDEXED_DB_STORE_DETAILS[`${dbName}:${storeName}`];
  if (exact) return exact[1];
  const database = INDEXED_DB_DATABASE_DETAILS[dbName];
  if (database) return database[1];
  return "Application records stored locally by xHandle. Removing them may clear saved work or require the related feature to rebuild its data.";
}

export default function SettingsModal({
  onClose,
  onSynced,
  connected: githubConnectedProp = false,
  onBaselineRepo,
  onAIProviderSaved,
  activeProject = null,
  projectOrganizationProfile = null,
  onProjectOrganizationProfileChange,
}) {
  // Quick visibility in console to ensure the app is using the right values
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.info("[xHandle] backendURL =", backendURL, "ACCOUNT_ID =", ACCOUNT_ID);
  }, []);

  // ----- Tab handling -----
  const [tab, setTab] = useState(
    (() => {
      const saved = typeof window !== "undefined" ? localStorage.getItem("settings.activeTab") : "";
      return SETTINGS_TABS.has(saved) ? saved : "openai";
    })()
  );
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("settings.activeTab", tab);
  }, [tab]);

  // ===== Organization profile =====
  const [organizationProfile, setOrganizationProfile] = useState(() => loadOrganizationProfile());
  const [organizationProfileMarkdown, setOrganizationProfileMarkdown] = useState(() => loadOrganizationProfile().markdown);
  const [organizationProfileEnabled, setOrganizationProfileEnabled] = useState(() => loadOrganizationProfile().enabled);
  const [organizationProfileView, setOrganizationProfileView] = useState("edit");
  const [organizationProfileMessage, setOrganizationProfileMessage] = useState("");
  const [projectProfileMode, setProjectProfileMode] = useState(projectOrganizationProfile?.mode || "inherit");
  const [projectProfileOverride, setProjectProfileOverride] = useState(projectOrganizationProfile?.overrideMarkdown || "");
  const organizationProfileFileRef = useRef(null);

  useEffect(() => {
    setProjectProfileMode(projectOrganizationProfile?.mode || "inherit");
    setProjectProfileOverride(projectOrganizationProfile?.overrideMarkdown || "");
  }, [activeProject?.id, projectOrganizationProfile?.mode, projectOrganizationProfile?.overrideMarkdown]);

  const organizationProfileValidation = validateOrganizationProfile(organizationProfileMarkdown);
  const parsedOrganizationProfile = parseOrganizationProfile(organizationProfileMarkdown);
  const effectiveOrganizationContext = buildEffectiveOrganizationProfileContext({
    profile: { ...organizationProfile, enabled: organizationProfileEnabled, markdown: organizationProfileMarkdown },
    projectProfile: { mode: projectProfileMode, overrideMarkdown: projectProfileOverride },
  });

  const handleSaveOrganizationProfile = () => {
    const result = saveOrganizationProfile({
      ...organizationProfile,
      enabled: organizationProfileEnabled,
      markdown: organizationProfileMarkdown,
    });
    setOrganizationProfile(result.profile);
    setOrganizationProfileMarkdown(result.profile.markdown);
    if (result.saved) notifyBackupDataChanged("organization-profile");
    setOrganizationProfileMessage(result.saved
      ? `${result.frontMatterAdded ? "Added profile metadata and saved" : "Saved"} ${getOrganizationProfileIdentity(result.profile)}${result.validation.warnings.length ? ` with ${result.validation.warnings.length} warning${result.validation.warnings.length === 1 ? "" : "s"}` : ""}.`
      : "Resolve the profile validation errors before saving.");
  };

  const handleOrganizationProfileFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      setOrganizationProfileMessage("Choose a Markdown (.md or .markdown) file.");
      return;
    }
    const text = await file.text();
    if (text.length > ORGANIZATION_PROFILE_MAX_CHARS) {
      setOrganizationProfileMessage(`Profile exceeds the ${ORGANIZATION_PROFILE_MAX_CHARS.toLocaleString()} character limit.`);
      return;
    }
    setOrganizationProfileMarkdown(text);
    setOrganizationProfileMessage(`Loaded ${file.name}. Review and save the profile to apply it.`);
  };

  const handleDownloadOrganizationProfile = () => {
    const blob = new Blob([organizationProfileMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const organization = String(parsedOrganizationProfile.metadata.organization || "organization")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "organization";
    link.href = url;
    link.download = `${organization}-profile.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleResetOrganizationProfileTemplate = () => {
    if (!window.confirm("Replace the editor contents with a blank organization-profile template? The saved profile will not change until you click Save profile.")) return;
    const template = createOrganizationProfileRecord();
    setOrganizationProfileMarkdown(template.markdown);
    setOrganizationProfileEnabled(false);
    setOrganizationProfileMessage("Template restored in the editor. Complete it and save when ready.");
  };

  const handleSaveProjectProfile = () => {
    onProjectOrganizationProfileChange?.({
      mode: projectProfileMode,
      overrideMarkdown: projectProfileOverride,
      profileId: organizationProfile.id,
      profileIdentity: getOrganizationProfileIdentity({ ...organizationProfile, markdown: organizationProfileMarkdown }),
      updatedAt: new Date().toISOString(),
    });
    setOrganizationProfileMessage(`Saved organization-profile settings for ${activeProject?.name || "the active project"}.`);
  };

  // ===== GitHub state =====
  const [owner, setOwner] = useState(
    (typeof window !== "undefined" && localStorage.getItem("repoOwner")) || ""
  );
  const [repo, setRepo] = useState(
    (typeof window !== "undefined" && localStorage.getItem("repoName")) || ""
  );
  const [token, setToken] = useState(
    (typeof window !== "undefined" && localStorage.getItem("githubToken")) || ""
  );
  const [analysisContextText, setAnalysisContextText] = useState(
    () => loadGitHubAnalysisContextFromStorage().text
  );
  const [analysisContextFiles, setAnalysisContextFiles] = useState(
    () => loadGitHubAnalysisContextFromStorage().files
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [githubConnected, setGithubConnected] = useState(!!githubConnectedProp);
  useEffect(() => setGithubConnected(!!githubConnectedProp), [githubConnectedProp]);

  const saveAnalysisContextPrefs = ({
    text = analysisContextText,
    files = analysisContextFiles,
  } = {}) => {
    if (typeof window === "undefined") return;
    const normalizedFiles = (files || [])
      .map((file) => ({
        name: String(file?.name || "context.txt").slice(0, 160),
        content: String(file?.content || "").slice(0, MAX_ANALYSIS_CONTEXT_FILE_CHARS),
      }))
      .filter((file) => file.content.trim());
    localStorage.setItem(GITHUB_ANALYSIS_CONTEXT_TEXT_KEY, String(text || ""));
    localStorage.setItem(GITHUB_ANALYSIS_CONTEXT_FILES_KEY, JSON.stringify(normalizedFiles));
  };

  const saveGitHubPrefs = () => {
    if (!owner.trim() || !repo.trim()) {
      setMsg("⚠️ Owner and repo are required.");
      return;
    }
    if (typeof window !== "undefined") {
      localStorage.setItem("repoOwner", owner.trim());
      localStorage.setItem("repoName", repo.trim());
      const t = token.trim();
      if (t) localStorage.setItem("githubToken", t);
      else localStorage.removeItem("githubToken");
    }
    saveAnalysisContextPrefs();
    setMsg("✅ GitHub preferences saved.");
    clearMsgSoon();
  };

  const runRepoSync = async () => {
    try {
      if (!owner.trim() || !repo.trim()) {
        setMsg("⚠️ Please fill in owner and repo first.");
        return;
      }
      setIsSyncing(true);
      setMsg("Saving repo config…");

      const body = token.trim()
        ? { owner: owner.trim(), repo: repo.trim(), token: token.trim() }
        : { owner: owner.trim(), repo: repo.trim() };

      // Save config (DB-backed; fine to keep)
      // Save config
      const r1 = await fetch(`${backendURL}/api/config/repo`, {
        method: "POST",
        ...buildAuthOpts({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const j1 = await r1.json().catch(() => ({}));
      if (!r1.ok || !j1?.ok) throw new Error(j1?.error || `Failed to save repo config (HTTP ${r1.status})`);

      // Verify connection
      const r2 = await fetch(`${backendURL}/api/github/repo-files`, {
        method: "POST",
        ...buildAuthOpts({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const j2 = await r2.json().catch(() => ({}));
      let count = Array.isArray(j2) ? j2.length : 0;
      if (!r2.ok) {
        const defaultBranch = await getDefaultBranch(owner.trim(), repo.trim(), token.trim() || undefined);
        const files = await listRepoFilesViaGitHub(owner.trim(), repo.trim(), token.trim() || undefined, defaultBranch);
        count = Array.isArray(files) ? files.length : 0;
      }
      setMsg(`✅ Connected. Found ${count} repo files.`);
      setGithubConnected(true);
      onSynced && onSynced({ ok: true, filesFound: count });
      clearMsgSoon();
    } catch (e) {
      setMsg(`❌ ${e?.message || e}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // ===== AI provider integration =====
  const [aiProvider, setAiProvider] = useState("openai");
  const [providerKey, setProviderKey] = useState("");
  const [providerModel, setProviderModel] = useState(() =>
    getStoredAIProviderModelPreference("openai", { includeDefault: true })
  );
  const [providerEffort, setProviderEffort] = useState(() =>
    getStoredAIProviderEffortPreference("openai")
  );
  const [providerMsg, setProviderMsg] = useState("");
  const [providerConnected, setProviderConnected] = useState(false);
  const [providerStatus, setProviderStatus] = useState(null);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerModelsByProvider, setProviderModelsByProvider] = useState({});
  const [providerModelsBusy, setProviderModelsBusy] = useState(false);
  const [providerModelsMsg, setProviderModelsMsg] = useState("");
  const [backupState, setBackupState] = useState(getLocalBackupState());
  const [backupMsg, setBackupMsg] = useState("");
  const [storageInventory, setStorageInventory] = useState(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageMsg, setStorageMsg] = useState("");
  const [selectedStorageItems, setSelectedStorageItems] = useState({});
  const storageTabScanStartedRef = useRef(false);
  const fileInputRef = useRef(null);
  const selectedSavedProvider = providerStatus?.savedProviders?.find(
    (row) => row.provider === normalizeAIProvider(aiProvider)
  );
  const selectedModelProfile = getProviderModelProfile(aiProvider, providerModel);
  const selectedModelSupportsEffort = supportsAIProviderEffort(aiProvider, providerModel);
  const providerModelOptions = (() => {
    const provider = normalizeAIProvider(aiProvider);
    const records = providerModelsByProvider[provider] || getProviderModelOptions(provider);
    const normalizedRecords = records
      .map((record) => ({
        value: record.value || record.id,
        label: record.label || record.displayName || record.id || record.value,
        source: record.source || "fallback",
      }))
      .filter((record) => record.value);
    const currentModel = normalizeProviderModel(provider, providerModel);
    if (currentModel && !normalizedRecords.some((record) => record.value === currentModel)) {
      normalizedRecords.unshift({
        value: currentModel,
        label: `${currentModel} (custom)`,
        source: "custom",
      });
    }
    return normalizedRecords;
  })();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetchUserAIProviderSettings();
        if (!alive || !data) return;
        setProviderStatus(data);
        const provider = normalizeAIProvider(data.provider);
        setAiProvider(provider);
        setProviderModel(normalizeProviderModel(provider, data.selectedModel));
        setProviderEffort(getStoredAIProviderEffortPreference(provider));
        setProviderConnected(!!data.savedProviders?.length);
      } catch (e) {
        if (!alive) return;
        setProviderMsg(`❌ ${e?.message || e}`);
        clearProviderMsgSoon();
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const provider = normalizeAIProvider(aiProvider);
    const savedModel =
      selectedSavedProvider?.selectedModel ||
      getStoredAIProviderModelPreference(provider, { includeDefault: true });
    setProviderModel(normalizeProviderModel(provider, savedModel));
    setProviderEffort(getStoredAIProviderEffortPreference(provider));
  }, [aiProvider, selectedSavedProvider?.selectedModel]);

  const loadProviderModels = async (providerInput = aiProvider, options = {}) => {
    const provider = normalizeAIProvider(providerInput);
    setProviderModelsBusy(true);
    if (options.refresh) setProviderModelsMsg("");
    try {
      const models = await fetchProviderModelRecords(provider, {
        backendURL,
        accountId: ACCOUNT_ID,
        accessToken: getLocalAccessToken(),
        refresh: options.refresh,
      });
      setProviderModelsByProvider((current) => ({ ...current, [provider]: models }));
      setProviderModelsMsg(
        models.some((model) => model.source === "provider")
          ? "Loaded current provider models."
          : "Using fallback models."
      );
    } catch (e) {
      setProviderModelsMsg(`Using fallback models: ${e?.message || e}`);
    } finally {
      setProviderModelsBusy(false);
    }
  };

  useEffect(() => {
    loadProviderModels(aiProvider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiProvider]);

  const refreshStorageInventory = async () => {
    setStorageBusy(true);
    setStorageMsg("");
    try {
      const usage = typeof navigator !== "undefined" && navigator.storage?.estimate
        ? await navigator.storage.estimate().catch(() => null)
        : null;
      const localGroups = {};
      if (typeof localStorage !== "undefined") {
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (!key || !isXHandleLocalStorageKey(key)) continue;
          const value = localStorage.getItem(key) || "";
          const groupId = localStorageCategoryForKey(key);
          if (!localGroups[groupId]) {
            localGroups[groupId] = {
              id: `localStorage:${groupId}`,
              kind: "localStorage",
              groupId,
              label: localStorageCategoryLabel(groupId),
              description: localStorageCategoryDescription(groupId),
              bytes: 0,
              count: 0,
              keys: [],
              dangerous: groupId === "credentials",
            };
          }
          localGroups[groupId].bytes += storageByteLength(value);
          localGroups[groupId].count += 1;
          localGroups[groupId].keys.push(key);
        }
      }

      const indexedDbItems = [];
      for (const dbName of STORAGE_DATABASES) {
        const db = await openRawIndexedDb(dbName);
        if (!db) continue;
        const storeNames = Array.from(db.objectStoreNames || []);
        try { db.close(); } catch {}
        for (const storeName of storeNames) {
          const inspected = await inspectIndexedDbStore(dbName, storeName);
          if (!inspected) continue;
          indexedDbItems.push({
            id: `indexedDB:${dbName}:${storeName}`,
            kind: "indexedDB",
            dbName,
            storeName,
            label: indexedDbStoreLabel(dbName, storeName),
            description: indexedDbStoreDescription(dbName, storeName),
            bytes: inspected.bytes || 0,
            count: inspected.count || 0,
            error: inspected.error || "",
          });
        }
      }

      const items = [
        ...Object.values(localGroups),
        ...indexedDbItems,
      ].sort((a, b) => Number(b.bytes || 0) - Number(a.bytes || 0));
      setStorageInventory({
        usageBytes: usage?.usage || 0,
        quotaBytes: usage?.quota || 0,
        items,
        refreshedAt: new Date().toISOString(),
      });
      setSelectedStorageItems((current) => {
        const allowedIds = new Set(items.map((item) => item.id));
        return Object.fromEntries(Object.entries(current || {}).filter(([id]) => allowedIds.has(id)));
      });
    } catch (error) {
      setStorageMsg(`❌ ${error?.message || error}`);
    } finally {
      setStorageBusy(false);
    }
  };

  useEffect(() => {
    if (tab !== "storage") {
      storageTabScanStartedRef.current = false;
      return;
    }
    if (storageTabScanStartedRef.current) return;
    storageTabScanStartedRef.current = true;
    refreshStorageInventory();
    // The scan intentionally runs once each time the Storage tab is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    let alive = true;
    initializeLocalBackupRuntime()
      .then(() => {
        if (!alive) return;
        setBackupState(getLocalBackupState());
      })
      .catch((e) => {
        if (!alive) return;
        setBackupMsg(`❌ ${e?.message || e}`);
      });

    const unsubscribe = subscribeToLocalBackup((next) => {
      if (alive) setBackupState(next);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const saveAIProviderPrefs = async () => {
    const provider = normalizeAIProvider(aiProvider);
    const selectedModel = normalizeProviderModel(provider, providerModel);
    const selectedEffort = providerEffort;
    const usingSavedKey = !providerKey.trim() && !!selectedSavedProvider;
    const isActiveSavedProvider = providerStatus?.provider === provider && !!selectedSavedProvider;
    storeAIProviderModelPreference(provider, selectedModel);
    storeAIProviderEffortPreference(provider, selectedEffort);

    if (usingSavedKey && selectedSavedProvider?.hasApiKey === false) {
      setProviderMsg(`⚠️ Re-enter your ${getAIProviderLabel(provider)} API key to use it locally.`);
      clearProviderMsgSoon();
      return;
    }

    if (isActiveSavedProvider && !providerKey.trim()) {
      setProviderModel(selectedModel);
      const nextSavedProviders = (providerStatus?.savedProviders || []).map((saved) =>
        saved.provider === provider ? { ...saved, selectedModel, selectedEffort } : saved
      );
      const nextStatus = {
        ...providerStatus,
        provider,
        selectedModel,
        selectedEffort,
        savedProviders: nextSavedProviders,
      };
      setProviderStatus(nextStatus);
      setProviderConnected(!!nextStatus.savedProviders?.length);
      setProviderMsg(`✅ ${getAIProviderLabel(provider)} model saved.`);
      onAIProviderSaved && onAIProviderSaved(nextStatus);
      clearProviderMsgSoon();
      return;
    }

    if (!usingSavedKey) {
      const validationError = validateProviderApiKey(provider, providerKey);
      if (validationError) {
        setProviderMsg(`⚠️ ${validationError}`);
        clearProviderMsgSoon();
        return;
      }
    }

    setProviderBusy(true);
    try {
      const result = await saveUserAIProviderSettings(
        provider,
        providerKey,
        usingSavedKey ? { activateOnly: true, selectedModel, selectedEffort } : { selectedModel, selectedEffort }
      );
      const resultModel = normalizeProviderModel(provider, result?.selectedModel || selectedModel);
      storeAIProviderModelPreference(provider, resultModel);
      storeAIProviderEffortPreference(provider, result?.selectedEffort || selectedEffort);
      const nextStatus = {
        provider,
        last4: result?.last4 || selectedSavedProvider?.last4 || null,
        verified: !!result?.verified,
        selectedModel: resultModel,
        selectedEffort: result?.selectedEffort || selectedEffort,
        savedProviders: result?.savedProviders || providerStatus?.savedProviders || [],
      };
      setProviderStatus(nextStatus);
      setProviderConnected(!!nextStatus.savedProviders?.length);
      setProviderKey("");
      setProviderMsg(
        usingSavedKey
          ? `✅ Switched to ${getAIProviderLabel(provider)}.`
          : `✅ ${getAIProviderLabel(provider)} key saved.`
      );
      onAIProviderSaved && onAIProviderSaved(nextStatus);
    } catch (e) {
      setProviderMsg(`❌ ${e?.message || e}`);
    } finally {
      setProviderBusy(false);
      clearProviderMsgSoon();
    }
  };

  const clearAIProviderKey = async () => {
    const provider = normalizeAIProvider(aiProvider);
    if (!selectedSavedProvider) return;
    const confirmed = window.confirm(`Clear the saved ${getAIProviderLabel(provider)} API key?`);
    if (!confirmed) return;

    setProviderBusy(true);
    try {
      const result = await clearUserAIProviderSettings(provider);
      const nextStatus = result?.savedProviders?.length
        ? {
            provider: result.provider,
            last4: result.last4,
            verified: !!result.verified,
            selectedModel: normalizeProviderModel(result.provider, result.selectedModel),
            selectedEffort: result.selectedEffort || getStoredAIProviderEffortPreference(result.provider),
            savedProviders: result.savedProviders,
          }
        : null;
      setProviderStatus(nextStatus);
      setProviderConnected(!!nextStatus?.savedProviders?.length);
      setProviderKey("");
      setProviderMsg(`✅ Cleared ${getAIProviderLabel(provider)} key.`);
      onAIProviderSaved && onAIProviderSaved(nextStatus);
    } catch (e) {
      setProviderMsg(`❌ ${e?.message || e}`);
    } finally {
      setProviderBusy(false);
      clearProviderMsgSoon();
    }
  };

  const toggleStorageItem = (itemId) => {
    setSelectedStorageItems((current) => ({
      ...current,
      [itemId]: !current?.[itemId],
    }));
  };

  const setAllStorageItemsSelected = (checked, { includeCredentials = false } = {}) => {
    const items = storageInventory?.items || [];
    setSelectedStorageItems(Object.fromEntries(
      items
        .filter((item) => includeCredentials || !item.dangerous)
        .map((item) => [item.id, checked])
    ));
  };

  const deleteSelectedStorageItems = async () => {
    const items = (storageInventory?.items || []).filter((item) => selectedStorageItems[item.id]);
    if (!items.length) {
      setStorageMsg("Select at least one storage category to delete.");
      return;
    }
    const includesCredentials = items.some((item) => item.dangerous);
    const label = items.length === 1 ? items[0].label : `${items.length} storage categories`;
    const confirmed = window.confirm(
      `Delete ${label}? This removes local browser data for this xHandle installation.${includesCredentials ? "\n\nCredentials/API keys are included in this deletion." : ""}\n\nThis cannot be undone unless you have a backup.`
    );
    if (!confirmed) return;

    setStorageBusy(true);
    try {
      for (const item of items) {
        if (item.kind === "localStorage") {
          (item.keys || []).forEach((key) => {
            try { localStorage.removeItem(key); } catch {}
          });
        } else if (item.kind === "indexedDB") {
          await clearIndexedDbStore(item.dbName, item.storeName);
        }
      }
      window.dispatchEvent?.(new CustomEvent("xhandle:data-changed", { detail: { source: "settings-storage-cleanup" } }));
      setSelectedStorageItems({});
      setStorageMsg(`✅ Deleted ${label}.`);
      await refreshStorageInventory();
    } catch (error) {
      setStorageMsg(`❌ ${error?.message || error}`);
    } finally {
      setStorageBusy(false);
    }
  };

  // ----- helpers -----
  function buildAuthOpts(extraHeaders = {}) {
    const bearer = getLocalAccessToken();
    return {
      credentials: "include", // ← send cookies
      headers: {
        "x-account-id": ACCOUNT_ID,
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...extraHeaders,
      },
    };
  }
  function clearMsgSoon() { setTimeout(() => setMsg(""), 2000); }
  function clearProviderMsgSoon() { setTimeout(() => setProviderMsg(""), 2500); }
  function clearBackupMsgSoon() { setTimeout(() => setBackupMsg(""), 3000); }

  // ===== File-type chooser (adds to baseline; does not change Repo Sync) =====
  const [extModalOpen, setExtModalOpen] = useState(false);
  const [filesForModal, setFilesForModal] = useState([]);
  const resolverRef = useRef(null);

  const awaitExtSelection = (files) =>
    new Promise((resolve) => {
      setFilesForModal(files || []);
      setExtModalOpen(true);
      resolverRef.current = resolve;
    });

  const handleExtConfirm = (exts) => {
    setExtModalOpen(false);
    resolverRef.current?.(Array.isArray(exts) ? exts : []);
  };
  const handleExtCancel = () => {
    setExtModalOpen(false);
    resolverRef.current?.([]);
  };

  const handleAnalysisContextFiles = async (event) => {
    const selected = Array.from(event.target.files || []);
    if (!selected.length) return;
    try {
      const loaded = await Promise.all(
        selected.map(async (file) => ({
          name: file.name,
          content: (await file.text()).slice(0, MAX_ANALYSIS_CONTEXT_FILE_CHARS),
        }))
      );
      const nextFiles = [...analysisContextFiles, ...loaded].filter((file) => file.content.trim());
      setAnalysisContextFiles(nextFiles);
      saveAnalysisContextPrefs({ files: nextFiles });
      setMsg(`✅ Added ${loaded.length} context file${loaded.length === 1 ? "" : "s"}.`);
      clearMsgSoon();
    } catch (error) {
      setMsg(`❌ Could not read context file: ${error?.message || error}`);
    } finally {
      event.target.value = "";
    }
  };

  const removeAnalysisContextFile = (index) => {
    const nextFiles = analysisContextFiles.filter((_, fileIndex) => fileIndex !== index);
    setAnalysisContextFiles(nextFiles);
    saveAnalysisContextPrefs({ files: nextFiles });
  };

  const clearAnalysisContext = () => {
    setAnalysisContextText("");
    setAnalysisContextFiles([]);
    saveAnalysisContextPrefs({ text: "", files: [] });
    setMsg("✅ Analysis context cleared.");
    clearMsgSoon();
  };

  const runBaselineWithChooser = async () => {
    try {
      if (!owner.trim() || !repo.trim()) {
        setMsg("⚠️ Please fill in owner and repo first.");
        return;
      }
      setIsSyncing(true);
      setMsg("Scanning repo for files…");

      const defaultBranch = await getDefaultBranch(owner.trim(), repo.trim(), token.trim() || undefined);
      const repoFiles = filterSelectableRepoFiles(
        await listRepoFilesViaGitHub(owner.trim(), repo.trim(), token.trim() || undefined, defaultBranch)
      );
      if (!Array.isArray(repoFiles) || repoFiles.length === 0) {
        throw new Error("No files found in this repo.");
      }

      // Ask user which extensions to include
      const selectedExtensions = await awaitExtSelection(repoFiles);
      if (!selectedExtensions.length) {
        setMsg("ℹ️ Baseline cancelled (no file types selected).");
        clearMsgSoon();
        return;
      }

      // Persist selection for future runs
      try {
        localStorage.setItem("githubSelectedExtensions", JSON.stringify(selectedExtensions));
      } catch {}
      saveAnalysisContextPrefs();

      setMsg(`✅ Selected ${selectedExtensions.length} file type(s). Starting baseline…`);
      clearMsgSoon();

      // Hand off to your existing baseline callback (unchanged)
      onBaselineRepo && onBaselineRepo({
        owner: owner.trim(),
        repo: repo.trim(),
        token: token.trim(),
        selectedExtensions,
        analysisContext: {
          text: analysisContextText,
          files: analysisContextFiles,
        },
      });    } catch (e) {
      setMsg(`❌ ${e?.message || e}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleChooseBackupFolder = async () => {
    try {
      const folderName = await chooseBackupFolder();
      setBackupMsg(`✅ Backup folder selected: ${folderName}`);
      clearBackupMsgSoon();
    } catch (e) {
      setBackupMsg(`❌ ${e?.message || e}`);
      clearBackupMsgSoon();
    }
  };

  const handleAutoBackupToggle = async (enabled) => {
    try {
      await setAutoBackupEnabled(enabled);
    } catch (e) {
      setBackupMsg(`❌ ${e?.message || e}`);
      clearBackupMsgSoon();
    }
  };

  const handleBackupNow = async () => {
    try {
      await backupNow();
      setBackupMsg("✅ Backup saved to your computer.");
      clearBackupMsgSoon();
    } catch (e) {
      setBackupMsg(`❌ ${e?.message || e}`);
      clearBackupMsgSoon();
    }
  };

  const handleDownloadBackup = async () => {
    try {
      await downloadBackupNow();
      setBackupMsg("✅ Backup file downloaded.");
      clearBackupMsgSoon();
    } catch (e) {
      setBackupMsg(`❌ ${e?.message || e}`);
      clearBackupMsgSoon();
    }
  };

  const handleRestoreConfiguredBackup = async () => {
    const latest = backupState.latestBackupSummary;
    const preview = latest?.createdAt
      ? `\n\nLatest backup: ${new Date(latest.createdAt).toLocaleString()}${Number.isFinite(latest.projectCount) ? `\nProjects: ${latest.projectCount}` : ""}`
      : "";
    const confirmed = window.confirm(
      `Restore data from the selected backup folder? This will replace the current browser copy of your xHandle data.${preview}`
    );
    if (!confirmed) return;

    try {
      await restoreFromConfiguredBackup();
    } catch (e) {
      setBackupMsg(`❌ ${e?.message || e}`);
      clearBackupMsgSoon();
    }
  };

  const handleRestoreFileSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const confirmed = window.confirm(
      "Restore data from this backup file? This will replace the current browser copy of your xHandle data."
    );
    if (!confirmed) return;

    try {
      await restoreFromBackupFile(file);
    } catch (e) {
      setBackupMsg(`❌ ${e?.message || e}`);
      clearBackupMsgSoon();
    }
  };

  return (
    <div className="xhandle-modal-viewport fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-[920px] max-w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
        <div className="shrink-0 px-5 pt-5">
          <div className="text-lg font-semibold mb-4">Settings</div>

          {/* Tabs */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <TabButton label="AI Provider" active={tab === "openai"} onClick={() => setTab("openai")} />
            <TabButton label="Organization Profile" active={tab === "organization-profile"} onClick={() => setTab("organization-profile")} />
            <TabButton label="VS Code" active={tab === "vscode"} onClick={() => setTab("vscode")} />
            <TabButton label="Backup" active={tab === "backup"} onClick={() => setTab("backup")} />
            <TabButton label="Storage" active={tab === "storage"} onClick={() => setTab("storage")} />
          </div>
        </div>

        {/* Panels scroll independently so their action rows cannot fall behind the footer. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {tab === "organization-profile" && (
          <section className="space-y-4">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
              The organization profile calibrates terminology, safety policy, architecture conventions, risk classification, and assurance expectations. Explicit project facts and user instructions take precedence.
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-800">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={organizationProfileEnabled}
                  onChange={(event) => setOrganizationProfileEnabled(event.target.checked)}
                />
                Enable as the organization default
              </label>
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 text-xs">
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 ${organizationProfileView === "edit" ? "bg-white font-medium shadow-sm" : "text-gray-600"}`}
                  onClick={() => setOrganizationProfileView("edit")}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 ${organizationProfileView === "preview" ? "bg-white font-medium shadow-sm" : "text-gray-600"}`}
                  onClick={() => setOrganizationProfileView("preview")}
                >
                  Preview
                </button>
              </div>
            </div>

            {organizationProfileView === "edit" ? (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-800">Organization profile Markdown</label>
                <textarea
                  className="min-h-[360px] w-full rounded-xl border border-gray-300 bg-white px-3 py-3 font-mono text-xs leading-5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  value={organizationProfileMarkdown}
                  onChange={(event) => setOrganizationProfileMarkdown(event.target.value)}
                  spellCheck={false}
                  aria-label="Organization profile Markdown"
                />
                <div className="flex justify-between gap-3 text-xs text-gray-500">
                  <span>YAML metadata plus governed Markdown sections.</span>
                  <span className={organizationProfileMarkdown.length > ORGANIZATION_PROFILE_MAX_CHARS ? "text-red-600" : ""}>
                    {organizationProfileMarkdown.length.toLocaleString()} / {ORGANIZATION_PROFILE_MAX_CHARS.toLocaleString()} characters
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-2 rounded-xl border bg-gray-50 p-3 text-sm sm:grid-cols-2">
                  <div><span className="font-medium">Organization:</span> {String(parsedOrganizationProfile.metadata.organization || "Not defined")}</div>
                  <div><span className="font-medium">Version:</span> {String(parsedOrganizationProfile.metadata.profile_version || "Not defined")}</div>
                  <div><span className="font-medium">Status:</span> {String(parsedOrganizationProfile.metadata.status || "Not defined")}</div>
                  <div><span className="font-medium">Approved by:</span> {String(parsedOrganizationProfile.metadata.approved_by || "Not defined")}</div>
                  <div><span className="font-medium">Effective date:</span> {String(parsedOrganizationProfile.metadata.effective_date || "Not defined")}</div>
                  <div><span className="font-medium">Sections:</span> {Object.keys(parsedOrganizationProfile.sections).length}</div>
                </div>
                <pre className="max-h-[380px] overflow-auto whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-4 text-xs leading-5 text-gray-800">
                  {organizationProfileMarkdown}
                </pre>
              </div>
            )}

            {(organizationProfileValidation.errors.length > 0 || organizationProfileValidation.warnings.length > 0) && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className={`rounded-xl border p-3 text-xs ${organizationProfileValidation.errors.length ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800"}`}>
                  <div className="font-semibold">Validation</div>
                  {organizationProfileValidation.errors.length
                    ? organizationProfileValidation.errors.map((message) => <div key={message} className="mt-1">• {message}</div>)
                    : <div className="mt-1">No blocking errors.</div>}
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="font-semibold">Governance warnings</div>
                  {organizationProfileValidation.warnings.length
                    ? organizationProfileValidation.warnings.slice(0, 8).map((message) => <div key={message} className="mt-1">• {message}</div>)
                    : <div className="mt-1">Profile metadata and expected sections are complete.</div>}
                  {organizationProfileValidation.warnings.length > 8 && <div className="mt-1">• {organizationProfileValidation.warnings.length - 8} more warnings</div>}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={handleSaveOrganizationProfile}
              >
                Save profile
              </button>
              <button type="button" className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => organizationProfileFileRef.current?.click()}>
                Import Markdown
              </button>
              <input ref={organizationProfileFileRef} type="file" className="hidden" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={handleOrganizationProfileFile} />
              <button type="button" className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" onClick={handleDownloadOrganizationProfile}>
                Download Markdown
              </button>
              <button type="button" className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100" onClick={handleResetOrganizationProfileTemplate}>
                Reset editor to template
              </button>
            </div>

            <div className="rounded-xl border border-gray-200 p-4">
              <div className="font-semibold text-gray-900">Active project application</div>
              {activeProject ? (
                <div className="mt-3 space-y-3">
                  <div className="text-sm text-gray-600">Configure how <strong>{activeProject.name}</strong> uses the organization baseline.</div>
                  <label className="block text-sm font-medium text-gray-700">Profile selection</label>
                  <select
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    value={projectProfileMode}
                    onChange={(event) => setProjectProfileMode(event.target.value)}
                  >
                    <option value="inherit">Use organization default</option>
                    <option value="disabled">Do not use an organization profile</option>
                  </select>
                  <label className="block text-sm font-medium text-gray-700">Project-specific override</label>
                  <textarea
                    className="min-h-28 w-full rounded-lg border px-3 py-2 text-sm"
                    value={projectProfileOverride}
                    onChange={(event) => setProjectProfileOverride(event.target.value)}
                    placeholder="Add project-specific terminology, product architecture, operating constraints, risk-policy tailoring, or exceptions. This content overrides conflicting organization guidance for this project only."
                    disabled={projectProfileMode === "disabled"}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100" onClick={handleSaveProjectProfile}>
                      Save project application
                    </button>
                    <span className="text-xs text-gray-500">
                      Effective context: {effectiveOrganizationContext ? `${effectiveOrganizationContext.length.toLocaleString()} characters` : "disabled or invalid"}
                    </span>
                  </div>
                  <details className="rounded-lg border bg-gray-50 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-gray-700">Preview effective AI context</summary>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-5 text-gray-700">{effectiveOrganizationContext || "No organization profile context will be supplied for this project."}</pre>
                  </details>
                </div>
              ) : (
                <p className="mt-2 text-sm text-gray-500">Select a project to configure a project override and preview its effective context.</p>
              )}
            </div>

            {organizationProfileMessage && <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700" aria-live="polite">{organizationProfileMessage}</div>}
            <div className="flex justify-end"><button className="px-3 py-2 text-sm" onClick={onClose}>Close</button></div>
          </section>
        )}

        {false && tab === "github" && (
          <section className="space-y-3">
            <Field label="Repo Owner" placeholder="vercel" value={owner} onChange={setOwner} />
            <Field label="Repo Name" placeholder="next.js" value={repo} onChange={setRepo} />
            <Field
              label="GitHub Token (optional)"
              placeholder="ghp_…  (leave blank for public repos)"
              type="password"
              value={token}
              onChange={setToken}
              helper="Stored locally in your browser. Required for private repos or higher rate limits."
            />

            <div className="rounded border border-gray-200 p-3 space-y-3">
              <div>
                <label className="text-sm font-medium">Analysis Context</label>
                <textarea
                  className="mt-1 min-h-24 w-full rounded border px-3 py-2 text-sm"
                  placeholder="Add mission goals, system overview, interface notes, terminology, architecture assumptions, or anything the code alone may not explain."
                  value={analysisContextText}
                  onChange={(event) => setAnalysisContextText(event.target.value)}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Used with the repo README to build a concise system understanding before GitHub baseline analysis.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200">
                  Upload Context Files
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    accept=".txt,.md,.markdown,.rst,.json,.yaml,.yml,.csv,.xml,.html,.log,.ini,.cfg,.toml"
                    onChange={handleAnalysisContextFiles}
                  />
                </label>
                <button
                  type="button"
                  className="rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
                  onClick={clearAnalysisContext}
                  disabled={!analysisContextText && analysisContextFiles.length === 0}
                >
                  Clear Context
                </button>
              </div>

              {analysisContextFiles.length > 0 && (
                <div className="space-y-1">
                  {analysisContextFiles.map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between gap-2 rounded bg-gray-50 px-2 py-1 text-xs"
                    >
                      <span className="truncate">
                        {file.name} · {Math.ceil(String(file.content || "").length / 1024)} KB
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded px-2 py-1 text-gray-600 hover:bg-gray-200"
                        onClick={() => removeAnalysisContextFile(index)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                className="bg-gray-100 hover:bg-gray-200 rounded px-3 py-2"
                onClick={saveGitHubPrefs}
                disabled={isSyncing}
              >
                Save
              </button>

              {githubConnected ? (
                <button
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-2"
                  onClick={runBaselineWithChooser}
                  disabled={isSyncing}
                  title="Run baseline analysis on this repo"
                >
                  Baseline Repo
                </button>
              ) : (
                <button
                  className="bg-purple-600 hover:bg-purple-700 text-white rounded px-3 py-2"
                  onClick={runRepoSync}
                  disabled={isSyncing}
                >
                  {isSyncing ? "Syncing…" : "Repo Sync"}
                </button>
              )}

              <button className="ml-auto px-3 py-2" onClick={onClose}>
                Close
              </button>
            </div>

            {!!msg && <div className="mt-1 text-sm">{msg}</div>}
          </section>
        )}

        {tab === "openai" && (
          <section className="space-y-3">
            <div className="text-sm text-gray-600">
              Choose one AI provider at a time. Your API key is saved encrypted to your user profile and used by the backend for all model requests.
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">AI Provider</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm bg-white"
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
                disabled={providerBusy}
              >
                {AI_PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-sm font-medium text-gray-700">Model</label>
                <button
                  type="button"
                  className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  onClick={() => loadProviderModels(aiProvider, { refresh: true })}
                  disabled={providerBusy || providerModelsBusy}
                >
                  {providerModelsBusy ? "Refreshing..." : "Refresh models"}
                </button>
              </div>
              <select
                className="w-full border rounded px-3 py-2 text-sm bg-white"
                value={normalizeProviderModel(aiProvider, providerModel)}
                onChange={(e) => {
                  const provider = normalizeAIProvider(aiProvider);
                  const nextModel = normalizeProviderModel(provider, e.target.value);
                  setProviderModel(nextModel);
                  storeAIProviderModelPreference(provider, nextModel, {
                    setActive: providerStatus?.provider === provider,
                  });
                }}
                disabled={providerBusy || providerModelsBusy}
              >
                {providerModelOptions.map((option) => (
                  <option key={`${option.source}:${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                className="w-full border rounded px-3 py-2 text-sm bg-white"
                value={providerModel}
                onChange={(e) => setProviderModel(e.target.value)}
                placeholder="Custom model ID"
                disabled={providerBusy}
              />
              <p className="text-xs text-gray-500">
                {selectedModelProfile?.description ||
                  providerModelsMsg ||
                  `Defaults to ${getDefaultProviderModel(aiProvider)}.`}
              </p>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700" htmlFor="ai-provider-effort">
                Effort
              </label>
              {selectedModelSupportsEffort ? (
                <>
                  <select
                    id="ai-provider-effort"
                    aria-label="AI provider reasoning effort"
                    className="w-full rounded border bg-white px-3 py-2 text-sm"
                    value={providerEffort}
                    onChange={(event) => {
                      const effort = event.target.value;
                      setProviderEffort(effort);
                      storeAIProviderEffortPreference(aiProvider, effort);
                    }}
                    disabled={providerBusy}
                  >
                    {AI_PROVIDER_EFFORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500">
                    {AI_PROVIDER_EFFORT_OPTIONS.find((option) => option.value === providerEffort)?.description} This preference applies to Collaborator, hazard analysis, and other AI workflows using this provider.
                  </p>
                </>
              ) : (
                <>
                  <select id="ai-provider-effort" className="w-full rounded border bg-gray-50 px-3 py-2 text-sm text-gray-500" disabled value="automatic">
                    <option value="automatic">Automatic (model default)</option>
                  </select>
                  <p className="text-xs text-gray-500">
                    This model does not expose a configurable reasoning-effort control through its API.
                  </p>
                </>
              )}
            </div>
            {selectedModelProfile && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Selected model guide</div>
                    <div className="font-semibold text-gray-900">{selectedModelProfile.label}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <MetricPill label="Speed" value={selectedModelProfile.speed} />
                    <MetricPill label="Intelligence" value={selectedModelProfile.intelligence} />
                  </div>
                </div>
                <div className="mt-2 text-xs leading-5 text-gray-600">
                  <span className="font-medium text-gray-700">Best for:</span> {selectedModelProfile.bestFor}
                </div>
              </div>
            )}
            <Field
              label={`${getAIProviderLabel(aiProvider)} API Key`}
              placeholder={getProviderKeyPlaceholder(aiProvider)}
              type="password"
              value={providerKey}
              onChange={setProviderKey}
              helper={
                selectedSavedProvider && !providerKey.trim()
                  ? selectedSavedProvider.hasApiKey === false
                    ? `${getProviderKeyHelpText(aiProvider)} Re-enter the full key to use it locally.`
                    : `${getProviderKeyHelpText(aiProvider)} Saved key on file ends in ${selectedSavedProvider.last4}. Leave this blank to switch back to it.`
                  : getProviderKeyHelpText(aiProvider)
              }
            />

            {providerStatus?.last4 && (
              <div className="text-xs text-gray-500">
                Active provider: <b>{getAIProviderLabel(providerStatus.provider)}</b> • Model: <b>{normalizeProviderModel(providerStatus.provider, providerStatus.selectedModel)}</b>
                {supportsAIProviderEffort(providerStatus.provider, providerStatus.selectedModel) && <> • Effort: <b>{providerStatus.selectedEffort || getStoredAIProviderEffortPreference(providerStatus.provider)}</b></>}
                {' '}• Last 4: <b>{providerStatus.last4}</b> • {providerStatus.verified ? "Verified ✓" : "Saved, not yet verified"}
              </div>
            )}

            {!!providerStatus?.savedProviders?.length && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-gray-600">Saved providers</div>
                <div className="flex flex-wrap gap-2">
                  {providerStatus.savedProviders.map((saved) => {
                    const isActive = saved.provider === providerStatus.provider;
                    return (
                      <button
                        key={saved.provider}
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs ${
                          isActive
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                            : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                        }`}
                        onClick={() => {
                          setAiProvider(saved.provider);
                          setProviderKey("");
                        }}
                        disabled={providerBusy}
                        title={`Last 4: ${saved.last4}`}
                      >
                        {getAIProviderLabel(saved.provider)} • {normalizeProviderModel(saved.provider, saved.selectedModel)}
                        {supportsAIProviderEffort(saved.provider, saved.selectedModel) ? ` • ${saved.selectedEffort || getStoredAIProviderEffortPreference(saved.provider)} effort` : ""}
                        {` • •••• ${saved.last4} ${isActive ? "• Active" : ""}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                className="bg-gray-100 hover:bg-gray-200 rounded px-3 py-2"
                onClick={saveAIProviderPrefs}
                disabled={providerBusy}
              >
                {providerBusy ? "Saving…" : (!providerKey.trim() && selectedSavedProvider ? "Switch Provider" : "Save")}
              </button>
              {selectedSavedProvider && (
                <button
                  type="button"
                  className="rounded px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  onClick={clearAIProviderKey}
                  disabled={providerBusy}
                >
                  Clear Key
                </button>
              )}
              {providerConnected ? (
                <span className="text-xs text-emerald-600">Configured ✓</span>
              ) : (
                <span className="text-xs text-gray-500">Not configured</span>
              )}
              <button className="ml-auto px-3 py-2" onClick={onClose}>
                Close
              </button>
            </div>

            {!!providerMsg && <div className="mt-1 text-sm">{providerMsg}</div>}
          </section>
        )}

        {tab === "backup" && (
          <section className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="text-sm font-medium text-slate-900">Browser storage stays primary</div>
              <p className="text-sm text-slate-600">
                xHandle still works from your browser storage first. The backup location on your computer is a second copy that xHandle updates for recovery.
              </p>
              <p className="text-sm text-slate-600">
                Restoring from backup replaces the current browser copy of your data, including projects, analysis results, diagrams, requirements, and saved app settings.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border p-4 space-y-3">
                <div className="text-sm font-semibold text-slate-900">Automatic backup</div>
                <p className="text-sm text-slate-600">
                  {backupState.supported
                    ? "This browser supports continuous folder backups with the File System Access API."
                    : "This browser does not support persistent folder access. You can still download backup files and restore from them manually."}
                </p>

                <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={!!backupState.autoBackupEnabled}
                    disabled={!backupState.supported || backupState.busy}
                    onChange={(e) => handleAutoBackupToggle(e.target.checked)}
                  />
                  <span className="text-sm text-slate-700">
                    Enable automatic backup after meaningful changes
                  </span>
                </label>

                <div className="text-sm text-slate-700">
                  <div><span className="font-medium">Selected folder:</span> {backupState.folderConfigured ? (backupState.folderName || "Folder selected") : "Not set"}</div>
                  <div><span className="font-medium">Access:</span> {formatBackupPermission(backupState.permission)}</div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    className="bg-slate-900 hover:bg-slate-800 text-white rounded px-3 py-2 disabled:opacity-50"
                    onClick={handleChooseBackupFolder}
                    disabled={!backupState.supported || backupState.busy}
                  >
                    {backupState.folderConfigured ? "Change Folder" : "Choose Folder"}
                  </button>
                  <button
                    className="bg-gray-100 hover:bg-gray-200 rounded px-3 py-2 disabled:opacity-50"
                    onClick={handleBackupNow}
                    disabled={!backupState.folderConfigured || backupState.busy}
                  >
                    {backupState.busy ? "Working…" : "Back Up Now"}
                  </button>
                  <button
                    className="bg-gray-100 hover:bg-gray-200 rounded px-3 py-2 disabled:opacity-50"
                    onClick={() => recheckBackupFolder()}
                    disabled={!backupState.supported || backupState.busy}
                  >
                    Re-check Access
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border p-4 space-y-3">
                <div className="text-sm font-semibold text-slate-900">Restore and file fallback</div>
                <p className="text-sm text-slate-600">
                  Use the selected folder when available. In any browser, you can also save a standalone backup file and import it later.
                </p>

                <div className="text-sm text-slate-700 space-y-1">
                  <div><span className="font-medium">Last backup:</span> {formatBackupDate(backupState.lastBackupAt)}</div>
                  <div><span className="font-medium">Status:</span> {formatBackupStatus(backupState)}</div>
                  {backupState.latestBackupSummary?.createdAt && (
                    <div>
                      <span className="font-medium">Latest known backup:</span>{" "}
                      {new Date(backupState.latestBackupSummary.createdAt).toLocaleString()}
                      {Number.isFinite(backupState.latestBackupSummary.projectCount) ? ` • ${backupState.latestBackupSummary.projectCount} project(s)` : ""}
                    </div>
                  )}
                  {backupState.lastError && (
                    <div className="text-rose-600"><span className="font-medium">Recent issue:</span> {backupState.lastError}</div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    className="bg-slate-900 hover:bg-slate-800 text-white rounded px-3 py-2 disabled:opacity-50"
                    onClick={handleRestoreConfiguredBackup}
                    disabled={!backupState.folderConfigured || backupState.busy}
                  >
                    Restore from Backup
                  </button>
                  <button
                    className="bg-gray-100 hover:bg-gray-200 rounded px-3 py-2 disabled:opacity-50"
                    onClick={handleDownloadBackup}
                    disabled={backupState.busy}
                  >
                    Download Backup File
                  </button>
                  <button
                    className="bg-gray-100 hover:bg-gray-200 rounded px-3 py-2 disabled:opacity-50"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={backupState.busy}
                  >
                    Import Backup File
                  </button>
                </div>

                <div className="text-xs text-slate-500">
                  {backupState.pendingChanges
                    ? "Backup health: changes are waiting to be copied."
                    : "Backup health: browser data and the latest backup are currently in sync."}
                </div>
              </div>
            </div>

            {!!(backupMsg || backupState.statusMessage) && (
              <div className="text-sm">{backupMsg || backupState.statusMessage}</div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button className="ml-auto px-3 py-2" onClick={onClose}>
                Close
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleRestoreFileSelected}
            />
          </section>
        )}

        {tab === "storage" && (
          <section className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="text-sm font-medium text-slate-900">Browser data management</div>
              <p className="text-sm text-slate-600">
                Review and delete xHandle data stored in this browser. Credentials and API keys are separated and are never selected by default.
              </p>
              <div className="text-sm text-slate-700">
                <span className="font-medium">Origin usage:</span>{" "}
                {storageInventory
                  ? `${formatStorageBytes(storageInventory.usageBytes)}${storageInventory.quotaBytes ? ` of ${formatStorageBytes(storageInventory.quotaBytes)} quota` : ""}`
                  : storageBusy ? "Calculating…" : "Loading…"}
              </div>
              {storageInventory?.refreshedAt && (
                <div className="text-xs text-slate-500">
                  Last scanned {new Date(storageInventory.refreshedAt).toLocaleString()}. Sizes are approximate JSON payload sizes; browser overhead may differ.
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className="bg-slate-900 hover:bg-slate-800 text-white rounded px-3 py-2 disabled:opacity-50"
                onClick={refreshStorageInventory}
                disabled={storageBusy}
              >
                {storageBusy ? "Refreshing…" : "Refresh"}
              </button>
              <button
                className="bg-gray-100 hover:bg-gray-200 rounded px-3 py-2 disabled:opacity-50"
                onClick={() => setAllStorageItemsSelected(true)}
                disabled={storageBusy || !storageInventory?.items?.length}
              >
                Select Cleanable
              </button>
              <button
                className="bg-gray-100 hover:bg-gray-200 rounded px-3 py-2 disabled:opacity-50"
                onClick={() => setAllStorageItemsSelected(false)}
                disabled={storageBusy || !storageInventory?.items?.length}
              >
                Clear Selection
              </button>
              <button
                className="bg-red-600 hover:bg-red-700 text-white rounded px-3 py-2 disabled:opacity-50"
                onClick={deleteSelectedStorageItems}
                disabled={storageBusy || !Object.values(selectedStorageItems || {}).some(Boolean)}
              >
                Delete Selected
              </button>
            </div>

            {storageInventory?.items?.length > 0 ? (
              <div className="max-h-[46vh] overflow-auto rounded-2xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="border-b px-3 py-2">Delete</th>
                      <th className="border-b px-3 py-2">Data</th>
                      <th className="border-b px-3 py-2">Records</th>
                      <th className="border-b px-3 py-2">Approx. size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storageInventory.items.map((item) => (
                      <tr key={item.id} className={item.dangerous ? "bg-rose-50/60" : "bg-white"}>
                        <td className="border-b px-3 py-2 align-top">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={!!selectedStorageItems[item.id]}
                            onChange={() => toggleStorageItem(item.id)}
                            disabled={storageBusy}
                          />
                        </td>
                        <td className="border-b px-3 py-2 align-top">
                          <div className="font-medium text-slate-900">
                            {item.label}
                            {item.dangerous && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">credentials</span>}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{item.description}</div>
                          {item.error && <div className="mt-1 text-xs text-amber-700">{item.error}</div>}
                        </td>
                        <td className="border-b px-3 py-2 align-top text-slate-600">{Number(item.count || 0).toLocaleString()}</td>
                        <td className="border-b px-3 py-2 align-top font-medium text-slate-700">{formatStorageBytes(item.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
                {storageInventory
                  ? "No xHandle browser data was found."
                  : storageBusy ? "Loading browser storage…" : "Browser storage could not be loaded."}
              </div>
            )}

            {!!storageMsg && <div className="text-sm">{storageMsg}</div>}

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Deleting browser data may remove projects, generated analyses, review decisions, diagram layouts, and cached source indexes. Use Backup first if you may need this data later.
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button className="ml-auto px-3 py-2" onClick={onClose}>
                Close
              </button>
            </div>
          </section>
        )}

        {tab === "vscode" && (
          <section className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="text-sm font-medium text-slate-900">xHandle Safety for VS Code</div>
              <p className="text-sm text-slate-600">
                Install the local VS Code companion to receive safety remediation patch proposals, review diffs, apply approved changes, and run workspace verification commands.
              </p>
            </div>

            <div className="rounded-2xl border p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Extension package</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Version {VSCODE_EXTENSION_VERSION} • {VSCODE_EXTENSION_FILENAME}
                  </div>
                </div>
                <a
                  className="shrink-0 rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  href={VSCODE_EXTENSION_DOWNLOAD_URL}
                  download={VSCODE_EXTENSION_FILENAME}
                >
                  Download VSIX
                </a>
              </div>

              <div className="space-y-2 text-sm text-slate-700">
                <div className="font-medium text-slate-900">Install options</div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">VS Code UI</div>
                  <p className="mt-1">
                    Open Extensions, choose Install from VSIX, then select the downloaded package.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Command line</div>
                  <code className="mt-1 block overflow-x-auto rounded bg-slate-100 px-2 py-2 text-xs text-slate-800">
                    code --install-extension {VSCODE_EXTENSION_FILENAME}
                  </code>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button className="ml-auto px-3 py-2" onClick={onClose}>
                Close
              </button>
            </div>
          </section>
        )}
        </div>

        {/* ----- Tiny status bar (per-tab only) ----- */}
        <div
          className="shrink-0 border-t bg-white px-4 py-2"
          aria-live="polite"
        >
          <div className="flex items-center gap-3 text-xs text-gray-600">
            {false && tab === "github" && (
              <IntegrationBadge name="GitHub" connected={githubConnected} spinning={isSyncing} />
            )}
            {tab === "openai" && (
              <IntegrationBadge name="AI Provider" connected={providerConnected} />
            )}
            {tab === "organization-profile" && (
              <IntegrationBadge name="Organization Profile" connected={organizationProfileEnabled && organizationProfileValidation.valid} />
            )}
            {tab === "backup" && (
              <IntegrationBadge
                name="Backup"
                connected={backupState.folderConfigured || !!backupState.lastBackupAt}
                spinning={backupState.busy}
              />
            )}
            {tab === "storage" && (
              <IntegrationBadge
                name="Storage"
                connected={!!storageInventory}
                spinning={storageBusy}
              />
            )}
            {tab === "vscode" && (
              <IntegrationBadge name="VS Code Extension" connected />
            )}
          </div>
        </div>
      </div>

      {/* File-type picker modal for baseline flow */}
      <FileTypeSelectorModal
        open={extModalOpen}
        files={filesForModal}
        onCancel={handleExtCancel}
        onConfirm={handleExtConfirm}
      />
    </div>
  );
}

/* ---------------- UI helpers ---------------- */

function TabButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full px-3 py-1 text-sm transition " +
        (active
          ? "bg-gray-900 text-white"
          : "bg-gray-100 hover:bg-gray-200 text-gray-800")
      }
    >
      {label}
    </button>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", helper }) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <input
        type={type}
        className="w-full border rounded px-3 py-2"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {helper ? <p className="text-xs text-gray-500 mt-1">{helper}</p> : null}
    </div>
  );
}

function MetricPill({ label, value }) {
  const normalized = String(value || "Medium").toLowerCase();
  const tone =
    normalized === "high"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : normalized === "low"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-blue-200 bg-blue-50 text-blue-700";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${tone}`}>
      <span className="font-medium">{label}</span>
      <span>{value || "Medium"}</span>
    </span>
  );
}

function IntegrationBadge({ name, connected, spinning = false }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-1"
      title={connected ? `${name} connected` : `${name} not connected`}
    >
      {spinning ? (
        <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-gray-400 border-t-transparent" />
      ) : (
        <span
          className={
            "inline-block h-2.5 w-2.5 rounded-full " +
            (connected ? "bg-emerald-500" : "bg-gray-300")
          }
        />
      )}
      <span className="text-[11px] leading-none">
        {name}{connected ? " • Connected" : " • Not connected"}
      </span>
    </span>
  );
}

function formatBackupDate(value) {
  if (!value) return "Not yet run";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function formatBackupPermission(permission) {
  switch (permission) {
    case "granted":
      return "Ready";
    case "prompt":
      return "Needs confirmation";
    case "denied":
      return "Permission lost";
    case "unsupported":
      return "Folder backup unavailable in this browser";
    default:
      return "Unknown";
  }
}

function formatBackupStatus(backupState) {
  if (backupState.busy) return "Working…";
  if (backupState.lastBackupStatus === "error") return "Needs attention";
  if (backupState.lastBackupStatus === "success") return "Healthy";
  return "Not configured";
}
