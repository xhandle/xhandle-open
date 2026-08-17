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
  getStoredAIProviderModelPreference,
  normalizeAIProvider,
  normalizeProviderModel,
  saveUserAIProviderSettings,
  storeAIProviderModelPreference,
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
import { inspectWorkspaceGraph } from "../features/workspace-graph";

const VSCODE_EXTENSION_VERSION = "0.0.10";
const VSCODE_EXTENSION_FILENAME = `xhandle-safety-${VSCODE_EXTENSION_VERSION}.vsix`;
const VSCODE_EXTENSION_DOWNLOAD_URL = `/downloads/${VSCODE_EXTENSION_FILENAME}`;
const MAX_ANALYSIS_CONTEXT_FILE_CHARS = 60000;

export default function SettingsModal({
  onClose,
  onSynced,
  connected: githubConnectedProp = false,
  onBaselineRepo,
  onAIProviderSaved,
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
      return saved && saved !== "github" ? saved : "openai";
    })()
  );
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("settings.activeTab", tab);
  }, [tab]);

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

  // ===== Jira placeholders =====
  const [jiraSite, setJiraSite] = useState(
    (typeof window !== "undefined" && localStorage.getItem("jiraSite")) || ""
  );
  const [jiraEmail, setJiraEmail] = useState(
    (typeof window !== "undefined" && localStorage.getItem("jiraEmail")) || ""
  );
  const [jiraToken, setJiraToken] = useState(
    (typeof window !== "undefined" && localStorage.getItem("jiraToken")) || ""
  );
  const [jiraMsg, setJiraMsg] = useState("");
  const [jiraConnected, setJiraConnected] = useState(
    (typeof window !== "undefined" && localStorage.getItem("jiraConnected")) === "true"
  );

  const saveJiraPrefs = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("jiraSite", jiraSite.trim());
      localStorage.setItem("jiraEmail", jiraEmail.trim());
      if (jiraToken.trim()) localStorage.setItem("jiraToken", jiraToken.trim());
      else localStorage.removeItem("jiraToken");
    }
    setJiraMsg("✅ Jira preferences saved (placeholder).");
    clearJiraMsgSoon();
  };

  const connectJira = async () => {
    setJiraConnected(true);
    if (typeof window !== "undefined") localStorage.setItem("jiraConnected", "true");
    setJiraMsg("✅ Jira connected (placeholder). Wire your OAuth/API next.");
    clearJiraMsgSoon();
  };

  const disconnectJira = () => {
    setJiraConnected(false);
    if (typeof window !== "undefined") localStorage.setItem("jiraConnected", "false");
    setJiraMsg("ℹ️ Jira disconnected.");
    clearJiraMsgSoon();
  };

  // ===== Google placeholders =====
  const [googleDriveEnabled, setGoogleDriveEnabled] = useState(
    (typeof window !== "undefined" && localStorage.getItem("googleDriveEnabled")) === "true"
  );
  const [googleCalendarEnabled, setGoogleCalendarEnabled] = useState(
    (typeof window !== "undefined" && localStorage.getItem("googleCalendarEnabled")) === "true"
  );
  const [googleMsg, setGoogleMsg] = useState("");
  const [googleConnected, setGoogleConnected] = useState(
    (typeof window !== "undefined" && localStorage.getItem("googleConnected")) === "true"
  );

  const saveGooglePrefs = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("googleDriveEnabled", String(googleDriveEnabled));
      localStorage.setItem("googleCalendarEnabled", String(googleCalendarEnabled));
    }
    setGoogleMsg("✅ Google preferences saved (placeholder).");
    clearGoogleMsgSoon();
  };

  const connectGoogle = async () => {
    setGoogleConnected(true);
    if (typeof window !== "undefined") localStorage.setItem("googleConnected", "true");
    setGoogleMsg("✅ Google connected (placeholder). Add OAuth next.");
    clearGoogleMsgSoon();
  };

  const disconnectGoogle = () => {
    setGoogleConnected(false);
    if (typeof window !== "undefined") localStorage.setItem("googleConnected", "false");
    setGoogleMsg("ℹ️ Google disconnected.");
    clearGoogleMsgSoon();
  };

  // ===== AI provider integration =====
  const [aiProvider, setAiProvider] = useState("openai");
  const [providerKey, setProviderKey] = useState("");
  const [providerModel, setProviderModel] = useState(() =>
    getStoredAIProviderModelPreference("openai", { includeDefault: true })
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
  const [graphInspection, setGraphInspection] = useState(null);
  const [graphInspectionBusy, setGraphInspectionBusy] = useState(false);
  const [graphInspectionMsg, setGraphInspectionMsg] = useState("");
  const fileInputRef = useRef(null);
  const selectedSavedProvider = providerStatus?.savedProviders?.find(
    (row) => row.provider === normalizeAIProvider(aiProvider)
  );
  const selectedModelProfile = getProviderModelProfile(aiProvider, providerModel);
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
    const usingSavedKey = !providerKey.trim() && !!selectedSavedProvider;
    const isActiveSavedProvider = providerStatus?.provider === provider && !!selectedSavedProvider;
    storeAIProviderModelPreference(provider, selectedModel);

    if (usingSavedKey && selectedSavedProvider?.hasApiKey === false) {
      setProviderMsg(`⚠️ Re-enter your ${getAIProviderLabel(provider)} API key to use it locally.`);
      clearProviderMsgSoon();
      return;
    }

    if (isActiveSavedProvider && !providerKey.trim()) {
      setProviderModel(selectedModel);
      const nextSavedProviders = (providerStatus?.savedProviders || []).map((saved) =>
        saved.provider === provider ? { ...saved, selectedModel } : saved
      );
      const nextStatus = {
        ...providerStatus,
        provider,
        selectedModel,
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
        usingSavedKey ? { activateOnly: true, selectedModel } : { selectedModel }
      );
      const resultModel = normalizeProviderModel(provider, result?.selectedModel || selectedModel);
      storeAIProviderModelPreference(provider, resultModel);
      const nextStatus = {
        provider,
        last4: result?.last4 || selectedSavedProvider?.last4 || null,
        verified: !!result?.verified,
        selectedModel: resultModel,
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
  function clearJiraMsgSoon() { setTimeout(() => setJiraMsg(""), 2000); }
  function clearGoogleMsgSoon() { setTimeout(() => setGoogleMsg(""), 2000); }
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

  const handleInspectWorkspaceGraph = async () => {
    setGraphInspectionBusy(true);
    setGraphInspectionMsg("");
    try {
      const inspection = await inspectWorkspaceGraph({ sampleLimit: 8 });
      setGraphInspection(inspection);
      setGraphInspectionMsg(inspection.health === "healthy" ? "Workspace graph looks healthy." : "Workspace graph needs attention.");
    } catch (e) {
      setGraphInspectionMsg(`❌ ${e?.message || e}`);
    } finally {
      setGraphInspectionBusy(false);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-[720px] max-w-[94vw] p-5 pb-12">
        <div className="text-lg font-semibold mb-4">Settings</div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <TabButton label="Jira" active={tab === "jira"} onClick={() => setTab("jira")} />
          <TabButton label="Google" active={tab === "google"} onClick={() => setTab("google")} />
          <TabButton label="AI Provider" active={tab === "openai"} onClick={() => setTab("openai")} />
          <TabButton label="VS Code" active={tab === "vscode"} onClick={() => setTab("vscode")} />
          <TabButton label="Backup" active={tab === "backup"} onClick={() => setTab("backup")} />
          <TabButton label="Graph" active={tab === "graph"} onClick={() => setTab("graph")} />
        </div>

        {/* Panels */}
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

        {tab === "jira" && (
          <section className="space-y-3">
            <div className="text-sm text-gray-600">
              Connect Jira to pull issues/requirements and push findings back as tickets.
            </div>
            <Field
              label="Jira Site"
              placeholder="your-team.atlassian.net"
              value={jiraSite}
              onChange={setJiraSite}
            />
            <Field
              label="Jira Email"
              placeholder="you@company.com"
              value={jiraEmail}
              onChange={setJiraEmail}
            />
            <Field
              label="Jira API Token"
              placeholder="Paste your Jira API token"
              type="password"
              value={jiraToken}
              onChange={setJiraToken}
              helper="Stored locally for now. Replace with OAuth in production."
            />

            <div className="flex items-center gap-2 pt-1">
              <button
                className="bg-gray-100 hover:bg-gray-200 rounded px-3 py-2"
                onClick={saveJiraPrefs}
              >
                Save
              </button>
              {jiraConnected ? (
                <button
                  className="bg-red-600 hover:bg-red-700 text-white rounded px-3 py-2"
                  onClick={disconnectJira}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  className="bg-purple-600 hover:bg-purple-700 text-white rounded px-3 py-2"
                  onClick={connectJira}
                  title="Placeholder — wire OAuth/API"
                >
                  Connect (Placeholder)
                </button>
              )}
              <button className="ml-auto px-3 py-2" onClick={onClose}>
                Close
              </button>
            </div>

            {!!jiraMsg && <div className="mt-1 text-sm">{jiraMsg}</div>}
          </section>
        )}

        {tab === "google" && (
          <section className="space-y-3">
            <div className="text-sm text-gray-600">
              Connect Google to ingest Drive docs and schedule reviews via Calendar.
            </div>

            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={googleDriveEnabled}
                  onChange={(e) => setGoogleDriveEnabled(e.target.checked)}
                />
                <span className="text-sm">Enable Drive</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={googleCalendarEnabled}
                  onChange={(e) => setGoogleCalendarEnabled(e.target.checked)}
                />
                <span className="text-sm">Enable Calendar</span>
              </label>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                className="bg-gray-100 hover:bg-gray-200 rounded px-3 py-2"
                onClick={saveGooglePrefs}
              >
                Save
              </button>
              {googleConnected ? (
                <button
                  className="bg-red-600 hover:bg-red-700 text-white rounded px-3 py-2"
                  onClick={disconnectGoogle}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  className="bg-purple-600 hover:bg-purple-700 text-white rounded px-3 py-2"
                  onClick={connectGoogle}
                  title="Placeholder — wire OAuth scopes for Drive/Calendar"
                >
                  Connect (Placeholder)
                </button>
              )}
              <button className="ml-auto px-3 py-2" onClick={onClose}>
                Close
              </button>
            </div>

            {!!googleMsg && <div className="mt-1 text-sm">{googleMsg}</div>}
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
                Active provider: <b>{getAIProviderLabel(providerStatus.provider)}</b> • Model: <b>{normalizeProviderModel(providerStatus.provider, providerStatus.selectedModel)}</b> • Last 4: <b>{providerStatus.last4}</b> • {providerStatus.verified ? "Verified ✓" : "Saved, not yet verified"}
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
                        {getAIProviderLabel(saved.provider)} • {normalizeProviderModel(saved.provider, saved.selectedModel)} • •••• {saved.last4} {isActive ? "• Active" : ""}
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

        {tab === "graph" && (
          <section className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="text-sm font-medium text-slate-900">Workspace graph diagnostics</div>
              <p className="text-sm text-slate-600">
                Inspect the canonical graph used by Collaborator for native LLM context. This reads the graph database and does not modify legacy project data.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className="bg-slate-900 hover:bg-slate-800 text-white rounded px-3 py-2 disabled:opacity-50"
                onClick={handleInspectWorkspaceGraph}
                disabled={graphInspectionBusy}
              >
                {graphInspectionBusy ? "Inspecting..." : "Inspect Graph"}
              </button>
              {graphInspectionMsg && <span className="text-sm text-slate-600">{graphInspectionMsg}</span>}
            </div>

            {graphInspection && (
              <div className="space-y-3 text-sm">
                <div className="grid gap-3 md:grid-cols-4">
                  {Object.entries(graphInspection.counts || {}).map(([label, value]) => (
                    <div key={label} className="rounded-xl border bg-white p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border bg-white p-3">
                  <div className="font-medium text-slate-900">Health</div>
                  <div className={graphInspection.health === "healthy" ? "text-emerald-700" : "text-amber-700"}>
                    {graphInspection.health}
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-slate-600 md:grid-cols-2">
                    <div>Orphan relationships: {graphInspection.validation?.orphanRelationships?.length || 0}</div>
                    <div>Missing parent contains links: {graphInspection.validation?.missingContainsForParent?.length || 0}</div>
                    <div>Source files missing artifacts: {graphInspection.validation?.sourceFilesMissingArtifact?.length || 0}</div>
                    <div>Migration errors: {graphInspection.migrationErrors?.length || 0}</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border bg-white p-3">
                    <div className="font-medium text-slate-900">Relationship Types</div>
                    <pre className="mt-2 max-h-44 overflow-auto rounded bg-slate-50 p-2 text-xs">
                      {JSON.stringify(graphInspection.relationshipTypeCounts || {}, null, 2)}
                    </pre>
                  </div>
                  <div className="rounded-xl border bg-white p-3">
                    <div className="font-medium text-slate-900">Citation Samples</div>
                    <pre className="mt-2 max-h-44 overflow-auto rounded bg-slate-50 p-2 text-xs">
                      {JSON.stringify(graphInspection.sourceCitationSamples || [], null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            )}

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

        {/* ----- Tiny status bar (per-tab only) ----- */}
        <div
          className="absolute left-0 right-0 bottom-0 px-4 py-2 border-t bg-white/95"
          aria-live="polite"
        >
          <div className="flex items-center gap-3 text-xs text-gray-600">
            {false && tab === "github" && (
              <IntegrationBadge name="GitHub" connected={githubConnected} spinning={isSyncing} />
            )}
            {tab === "jira" && (
              <IntegrationBadge name="Jira" connected={jiraConnected} />
            )}
            {tab === "google" && (
              <IntegrationBadge name="Google" connected={googleConnected} />
            )}
            {tab === "openai" && (
              <IntegrationBadge name="AI Provider" connected={providerConnected} />
            )}
            {tab === "backup" && (
              <IntegrationBadge
                name="Backup"
                connected={backupState.folderConfigured || !!backupState.lastBackupAt}
                spinning={backupState.busy}
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
