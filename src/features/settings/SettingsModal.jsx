/**
 * xHandle: settings modal module.
 * This file provides supporting logic for the xHandle codebase.
 * It participates in the broader local-first architecture by isolating one focused concern that other modules can build on.
 * Related files: src/App.js.
 */

import { useState, useEffect, useRef } from "react";
import {
  backendURL,
  buildAuthOpts,
  getLocalAIProviderStatus,
  saveLocalAIProviderKey,
  activateLocalAIProvider,
  deleteLocalAIProviderKey,
} from "../../lib/api/backendConfig";
import { FileTypeSelectorModal } from "../functional-architecture/generateFunctionalDecompositionFromGitHub";
import { logger } from "../../lib/utils/logger";

function normalizeAIProviderValue(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "anthropic") return "claude";
  if (normalized === "google" || normalized === "google-gemini") return "gemini";
  return ["openai", "claude", "gemini"].includes(normalized) ? normalized : "openai";
}

export default function SettingsModal({
  onClose,
  onSynced,
  connected: githubConnectedProp = false,
  onBaselineRepo,
}) {
  useEffect(() => {
    logger.info("[xHandle] backendURL =", backendURL);
  }, []);

  // ----- Tab handling -----
  const [tab, setTab] = useState(
    (() => {
      const savedTab = (typeof window !== "undefined" && localStorage.getItem("settings.activeTab")) || "github";
      if (savedTab === "openai") return "ai-provider";
      return savedTab === "github" || savedTab === "ai-provider" ? savedTab : "github";
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [githubConnected, setGithubConnected] = useState(!!githubConnectedProp);
  useEffect(() => setGithubConnected(!!githubConnectedProp), [githubConnectedProp]);

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

      const r1 = await fetch(`${backendURL}/api/config/repo`, {
        method: "POST",
        ...buildAuthOpts({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const j1 = await r1.json().catch(() => ({}));
      if (!r1.ok || !j1?.ok) {
        throw new Error(j1?.error || `Failed to save repo config (HTTP ${r1.status})`);
      }

      const r2 = await fetch(`${backendURL}/api/github/repo-files`, {
        method: "POST",
        ...buildAuthOpts({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const j2 = await r2.json().catch(() => ({}));
      if (!r2.ok) throw new Error(j2?.error || `Verification failed (HTTP ${r2.status})`);

      const count = Array.isArray(j2) ? j2.length : 0;
      setMsg(`✅ Connected. Found ${count} code files.`);
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
  const AI_PROVIDER_OPTIONS = [
    {
      value: "openai",
      label: "OpenAI",
      keyLabel: "OpenAI API Key",
      placeholder: "sk-...",
      helperPrefix: "OpenAI keys usually start with sk-.",
    },
    {
      value: "claude",
      label: "Claude",
      keyLabel: "Claude API Key",
      placeholder: "sk-ant-...",
      helperPrefix: "Claude keys usually start with sk-ant-.",
    },
    {
      value: "gemini",
      label: "Gemini",
      keyLabel: "Gemini API Key",
      placeholder: "AIza...",
      helperPrefix: "Gemini keys often start with AIza.",
    },
  ];

  const [aiProvider, setAiProvider] = useState("openai");
  const [aiProviderKey, setAiProviderKey] = useState("");
  const [aiProviderMsg, setAiProviderMsg] = useState("");
  const [aiProviderStatus, setAiProviderStatus] = useState({
    activeProvider: null,
    savedProviders: [],
    connected: false,
  });
  const [isSavingAIProvider, setIsSavingAIProvider] = useState(false);

  const selectedAIProviderMeta =
    AI_PROVIDER_OPTIONS.find((option) => option.value === aiProvider) || AI_PROVIDER_OPTIONS[0];
  const getAIProviderLabel = (provider) =>
    AI_PROVIDER_OPTIONS.find((option) => option.value === normalizeAIProviderValue(provider))?.label || provider || "None";
  const savedProviderMap = Object.fromEntries(
    (aiProviderStatus.savedProviders || []).map((provider) => [provider.provider, provider])
  );
  const selectedProviderStatus = savedProviderMap[aiProvider] || null;

  async function refreshAIProviderStatus(preferredProvider = null) {
    const j = getLocalAIProviderStatus();

    setAiProviderStatus({
      activeProvider: j.activeProvider || null,
      savedProviders: Array.isArray(j.savedProviders) ? j.savedProviders : [],
      connected: !!j.connected,
    });
    if (preferredProvider) setAiProvider(normalizeAIProviderValue(preferredProvider));
    else if (j.activeProvider) setAiProvider(normalizeAIProviderValue(j.activeProvider));
    return j;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadAIProviderStatus() {
      try {
        const j = getLocalAIProviderStatus();
        if (!cancelled && j?.ok) {
          setAiProviderStatus({
            activeProvider: j.activeProvider || null,
            savedProviders: Array.isArray(j.savedProviders) ? j.savedProviders : [],
            connected: !!j.connected,
          });

          if (j.activeProvider) {
            setAiProvider(normalizeAIProviderValue(j.activeProvider));
          }
        }
      } catch {
        if (!cancelled) {
          setAiProviderStatus({
            activeProvider: null,
            savedProviders: [],
            connected: false,
          });
        }
      }
    }

    loadAIProviderStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveAIProviderPrefs = async () => {
    try {
      setIsSavingAIProvider(true);
      const key = aiProviderKey.trim();

      if (!key) {
        setAiProviderMsg(`⚠️ Enter a ${selectedAIProviderMeta.label} key or use Switch Provider.`);
        clearAIProviderMsgSoon();
        return;
      }

      saveLocalAIProviderKey(aiProvider, key, { activate: true });
      await refreshAIProviderStatus(aiProvider);
      setAiProviderKey("");
      setAiProviderMsg(`✅ ${selectedAIProviderMeta.label} key saved and activated.`);
      clearAIProviderMsgSoon();
    } catch (e) {
      setAiProviderMsg(`❌ ${e?.message || e}`);
      clearAIProviderMsgSoon();
    } finally {
      setIsSavingAIProvider(false);
    }
  };

  const switchAIProvider = async () => {
    try {
      setIsSavingAIProvider(true);
      activateLocalAIProvider(aiProvider);
      await refreshAIProviderStatus(aiProvider);
      setAiProviderKey("");
      setAiProviderMsg(`✅ Active provider switched to ${selectedAIProviderMeta.label}.`);
      clearAIProviderMsgSoon();
    } catch (e) {
      setAiProviderMsg(`❌ ${e?.message || e}`);
      clearAIProviderMsgSoon();
    } finally {
      setIsSavingAIProvider(false);
    }
  };

  const clearAIProvider = async () => {
    try {
      setIsSavingAIProvider(true);
      deleteLocalAIProviderKey(aiProvider);
      await refreshAIProviderStatus();
      setAiProviderKey("");
      setAiProviderMsg(`ℹ️ ${selectedAIProviderMeta.label} key cleared.`);
      clearAIProviderMsgSoon();
    } catch (e) {
      setAiProviderMsg(`❌ ${e?.message || e}`);
      clearAIProviderMsgSoon();
    } finally {
      setIsSavingAIProvider(false);
    }
  };

  // ----- helpers -----
  function clearMsgSoon() { setTimeout(() => setMsg(""), 2000); }
  function clearAIProviderMsgSoon() { setTimeout(() => setAiProviderMsg(""), 2000); }

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

  const runBaselineWithChooser = async () => {
    try {
      if (!owner.trim() || !repo.trim()) {
        setMsg("⚠️ Please fill in owner and repo first.");
        return;
      }
      setIsSyncing(true);
      setMsg("Scanning repo for files…");

      const body = token.trim()
        ? { owner: owner.trim(), repo: repo.trim(), token: token.trim() }
        : { owner: owner.trim(), repo: repo.trim() };

      const r = await fetch(`${backendURL}/api/github/repo-files`, {
        method: "POST",
        ...buildAuthOpts({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`Scan failed (HTTP ${r.status}) ${txt}`);
      }

      const repoFiles = await r.json();
      if (!Array.isArray(repoFiles) || repoFiles.length === 0) {
        throw new Error("No files found in this repo.");
      }

      const selectedExtensions = await awaitExtSelection(repoFiles);
      if (!selectedExtensions.length) {
        setMsg("ℹ️ Baseline cancelled (no file types selected).");
        clearMsgSoon();
        return;
      }

      try {
        localStorage.setItem("githubSelectedExtensions", JSON.stringify(selectedExtensions));
      } catch {}

      setMsg(`✅ Selected ${selectedExtensions.length} file type(s). Starting baseline…`);
      clearMsgSoon();

      onBaselineRepo && onBaselineRepo({
        owner: owner.trim(),
        repo: repo.trim(),
        token: token.trim(),
        selectedExtensions,
      });
    } catch (e) {
      setMsg(`❌ ${e?.message || e}`);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-[560px] max-w-[92vw] p-5 pb-12">
        <div className="text-lg font-semibold mb-4">Settings</div>

        <div className="flex gap-2 mb-4">
          <TabButton label="GitHub" active={tab === "github"} onClick={() => setTab("github")} />
          <TabButton label="AI Provider" active={tab === "ai-provider"} onClick={() => setTab("ai-provider")} />
        </div>

        {tab === "github" && (
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

        {tab === "ai-provider" && (
          <section className="space-y-3">
            <div className="text-sm text-gray-600">
              Choose one AI provider at a time. Your API key is stored locally in this browser and used by the generic chat proxy for model requests.
            </div>

            <div>
              <label className="text-sm font-medium">AI Provider</label>
              <select
                className="w-full border rounded px-3 py-2 bg-white"
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
              >
                {AI_PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <Field
              label={selectedAIProviderMeta.keyLabel}
              placeholder={selectedAIProviderMeta.placeholder}
              type="password"
              value={aiProviderKey}
              onChange={setAiProviderKey}
              helper={
                selectedProviderStatus?.last4
                  ? `${selectedAIProviderMeta.helperPrefix} Saved key on file ends in ${selectedProviderStatus.last4}. Leave this blank to switch back to it.`
                  : `${selectedAIProviderMeta.helperPrefix} Stored locally in this browser once configured.`
              }
            />

            <div className="text-xs text-gray-600">
              Active provider: <span className="font-medium">{getAIProviderLabel(aiProviderStatus.activeProvider)}</span>
              {selectedProviderStatus?.last4 ? ` • Last 4: ${selectedProviderStatus.last4}` : ""}
              {selectedProviderStatus?.verified ? " • Verified ✓" : ""}
            </div>

            {!!(aiProviderStatus.savedProviders || []).length && (
              <div className="space-y-1">
                <div className="text-sm font-medium">Saved providers</div>
                <div className="flex flex-wrap gap-2">
                  {aiProviderStatus.savedProviders.map((provider) => (
                    <button
                      key={provider.provider}
                      type="button"
                      className={
                        "rounded-full border px-3 py-1 text-sm " +
                        (provider.isActive
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-gray-200 bg-gray-50 text-gray-700")
                      }
                      onClick={() => setAiProvider(provider.provider)}
                    >
                      {provider.label} • •••• {provider.last4}
                      {provider.isActive ? " • Active" : ""}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                className="bg-gray-100 hover:bg-gray-200 rounded px-3 py-2"
                onClick={saveAIProviderPrefs}
                disabled={isSavingAIProvider}
              >
                {isSavingAIProvider ? "Saving…" : "Save Key"}
              </button>

              <button
                className="bg-gray-100 hover:bg-gray-200 rounded px-3 py-2 disabled:opacity-50"
                onClick={switchAIProvider}
                disabled={isSavingAIProvider || !selectedProviderStatus?.connected}
              >
                Switch Provider
              </button>

              <button
                className="bg-red-50 hover:bg-red-100 text-red-700 rounded px-3 py-2 disabled:opacity-50"
                onClick={clearAIProvider}
                disabled={isSavingAIProvider || !selectedProviderStatus?.connected}
              >
                Clear Saved Key
              </button>

              {aiProviderStatus.connected ? (
                <span className="text-xs text-emerald-600">Configured ✓</span>
              ) : (
                <span className="text-xs text-gray-500">Not connected</span>
              )}

              <button className="ml-auto px-3 py-2" onClick={onClose}>
                Close
              </button>
            </div>

            {!!aiProviderMsg && <div className="mt-1 text-sm">{aiProviderMsg}</div>}
          </section>
        )}

        <div
          className="absolute left-0 right-0 bottom-0 px-4 py-2 border-t bg-white/95"
          aria-live="polite"
        >
          <div className="flex items-center gap-3 text-xs text-gray-600">
            {tab === "github" && (
              <IntegrationBadge name="GitHub" connected={githubConnected} spinning={isSyncing} />
            )}
            {tab === "ai-provider" && (
              <IntegrationBadge
                name="AI Provider"
                connected={aiProviderStatus.connected}
                spinning={isSavingAIProvider}
              />
            )}
          </div>
        </div>
      </div>

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

/**
 * Field renders a React component. It gives users access to application configuration while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param label Input consumed by this step of the xHandle workflow.
 * @param value Input consumed by this step of the xHandle workflow.
 * @param onChange Callback used to notify the surrounding workflow about progress or user actions.
 * @param placeholder Input consumed by this step of the xHandle workflow.
 * @param type Input consumed by this step of the xHandle workflow.
 * @param helper Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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

/**
 * IntegrationBadge renders a React component. It gives users access to application configuration while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param name Human-readable name provided by the user or calling code.
 * @param connected Input consumed by this step of the xHandle workflow.
 * @param spinning Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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
