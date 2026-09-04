/**
 * xHandle: backend API entrypoint.
 * This file boots the Express-based backend used by xHandle for LLM proxying, document ingestion, licensing, lightweight persistence, and external integration helpers.
 * It is the server-side boundary between the local-first UI and any operations that need secrets, rate limiting, filesystem access, or third-party API calls.
 * Related files: server/logger.js, src/lib/api/backendConfig.js.
 */

/* ----------------------------- Dependencies ----------------------------- */
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { google } = require("googleapis");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const fs = require("fs");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { OpenAI } = require("openai");
const { logger } = require("./server/logger");
const { spawn, spawnSync } = require("child_process");

const app = express();

const CORS_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Requested-With",
  "Accept",
  "Origin",
  "x-account-id",
  "x-ai-provider",
  "x-ai-api-key",
  "x-ai-model"
];
const configuredCorsOrigins = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const localOriginPatterns = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^https:\/\/localhost:\d+$/,
  /^https:\/\/127\.0\.0\.1:\d+$/
];

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (configuredCorsOrigins.includes(origin)) return true;
  return localOriginPatterns.some((pattern) => pattern.test(origin));
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedCorsOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: CORS_ALLOWED_HEADERS,
};

// --- CORS (localhost by default, explicit origins in hosted environments) ---
app.use(cors(corsOptions));
app.options("/api/*", cors(corsOptions));

/* ----------------------------- Minimal GitHub diagnostics ----------------------------- */
app.get("/api/github/status", (req, res) => {
  res.status(200).json({
    ok: true,
    env: process.env.NODE_ENV || "unknown",
    time: new Date().toISOString(),
  });
});

app.get("/api/github/self-test", async (req, res) => {
  try {
    const token = process.env.GITHUB_TOKEN || null;
    if (!token) {
      return res.status(200).json({
        ok: false,
        note: "No GITHUB_TOKEN set on server; route is alive but cannot call GitHub.",
      });
    }
    const r = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "xhandle-server" },
      timeout: 10000,
    });
    return res.status(200).json({ ok: true, login: r.data?.login || null });
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { message: e.message };
    return res.status(status).json({ ok: false, error: data });
  }
});

/* ----------------------------- Health ----------------------------- */
app.get(["/health", "/api/health"], (_req, res) => {
  res.status(200).json({
    ok: true,
    ts: Date.now(),
    env: process.env.NODE_ENV || "production",
    version: process.env.npm_package_version || null,
  });
});

/* ----------------------------- App & Middleware ----------------------------- */
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.originalUrl}`);
  next();
});
app.set("trust proxy", 1);

app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    express.json({ limit: "100mb" })(req, res, (err) => {
      if (err) return next(err);
      express.urlencoded({ extended: true, limit: "100mb" })(req, res, next);
    });
  } else {
    next();
  }
});

/* ----------------------------- Code Architecture Review App Packaging ----------------------------- */
let reviewPackageBuildInProgress = false;
const reviewPackageJobs = new Map();

function slugForFilename(value, fallback = "code-architecture-review") {
  return String(value || fallback)
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || fallback;
}

function normalizeReviewAppTarget(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["mac", "macos", "darwin"].includes(raw)) return "mac";
  if (["win", "windows", "win32"].includes(raw)) return "win";
  if (raw === "linux") return "linux";
  if (process.platform === "win32") return "win";
  if (process.platform === "linux") return "linux";
  return "mac";
}

function normalizeDestinationDirectory(destinationDirectory) {
  const baseRaw = String(destinationDirectory || "").trim();
  return baseRaw
    ? (path.isAbsolute(baseRaw) ? path.resolve(baseRaw) : path.resolve(__dirname, baseRaw))
    : path.join(__dirname, "dist-review");
}

function chooseSystemDestinationFolder() {
  const prompt = "Choose destination folder for the review app";
  if (process.platform === "darwin") {
    const result = spawnSync("osascript", [
      "-e",
      `POSIX path of (choose folder with prompt "${prompt}")`,
    ], { encoding: "utf8" });
    if (result.status === 0) return { path: String(result.stdout || "").trim() };
    if (String(result.stderr || "").toLowerCase().includes("user canceled")) return { cancelled: true };
    throw new Error(String(result.stderr || "").trim() || "Could not open the macOS folder picker.");
  }

  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$dialog.Description = "${prompt}"`,
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($dialog.SelectedPath) }",
    ].join("; ");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], { encoding: "utf8" });
    if (result.status === 0) {
      const selectedPath = String(result.stdout || "").trim();
      return selectedPath ? { path: selectedPath } : { cancelled: true };
    }
    throw new Error(String(result.stderr || "").trim() || "Could not open the Windows folder picker.");
  }

  for (const command of [
    ["zenity", ["--file-selection", "--directory", "--title", prompt]],
    ["kdialog", ["--getexistingdirectory", process.env.HOME || "/", prompt]],
  ]) {
    const result = spawnSync(command[0], command[1], { encoding: "utf8" });
    if (result.error?.code === "ENOENT") continue;
    if (result.status === 0) return { path: String(result.stdout || "").trim() };
    if (result.status === 1) return { cancelled: true };
    throw new Error(String(result.stderr || "").trim() || `Could not open ${command[0]} folder picker.`);
  }

  throw new Error("No supported folder picker is available on this computer.");
}

function stripAnsiCodes(value) {
  return String(value || "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function runPackageCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: __dirname,
      env: { ...process.env, CI: "false", ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const chunks = [];
    const collect = (chunk) => {
      const text = stripAnsiCodes(chunk.toString());
      chunks.push(text);
      if (chunks.join("").length > 20000) chunks.splice(0, chunks.length - 12);
      options.onOutput?.(text, chunks.join(""));
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => {
      const output = chunks.join("");
      if (code === 0) resolve(output);
      else reject(new Error(`Review package build failed with exit code ${code}.\n${output}`));
    });
  });
}

function reviewPackageItemCounts(reviewPackage = {}) {
  const repositories = Array.isArray(reviewPackage?.data?.repositories) && reviewPackage.data.repositories.length
    ? reviewPackage.data.repositories
    : [{
        cbaRows: reviewPackage?.data?.cbaRows || [],
        assuranceArtifacts: reviewPackage?.data?.assuranceArtifacts || {},
      }];
  const repoCounts = repositories.map((entry) => {
    const artifacts = entry.assuranceArtifacts || {};
    const artifactRows = Object.values(artifacts).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
    return {
      repoId: entry.repo?.repoId || entry.repo?.repoName || entry.repo?.id || "repo",
      cbaRows: Array.isArray(entry.cbaRows) ? entry.cbaRows.length : 0,
      artifactRows,
    };
  });
  const hazardRows = Array.isArray(reviewPackage?.data?.hazardRun?.generatedSheets?.Summary)
    ? reviewPackage.data.hazardRun.generatedSheets.Summary.length
    : 0;
  const reviewItems = Array.isArray(reviewPackage?.data?.reviewItems) ? reviewPackage.data.reviewItems.length : 0;
  const cbaRows = repoCounts.reduce((sum, entry) => sum + entry.cbaRows, 0);
  const artifactRows = repoCounts.reduce((sum, entry) => sum + entry.artifactRows, 0);
  return {
    repositories: repoCounts.length,
    cbaRows,
    artifactRows,
    hazardRows,
    reviewItems,
    totalItems: cbaRows + artifactRows + hazardRows + reviewItems,
    repos: repoCounts,
  };
}

function createReviewPackageJob({ reviewPackage, downloadName, reviewAppTarget, destinationDirectory }) {
  const now = new Date().toISOString();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const counts = reviewPackageItemCounts(reviewPackage);
  const job = {
    id,
    status: "queued",
    percent: 1,
    message: "Queued review app build...",
    counts,
    downloadName,
    reviewAppTarget,
    destinationDirectory,
    zipPath: null,
    error: null,
    logTail: "",
    createdAt: now,
    updatedAt: now,
  };
  reviewPackageJobs.set(id, job);
  return job;
}

function updateReviewPackageJob(id, patch) {
  const job = reviewPackageJobs.get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}

function publicReviewPackageJob(job) {
  if (!job) return null;
  const { zipPath, ...safeJob } = job;
  return {
    ...safeJob,
    ready: job.status === "complete",
    downloadUrl: job.status === "complete" ? `/api/code-architecture-review/package/${job.id}/download` : null,
  };
}

function inferBuildProgressFromOutput(text, currentPercent) {
  const value = String(text || "");
  if (value.includes("Creating an optimized production build")) return { percent: Math.max(currentPercent, 45), message: "Building read-only review interface..." };
  if (value.includes("Compiled with warnings") || value.includes("Compiled successfully")) return { percent: Math.max(currentPercent, 62), message: "Review interface built. Preparing desktop app..." };
  if (value.includes("electron-builder")) return { percent: Math.max(currentPercent, 70), message: "Starting Electron app packaging..." };
  if (value.includes("packaging")) return { percent: Math.max(currentPercent, 80), message: "Packaging Electron review app..." };
  if (value.includes("building") && value.includes("zip")) return { percent: Math.max(currentPercent, 92), message: "Creating downloadable app zip..." };
  if (value.includes("building block map")) return { percent: Math.max(currentPercent, 96), message: "Finalizing app package..." };
  return null;
}

function listZipFilesRecursive(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listZipFilesRecursive(fullPath);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".zip") ? [fullPath] : [];
  });
}

function newestZipFile(directory, startedAtMs, reviewAppTarget) {
  const targetSuffix = reviewAppTarget ? `-${reviewAppTarget}.zip` : ".zip";
  return listZipFilesRecursive(directory)
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .filter((entry) => (
      entry.stat.mtimeMs >= startedAtMs - 1000 &&
      path.basename(entry.filePath).toLowerCase().endsWith(targetSuffix)
    ))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]?.filePath || null;
}

async function runReviewPackageJob({ jobId, reviewPackage, startedAtMs }) {
  const packagePath = path.join(__dirname, "review-package.json");

  try {
    const job = reviewPackageJobs.get(jobId);
    const distDir = job?.destinationDirectory || path.join(__dirname, "dist-review");
    updateReviewPackageJob(jobId, {
      status: "running",
      percent: 10,
      message: `Preparing ${job?.counts?.totalItems || 0} review package item${job?.counts?.totalItems === 1 ? "" : "s"}...`,
    });

    fs.writeFileSync(packagePath, JSON.stringify(reviewPackage, null, 2));
    fs.mkdirSync(distDir, { recursive: true });
    updateReviewPackageJob(jobId, {
      percent: 35,
      message: `Packaged ${job?.counts?.totalItems || 0} item${job?.counts?.totalItems === 1 ? "" : "s"} from ${job?.counts?.repositories || 0} repos. Starting app build...`,
    });

    await runPackageCommand("npm", ["run", "package:review"], {
      env: {
        REVIEW_APP_TARGET: job?.reviewAppTarget || "mac",
        REVIEW_OUTPUT_DIR: distDir,
      },
      onOutput: (text, output) => {
        const current = reviewPackageJobs.get(jobId);
        const inferred = inferBuildProgressFromOutput(text, current?.percent || 0);
        updateReviewPackageJob(jobId, {
          ...(inferred || {}),
          logTail: output.slice(-12000),
        });
      },
    });

    const zipPath = newestZipFile(distDir, startedAtMs, job?.reviewAppTarget);
    if (!zipPath) throw new Error("Electron Builder completed, but no review app zip was found.");

    updateReviewPackageJob(jobId, {
      status: "complete",
      percent: 100,
      message: `Review app package ready in ${distDir}.`,
      zipPath,
    });
  } catch (error) {
    const cleanError = stripAnsiCodes(error?.message || "Failed to generate the Code-Based Architecture review app.");
    updateReviewPackageJob(jobId, {
      status: "failed",
      percent: Math.max(reviewPackageJobs.get(jobId)?.percent || 0, 1),
      message: "Review app package build failed.",
      error: cleanError,
      logTail: cleanError.slice(-12000),
    });
  } finally {
    reviewPackageBuildInProgress = false;
  }
}

app.post("/api/code-architecture-review/package/start", async (req, res) => {
  if (reviewPackageBuildInProgress) {
    return res.status(409).json({ error: "A review app package is already being generated. Try again after it finishes." });
  }

  const reviewPackage = req.body?.reviewPackage || req.body;
  if (!reviewPackage || reviewPackage.artifactType !== "code-based-architecture-review-package") {
    return res.status(400).json({ error: "A valid Code-Based Architecture review package is required." });
  }

  reviewPackageBuildInProgress = true;
  const startedAtMs = Date.now();
  const reviewAppTarget = normalizeReviewAppTarget(req.body?.reviewAppTarget || req.body?.platform || req.body?.target);
  let destinationDirectory;
  try {
    destinationDirectory = normalizeDestinationDirectory(req.body?.destinationDirectory);
  } catch (error) {
    reviewPackageBuildInProgress = false;
    return res.status(400).json({ error: error?.message || "Invalid destination folder." });
  }
  const appDisplayName = reviewPackage?.appDisplayName || [
    reviewPackage?.project?.name || "code-architecture",
    reviewPackage?.activeRepo?.repoName || reviewPackage?.activeRepo?.repoId || "review",
  ].filter(Boolean).join("-");
  const downloadName = `${slugForFilename(appDisplayName)}-review-app-${reviewAppTarget}.zip`;
  const job = createReviewPackageJob({ reviewPackage, downloadName, reviewAppTarget, destinationDirectory });

  res.status(202).json(publicReviewPackageJob(job));
  setImmediate(() => runReviewPackageJob({ jobId: job.id, reviewPackage, startedAtMs }));
});

app.post("/api/code-architecture-review/package/choose-destination", (_req, res) => {
  try {
    const result = chooseSystemDestinationFolder();
    if (result.cancelled || !result.path) return res.json({ cancelled: true });
    res.json({ path: result.path });
  } catch (error) {
    res.status(500).json({ error: error?.message || "Could not choose a destination folder." });
  }
});

app.get("/api/code-architecture-review/package/:jobId/status", (req, res) => {
  const job = reviewPackageJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Review app build job not found." });
  res.json(publicReviewPackageJob(job));
});

app.get("/api/code-architecture-review/package/:jobId/download", (req, res) => {
  const job = reviewPackageJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Review app build job not found." });
  if (job.status !== "complete" || !job.zipPath || !fs.existsSync(job.zipPath)) {
    return res.status(409).json({ error: "Review app package is not ready for download." });
  }
  res.download(job.zipPath, job.downloadName || path.basename(job.zipPath), (error) => {
    if (error) logger.error("Review package download failed:", error);
  });
});

// LLM rate limit
const llmLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/* ----------------------------- OpenAI Realtime: ephemeral WebRTC session ----------------------------- */
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";
const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";
const OPENAI_REALTIME_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "marin",
  "sage",
  "shimmer",
  "verse",
  "cedar",
]);

function buildConversationalWizardRealtimeInstructions(abstractionLabel) {
  const selectedAbstraction = String(abstractionLabel || "Multi-level").trim().slice(0, 120);
  return [
    "You are xHandle's warm, concise voice collaborator for functional-decomposition discovery.",
    `The selected decomposition depth is ${selectedAbstraction}.`,
    "Hold a natural conversation and ask exactly one highest-value question at a time.",
    "Before speaking after every user turn, call capture_architecture_brief with the complete user-grounded brief.",
    "Use empty strings for facts the user has not supplied. Never invent user facts; corrections replace earlier values.",
    "If the user supplies their name, greet them naturally once and remember it in the brief.",
    "Set ready true once the system identity or boundary and mission are clear enough for a useful draft and no unanswered question would materially change the architecture.",
    "Known functions, interfaces, and operating modes improve the result but are not mandatory because generation can infer them.",
    "When ready is true, tell the user that you have enough context and are starting the functional decomposition.",
    "Otherwise briefly reflect what you understood and ask one short question. Do not expose hidden reasoning or mention the tool.",
    "Keep spoken turns conversational and under 55 words.",
  ].join(" ");
}

app.post("/api/rt/session", llmLimiter, async (req, res) => {
  try {
    const apiKey = await resolveOpenAIKeyForRequest(req);
    if (!apiKey) {
      return res.status(401).json({
        error: "An OpenAI API key is required for Realtime voice. Save one in Settings or configure OPENAI_API_KEY.",
      });
    }

    const requestedVoice = String(req.body?.voice || "").trim().toLowerCase();
    const voice = OPENAI_REALTIME_VOICES.has(requestedVoice)
      ? requestedVoice
      : (OPENAI_REALTIME_VOICES.has(OPENAI_REALTIME_VOICE) ? OPENAI_REALTIME_VOICE : "marin");
    const abstractionLabel = String(req.body?.abstractionLabel || "Multi-level").trim();
    const r = await axios.post(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        session: {
          type: "realtime",
          model: OPENAI_REALTIME_MODEL,
          output_modalities: ["audio"],
          instructions: buildConversationalWizardRealtimeInstructions(abstractionLabel),
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
                language: "en",
              },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "medium",
                create_response: true,
                interrupt_response: true,
              },
            },
            output: { voice },
          },
          tools: [
            {
              type: "function",
              name: "capture_architecture_brief",
              description: "Record the complete grounded discovery brief before replying to the user.",
              parameters: {
                type: "object",
                properties: {
                  userName: { type: "string", description: "User name only when explicitly supplied, otherwise empty." },
                  systemName: { type: "string", description: "System name or boundary grounded in the conversation, otherwise empty." },
                  purpose: { type: "string", description: "Mission and system boundary grounded in the conversation, otherwise empty." },
                  components: { type: "string", description: "Concise newline-separated known functions or components, otherwise empty." },
                  interactions: { type: "string", description: "Concise newline-separated known interfaces and interactions, otherwise empty." },
                  operationalScenarios: { type: "string", description: "Concise newline-separated operational scenarios and modes, otherwise empty." },
                  assumptions: {
                    type: "array",
                    items: { type: "string" },
                    description: "Consequential assumptions that must remain visible to the user.",
                  },
                  ready: { type: "boolean", description: "Whether the grounded brief is ready for functional-decomposition generation." },
                },
                required: [
                  "userName",
                  "systemName",
                  "purpose",
                  "components",
                  "interactions",
                  "operationalScenarios",
                  "assumptions",
                  "ready",
                ],
                additionalProperties: false,
              },
            },
          ],
          tool_choice: "required",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15_000,
      }
    );
    res.set({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-AI-Voice-Model": OPENAI_REALTIME_MODEL,
      "X-AI-Voice": voice,
    });
    return res.status(r.status).json(r.data);
  } catch (err) {
    const normalized = extractProviderErrorMessage(err);
    logger.error("❌ /api/rt/session error:", normalized.details || normalized.message);
    return res.status(normalized.status).json({ error: normalized.message });
  }
});

/* ----------------------------- SQLite ----------------------------- */
let db = null;

try {
  const sqlite3 = require("sqlite3").verbose();
  db = new sqlite3.Database("./baselines.db", (err) => {
    if (err) logger.error("❌ Failed to connect to baselines database", err);
    else logger.debug("✅ Connected to baselines database");
  });

  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS github_configs (
        account_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        repo  TEXT NOT NULL,
        token TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS baselines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decomposition_data TEXT DEFAULT '[]'
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS openai_keys (
        account_id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Store one key per provider and remember which provider is currently active
    // for the account. This lets the backend route the generic /api/chat proxy to
    // OpenAI, Claude, or Gemini without changing callers across the app.
    db.run(`
      CREATE TABLE IF NOT EXISTS ai_provider_keys (
        account_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        api_key TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, provider)
      )
    `);

    // Backfill legacy OpenAI-only keys into the provider-aware table so older
    // installs keep working after the Settings modal is upgraded.
    db.run(`
      INSERT OR IGNORE INTO ai_provider_keys (account_id, provider, api_key, is_active, created_at, updated_at)
      SELECT account_id, 'openai', api_key, 1, created_at, updated_at
      FROM openai_keys
    `);
  });
} catch (e) {
  logger.error("⚠️ SQLite unavailable; continuing without DB:", e.message);
  db = {
    run(_q, _p, cb) { (cb || _p)?.(null); },
    all(_q, _p, cb) { (cb || _p)?.(null, []); },
    get(_q, _p, cb) { (cb || _p)?.(null, null); },
  };
}

const trustClientAccountHeader =
  process.env.TRUST_X_ACCOUNT_ID === "true" || process.env.LOCAL_DEV === "true";
const defaultAccountId =
  process.env.XHANDLE_ACCOUNT_ID ||
  process.env.DEV_ACCOUNT_ID ||
  "xhandle-local";

/* ----------------------------- Local account identity ----------------------------- */
app.use((req, _res, next) => {
  const requestedAccountId = req.header("x-account-id");
  req.user = {
    account_id: trustClientAccountHeader
      ? (requestedAccountId || defaultAccountId)
      : defaultAccountId,
  };
  next();
});

/* ----------------------------- OpenAI key storage helpers ----------------------------- */
function maskOpenAIKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}

const AI_PROVIDERS = {
  openai: {
    label: "OpenAI",
    defaultModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    envKey: () => process.env.OPENAI_API_KEY || process.env.OPENAI_TOKEN || null,
  },
  claude: {
    label: "Claude",
    defaultModel: process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
    envKey: () => process.env.ANTHROPIC_API_KEY || null,
  },
  gemini: {
    label: "Gemini",
    defaultModel: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    envKey: () => process.env.GEMINI_API_KEY || null,
  },
};

const GEMINI_MODEL_REPLACEMENTS = {
  "gemini-1.5-flash": "gemini-3.6-flash",
  "gemini-1.5-flash-001": "gemini-3.6-flash",
  "gemini-2.0-flash": "gemini-3.6-flash",
  "gemini-2.0-flash-001": "gemini-3.6-flash",
  "gemini-2.0-flash-lite": "gemini-3.1-flash-lite",
  "gemini-2.0-flash-lite-001": "gemini-3.1-flash-lite",
  "gemini-2.5-flash": "gemini-3.6-flash",
  "gemini-2.5-flash-preview-05-20": "gemini-3.6-flash",
  "gemini-2.5-flash-preview-09-25": "gemini-3.6-flash",
  "gemini-2.5-flash-lite": "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite-preview-09-2025": "gemini-3.1-flash-lite",
  "gemini-2.5-pro": "gemini-3.1-pro-preview",
};

const CLAUDE_MODEL_REPLACEMENTS = {
  "claude-3-5-haiku-latest": "claude-haiku-4-5",
  "claude-3-haiku-20240307": "claude-haiku-4-5",
  "claude-3-5-sonnet-latest": "claude-sonnet-5",
  "claude-3-5-sonnet-20241022": "claude-sonnet-5",
  "claude-3-7-sonnet-20250219": "claude-sonnet-5",
  "claude-sonnet-4-20250514": "claude-sonnet-5",
  "claude-opus-4-20250514": "claude-opus-5",
  "claude-opus-4-1-20250805": "claude-opus-5",
};

const MODEL_DISCOVERY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const providerModelCache = new Map();

const FALLBACK_PROVIDER_MODELS = {
  openai: [
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.1",
    "gpt-5",
    "gpt-5-mini",
    "gpt-4.1",
  ],
  claude: [
    "claude-haiku-4-5",
    "claude-sonnet-5",
    "claude-opus-5",
    "claude-fable-5",
    "claude-haiku-4-5-20251001",
  ],
  gemini: [
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite",
  ],
};

function normalizeAIProvider(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "anthropic") return "claude";
  if (normalized === "google" || normalized === "google-gemini") return "gemini";
  return Object.prototype.hasOwnProperty.call(AI_PROVIDERS, normalized) ? normalized : null;
}

function normalizeProviderApiKey(provider, apiKey) {
  const normalizedProvider = normalizeAIProvider(provider) || "openai";
  const trimmed = String(apiKey || "").replace(/^Bearer\s+/i, "").trim();
  if (normalizedProvider === "claude") {
    return trimmed.replace(/^Anthropic\s+/i, "").trim();
  }
  return trimmed;
}

function isPlaceholderAIKey(apiKey) {
  const key = String(apiKey || "").trim().toLowerCase();
  if (!key) return true;
  return (
    key.includes("your-") ||
    key.includes("your_") ||
    key.includes("placeholder") ||
    key.includes("example") ||
    key === "sk-your-openai-key" ||
    key === "sk-your-api-key" ||
    key === "sk-your-key"
  );
}

function usableProviderApiKey(provider, apiKey) {
  const key = normalizeProviderApiKey(provider, apiKey);
  return isPlaceholderAIKey(key) ? "" : key;
}

function providerLabel(provider) {
  return AI_PROVIDERS[provider]?.label || provider;
}

function maskAIKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}

function extractProviderErrorMessage(err) {
  const status = err?.status || err?.response?.status || err?.cause?.status || 500;
  const payload = err?.response?.data || err?.error || err?.cause || null;

  if (payload && typeof payload === "object") {
    const directMessage =
      payload.error?.message ||
      payload.message ||
      payload.error_description ||
      payload.details;

    if (directMessage) {
      return {
        status,
        message: String(directMessage),
        details: payload,
      };
    }
  }

  if (typeof err?.message === "string" && err.message.trim()) {
    return {
      status,
      message: err.message.trim(),
      details: payload,
    };
  }

  return {
    status,
    message: "LLM request failed",
    details: payload,
  };
}

function resolveModelForProvider(provider, requestedModel) {
  const model = typeof requestedModel === "string" ? requestedModel.trim() : "";
  const providerDefault = AI_PROVIDERS[provider]?.defaultModel || null;
  if (!model) {
    if (provider === "claude" && providerDefault) {
      return CLAUDE_MODEL_REPLACEMENTS[providerDefault] || providerDefault;
    }
    if (provider === "gemini" && providerDefault) {
      return GEMINI_MODEL_REPLACEMENTS[providerDefault] || providerDefault;
    }
    return providerDefault;
  }

  if (provider === "openai") return model;
  if (provider === "claude" && /^claude/i.test(model)) {
    return CLAUDE_MODEL_REPLACEMENTS[model] || model;
  }
  if (provider === "gemini" && /^gemini/i.test(model)) {
    return GEMINI_MODEL_REPLACEMENTS[model] || model;
  }

  return AI_PROVIDERS[provider]?.defaultModel || model;
}

function modelLabelFromId(id) {
  return String(id || "")
    .replace(/^models\//, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeDiscoveredModels(provider, payload) {
  const rows = provider === "openai"
    ? payload?.data
    : provider === "gemini"
      ? payload?.models
      : payload?.data;
  const models = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const rawId = row?.id || row?.name || row?.model || "";
      const id = String(rawId).replace(/^models\//, "").trim();
      if (!id) return null;
      if (provider === "gemini") {
        const methods = Array.isArray(row.supportedGenerationMethods) ? row.supportedGenerationMethods : [];
        if (methods.length && !methods.includes("generateContent")) return null;
      }
      return {
        id,
        value: id,
        label: row.displayName || row.display_name || modelLabelFromId(id),
        provider,
        source: "provider",
        description: row.description || "",
        createdAt: row.created ? new Date(row.created * 1000).toISOString() : row.created_at || null,
      };
    })
    .filter(Boolean);

  const seen = new Set();
  return models
    .filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    })
    .sort((a, b) => String(b.id).localeCompare(String(a.id), undefined, { numeric: true }));
}

function fallbackProviderModels(provider, reason = null) {
  return (FALLBACK_PROVIDER_MODELS[provider] || FALLBACK_PROVIDER_MODELS.openai).map((id) => ({
    id,
    value: id,
    label: modelLabelFromId(id),
    provider,
    source: "fallback",
    ...(reason ? { reason } : {}),
  }));
}

async function getProviderModelApiKey({ req, provider }) {
  const headerProvider = normalizeAIProvider(req.header("x-ai-provider")) || provider;
  const headerKey = usableProviderApiKey(provider, headerProvider === provider ? req.header("x-ai-api-key") : "");
  if (headerKey) return headerKey;

  const accountId = req.user?.account_id;
  if (accountId) {
    const stored = await getStoredAIProviderKey(accountId, provider);
    const storedKey = usableProviderApiKey(provider, stored?.api_key);
    if (storedKey) return storedKey;
  }

  return usableProviderApiKey(provider, AI_PROVIDERS[provider]?.envKey?.());
}

async function discoverProviderModels(provider, apiKey) {
  if (provider === "openai") {
    const resp = await axios.get("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 20_000,
    });
    return normalizeDiscoveredModels(provider, resp.data);
  }
  if (provider === "claude") {
    const resp = await axios.get("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      timeout: 20_000,
    });
    return normalizeDiscoveredModels(provider, resp.data);
  }
  if (provider === "gemini") {
    const resp = await axios.get("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": apiKey },
      timeout: 20_000,
    });
    return normalizeDiscoveredModels(provider, resp.data);
  }
  return [];
}

/**
 * toJsonSafe encapsulates a focused piece of backend request pipeline logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param value} Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function toJsonSafe(value) {
  if (value == null) return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => toJsonSafe(item))
      .filter((item) => typeof item !== "undefined");
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, toJsonSafe(item)])
        .filter(([, item]) => typeof item !== "undefined")
    );
  }
  return value;
}

/**
 * normalizeMessageContent prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param content} Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function normalizeMessageContent(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return String(part ?? "");
        if (typeof part.text === "string") return part.text;
        if (typeof part.input_text === "string") return part.input_text;
        if (part.type === "text" && typeof part.content === "string") return part.content;
        return JSON.stringify(toJsonSafe(part));
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.input_text === "string") return content.input_text;
    return JSON.stringify(toJsonSafe(content));
  }

  return String(content);
}

function normalizeMultimodalMessageContent(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return { type: "text", text: part };
        if (!part || typeof part !== "object") return { type: "text", text: String(part ?? "") };
        if ((part.type === "text" || part.type === "input_text") && typeof (part.text || part.input_text) === "string") {
          return { type: "text", text: part.text || part.input_text };
        }
        const imageUrl = typeof part.image_url?.url === "string"
          ? part.image_url.url
          : (typeof part.image_url === "string"
            ? part.image_url
            : (typeof part.input_image === "string" ? part.input_image : ""));
        if ((part.type === "image_url" || part.type === "input_image") && imageUrl) {
          return { type: "image_url", image_url: { url: imageUrl } };
        }
        return { type: "text", text: JSON.stringify(toJsonSafe(part)) };
      })
      .filter((part) => {
        if (part.type === "image_url") return Boolean(part.image_url?.url);
        return String(part.text || "").trim().length > 0;
      });
  }

  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.input_text === "string") return content.input_text;
    return JSON.stringify(toJsonSafe(content));
  }

  return String(content);
}

function hasUsableMessageContent(content) {
  if (typeof content === "string") return content.trim().length > 0;
  if (Array.isArray(content)) {
    return content.some((part) => (
      (part?.type === "text" && String(part?.text || "").trim()) ||
      (part?.type === "image_url" && part?.image_url?.url)
    ));
  }
  return false;
}

/**
 * normalizeChatMessages prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param messages} Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function normalizeChatMessages(messages, options = {}) {
  if (!Array.isArray(messages)) return [];
  const preserveMultimodal = Boolean(options.preserveMultimodal);

  return messages
    .filter((message) => message && typeof message === "object")
    .map((message) => ({
      role: typeof message.role === "string" ? message.role : "user",
      content: preserveMultimodal
        ? normalizeMultimodalMessageContent(message.content)
        : normalizeMessageContent(message.content),
    }))
    .filter((message) => hasUsableMessageContent(message.content));
}

/**
 * buildChatCompletionPayload constructs the derived result needed by the feature for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param body} Input consumed by this step of the xHandle workflow.
 * @param messages} Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function buildChatCompletionPayload(body, messages) {
  const payload = {
    model: typeof body.model === "string" ? body.model : "gpt-4o-mini",
    messages,
  };

  const optionalFields = [
    "temperature",
    "max_tokens",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "seed",
    "response_format",
    "tools",
    "tool_choice",
    "logit_bias",
  ];

  for (const field of optionalFields) {
    const value = toJsonSafe(body[field]);
    if (typeof value !== "undefined") {
      payload[field] = value;
    }
  }

  if (body.userId != null) {
    payload.user = String(body.userId);
  }

  const modelName = String(payload.model || "").toLowerCase();
  const usesReasoningModelControls = /^(gpt-5(?:[.-]|$)|o[1-9](?:[.-]|$))/.test(modelName);
  if (usesReasoningModelControls) {
    if (payload.max_tokens != null && payload.max_completion_tokens == null) {
      payload.max_completion_tokens = payload.max_tokens;
    }
    delete payload.max_tokens;
    delete payload.temperature;
    delete payload.top_p;
  }

  return payload;
}

/**
 * getStoredOpenAIKey reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param accountId} Stable identifier for the entity this step works with.
 * @returns the normalized data requested by this module.
 */
function getStoredOpenAIKey(accountId) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT api_key, created_at, updated_at FROM openai_keys WHERE account_id = ?",
      [accountId],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

function listStoredAIProviderKeys(accountId) {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT provider, api_key, is_active, created_at, updated_at FROM ai_provider_keys WHERE account_id = ? ORDER BY provider ASC",
      [accountId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(Array.isArray(rows) ? rows : []);
      }
    );
  });
}

function getStoredAIProviderKey(accountId, provider) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT provider, api_key, is_active, created_at, updated_at FROM ai_provider_keys WHERE account_id = ? AND provider = ?",
      [accountId, provider],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

function saveStoredAIProviderKey(accountId, provider, apiKey, activate = true) {
  const now = new Date().toISOString();
  const isActive = activate ? 1 : 0;
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      if (activate) {
        db.run(
          "UPDATE ai_provider_keys SET is_active = 0 WHERE account_id = ?",
          [accountId]
        );
      }

      db.run(
        `INSERT INTO ai_provider_keys (account_id, provider, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, provider)
         DO UPDATE SET api_key=excluded.api_key, is_active=excluded.is_active, updated_at=excluded.updated_at`,
        [accountId, provider, apiKey, isActive, now, now],
        function (err) {
          if (err) return reject(err);
          resolve(true);
        }
      );
    });
  });
}

function setActiveAIProvider(accountId, provider) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("UPDATE ai_provider_keys SET is_active = 0 WHERE account_id = ?", [accountId]);
      db.run(
        "UPDATE ai_provider_keys SET is_active = 1, updated_at = ? WHERE account_id = ? AND provider = ?",
        [new Date().toISOString(), accountId, provider],
        function (err) {
          if (err) return reject(err);
          resolve(this.changes > 0);
        }
      );
    });
  });
}

function deleteStoredAIProviderKey(accountId, provider) {
  return new Promise((resolve, reject) => {
    db.run(
      "DELETE FROM ai_provider_keys WHERE account_id = ? AND provider = ?",
      [accountId, provider],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

/**
 * saveStoredOpenAIKey writes module state into the storage or backend boundary used by xHandle. Keeping persistence logic in a dedicated function makes it easier to reason about when engineering artifacts become durable.
 * @param accountId} Stable identifier for the entity this step works with.
 * @param apiKey} Input consumed by this step of the xHandle workflow.
 * @returns completion of the persistence operation.
 */
function saveStoredOpenAIKey(accountId, apiKey) {
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO openai_keys (account_id, api_key, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET api_key=excluded.api_key, updated_at=excluded.updated_at`,
      [accountId, apiKey, now, now],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

/**
 * deleteStoredOpenAIKey encapsulates a focused piece of backend request pipeline logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param accountId} Stable identifier for the entity this step works with.
 * @returns completion of the persistence operation.
 */
function deleteStoredOpenAIKey(accountId) {
  return new Promise((resolve, reject) => {
    db.run(
      "DELETE FROM openai_keys WHERE account_id = ?",
      [accountId],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

/**
 * resolveOpenAIKeyForRequest encapsulates a focused piece of backend request pipeline logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param req} Express request object for the current API call.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function resolveOpenAIKeyForRequest(req) {
  const headerProvider = normalizeAIProvider(req.header("x-ai-provider")) || "openai";
  const headerApiKey = usableProviderApiKey(headerProvider, req.header("x-ai-api-key"));
  if (headerProvider === "openai" && headerApiKey) {
    return headerApiKey;
  }

  const accountId = req.user?.account_id;

  if (accountId) {
    const stored = await getStoredOpenAIKey(accountId);
    const storedKey = usableProviderApiKey("openai", stored?.api_key);
    if (storedKey) {
      return storedKey;
    }
  }

  return usableProviderApiKey("openai", process.env.OPENAI_API_KEY || process.env.OPENAI_TOKEN);
}

async function resolveAIConfigForRequest(req) {
  const body = req.body || {};
  const requestedProvider = normalizeAIProvider(body.provider);
  const headerProvider = normalizeAIProvider(req.header("x-ai-provider"));
  const headerApiKey = usableProviderApiKey(headerProvider || requestedProvider, req.header("x-ai-api-key"));
  const headerModel = req.header("x-ai-model");
  const accountId = req.user?.account_id;

  if (headerProvider && headerApiKey) {
    return {
      provider: headerProvider,
      apiKey: headerApiKey,
      model: resolveModelForProvider(headerProvider, headerModel || body.model),
    };
  }

  if (accountId) {
    if (requestedProvider) {
      const stored = await getStoredAIProviderKey(accountId, requestedProvider);
      const storedKey = usableProviderApiKey(requestedProvider, stored?.api_key);
      if (storedKey) {
        return {
          provider: requestedProvider,
          apiKey: storedKey,
          model: resolveModelForProvider(requestedProvider, headerModel || body.model),
        };
      }
    }

    const savedProviders = await listStoredAIProviderKeys(accountId);
    const activeStored = savedProviders.find((row) => row.is_active);
    const activeStoredKey = usableProviderApiKey(activeStored?.provider, activeStored?.api_key);
    if (activeStoredKey) {
      return {
        provider: activeStored.provider,
        apiKey: activeStoredKey,
        model: resolveModelForProvider(activeStored.provider, headerModel || body.model),
      };
    }
  }

  const envProviderOrder = requestedProvider
    ? [requestedProvider]
    : ["openai", "claude", "gemini"];

  for (const provider of envProviderOrder) {
    const apiKey = usableProviderApiKey(provider, AI_PROVIDERS[provider]?.envKey?.());
    if (apiKey) {
      return {
        provider,
        apiKey,
        model: resolveModelForProvider(provider, headerModel || body.model),
      };
    }
  }

  return null;
}

function splitSystemMessages(messages) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
    .trim();

  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));

  return { system, conversation };
}

function toOpenAICompatibleResponse({ provider, model, text, raw, finishReason = "stop" }) {
  return {
    id: raw?.id || `${provider}-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    provider,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || "",
        },
        finish_reason: finishReason,
      },
    ],
    raw,
  };
}

function writeTextAsSse(res, text, finishReason = "stop") {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (text) res.write(`data: ${JSON.stringify(text)}\n\n`);
  res.write(`event: metadata\ndata: ${JSON.stringify({ finish_reason: finishReason })}\n\n`);
  res.write("event: done\ndata: [DONE]\n\n");
  res.end();
}

async function callClaudeChat({ apiKey, body, messages, model }) {
  const { system, conversation } = splitSystemMessages(messages);
  const payload = {
    model,
    max_tokens: Number(body.max_tokens) || 1200,
    messages: conversation.length ? conversation : [{ role: "user", content: body.prompt || "Continue." }],
  };

  if (system) payload.system = system;
  if (typeof body.temperature === "number") {
    payload.temperature = body.temperature;
  } else if (typeof body.top_p === "number") {
    payload.top_p = body.top_p;
  }
  if (typeof body.top_k === "number") payload.top_k = body.top_k;
  if (Array.isArray(body.stop_sequences)) payload.stop_sequences = body.stop_sequences;

  const resp = await axios.post("https://api.anthropic.com/v1/messages", payload, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    timeout: 180_000,
  });

  const text = Array.isArray(resp.data?.content)
    ? resp.data.content.filter((part) => part?.type === "text").map((part) => part.text || "").join("")
    : "";

  return toOpenAICompatibleResponse({
    provider: "claude",
    model,
    text,
    raw: resp.data,
    finishReason: resp.data?.stop_reason === "max_tokens" ? "length" : "stop",
  });
}

async function callGeminiChat({ apiKey, body, messages, model }) {
  const { system, conversation } = splitSystemMessages(messages);
  const payload = {
    contents: (conversation.length ? conversation : [{ role: "user", content: body.prompt || "Continue." }]).map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
  };

  if (system) {
    payload.system_instruction = {
      parts: [{ text: system }],
    };
  }

  const generationConfig = {};
  if (typeof body.temperature === "number") generationConfig.temperature = body.temperature;
  if (typeof body.top_p === "number") generationConfig.topP = body.top_p;
  if (typeof body.max_tokens === "number") generationConfig.maxOutputTokens = body.max_tokens;
  if (Array.isArray(body.stop_sequences)) generationConfig.stopSequences = body.stop_sequences;
  if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig;

  let resolvedModel = GEMINI_MODEL_REPLACEMENTS[model] || model;
  let resp;
  try {
    resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolvedModel)}:generateContent`,
      payload,
      {
        headers: {
          "x-goog-api-key": apiKey,
          "content-type": "application/json",
        },
        timeout: 180_000,
      }
    );
  } catch (error) {
    const replacement = GEMINI_MODEL_REPLACEMENTS[resolvedModel];
    if (!(replacement && error?.response?.status === 404)) {
      throw error;
    }
    resolvedModel = replacement;
    resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolvedModel)}:generateContent`,
      payload,
      {
        headers: {
          "x-goog-api-key": apiKey,
          "content-type": "application/json",
        },
        timeout: 180_000,
      }
    );
  }

  const text = Array.isArray(resp.data?.candidates)
    ? resp.data.candidates
        .flatMap((candidate) => candidate?.content?.parts || [])
        .map((part) => part?.text || "")
        .join("")
    : "";

  return toOpenAICompatibleResponse({
    provider: "gemini",
    model: resolvedModel,
    text,
    raw: resp.data,
    finishReason: resp.data?.candidates?.[0]?.finishReason === "MAX_TOKENS" ? "length" : "stop",
  });
}

/* ----------------------------- OpenAI key endpoints ----------------------------- */
app.get("/api/ai-provider/status", async (req, res) => {
  try {
    const accountId = req.user?.account_id;
    if (!accountId) return res.status(401).json({ error: "Missing account" });

    const savedProviders = await listStoredAIProviderKeys(accountId);
    const activeStored = savedProviders.find((row) => row.is_active) || null;

    res.json({
      ok: true,
      availableProviders: Object.keys(AI_PROVIDERS),
      activeProvider: activeStored?.provider || null,
      connected: !!activeStored?.api_key,
      maskedKey: activeStored?.api_key ? maskAIKey(activeStored.api_key) : null,
      savedProviders: savedProviders.map((row) => ({
        provider: row.provider,
        label: providerLabel(row.provider),
        connected: !!row.api_key,
        verified: !!row.api_key,
        isActive: !!row.is_active,
        maskedKey: maskAIKey(row.api_key),
        last4: row.api_key ? row.api_key.slice(-4) : null,
      })),
    });
  } catch (e) {
    logger.error("GET /api/ai-provider/status error:", e);
    res.status(500).json({ error: "Failed to load AI provider status" });
  }
});

app.get("/api/ai-provider/models", async (req, res) => {
  const provider = normalizeAIProvider(req.query?.provider || req.header("x-ai-provider") || "openai");
  if (!provider) return res.status(400).json({ ok: false, error: "Invalid provider" });

  const cacheKey = provider;
  const refresh = String(req.query?.refresh || "").toLowerCase() === "true";
  const cached = providerModelCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.cachedAt < MODEL_DISCOVERY_CACHE_TTL_MS) {
    return res.json({
      ok: true,
      provider,
      source: cached.source,
      cached: true,
      cachedAt: new Date(cached.cachedAt).toISOString(),
      models: cached.models,
    });
  }

  try {
    const apiKey = await getProviderModelApiKey({ req, provider });
    if (!apiKey) {
      const models = fallbackProviderModels(provider, "No provider API key available for discovery.");
      return res.json({ ok: true, provider, source: "fallback", cached: false, models });
    }

    const discoveredModels = await discoverProviderModels(provider, apiKey);
    const models = discoveredModels.length ? discoveredModels : fallbackProviderModels(provider, "Provider returned no models.");
    const source = discoveredModels.length ? "provider" : "fallback";
    providerModelCache.set(cacheKey, { source, models, cachedAt: Date.now() });
    res.json({ ok: true, provider, source, cached: false, models });
  } catch (e) {
    const extracted = extractProviderErrorMessage(e);
    logger.warn(`GET /api/ai-provider/models ${provider} fallback:`, extracted.message);
    const models = cached?.models || fallbackProviderModels(provider, extracted.message);
    res.json({
      ok: true,
      provider,
      source: cached ? cached.source : "fallback",
      cached: !!cached,
      warning: extracted.message,
      models,
    });
  }
});

app.post("/api/ai-provider/key", async (req, res) => {
  try {
    const accountId = req.user?.account_id;
    const provider = normalizeAIProvider(req.body?.provider);
    const apiKey = req.body?.apiKey?.trim();
    const activate = req.body?.activate !== false;

    if (!accountId) return res.status(401).json({ error: "Missing account" });
    if (!provider) return res.status(400).json({ ok: false, error: "Invalid provider" });
    if (!apiKey) return res.status(400).json({ ok: false, error: "Missing apiKey" });

    await saveStoredAIProviderKey(accountId, provider, apiKey, activate);
    if (provider === "openai") {
      await saveStoredOpenAIKey(accountId, apiKey);
    }

    res.json({
      ok: true,
      provider,
      activeProvider: activate ? provider : null,
      connected: true,
      maskedKey: maskAIKey(apiKey),
      last4: apiKey.slice(-4),
    });
  } catch (e) {
    logger.error("POST /api/ai-provider/key error:", e);
    res.status(500).json({ ok: false, error: "Failed to save provider key" });
  }
});

app.post("/api/ai-provider/activate", async (req, res) => {
  try {
    const accountId = req.user?.account_id;
    const provider = normalizeAIProvider(req.body?.provider);

    if (!accountId) return res.status(401).json({ error: "Missing account" });
    if (!provider) return res.status(400).json({ ok: false, error: "Invalid provider" });

    const exists = await getStoredAIProviderKey(accountId, provider);
    if (!exists?.api_key) {
      return res.status(404).json({ ok: false, error: "No saved key for that provider" });
    }

    await setActiveAIProvider(accountId, provider);

    res.json({
      ok: true,
      activeProvider: provider,
      connected: true,
      maskedKey: maskAIKey(exists.api_key),
      last4: exists.api_key.slice(-4),
    });
  } catch (e) {
    logger.error("POST /api/ai-provider/activate error:", e);
    res.status(500).json({ ok: false, error: "Failed to activate provider" });
  }
});

app.delete("/api/ai-provider/key", async (req, res) => {
  try {
    const accountId = req.user?.account_id;
    const provider = normalizeAIProvider(req.body?.provider || req.query?.provider);
    if (!accountId) return res.status(401).json({ error: "Missing account" });
    if (!provider) return res.status(400).json({ ok: false, error: "Invalid provider" });

    await deleteStoredAIProviderKey(accountId, provider);
    if (provider === "openai") {
      await deleteStoredOpenAIKey(accountId);
    }

    const savedProviders = await listStoredAIProviderKeys(accountId);
    if (savedProviders.length && !savedProviders.some((row) => row.is_active)) {
      await setActiveAIProvider(accountId, savedProviders[0].provider);
    }

    res.json({ ok: true, provider, connected: false });
  } catch (e) {
    logger.error("DELETE /api/ai-provider/key error:", e);
    res.status(500).json({ error: "Failed to delete provider key" });
  }
});

app.get("/api/openai/key/status", async (req, res) => {
  try {
    const accountId = req.user?.account_id;
    if (!accountId) return res.status(401).json({ error: "Missing account" });

    const stored = await getStoredAIProviderKey(accountId, "openai");

    res.json({
      ok: true,
      connected: !!stored?.api_key,
      maskedKey: stored?.api_key ? maskAIKey(stored.api_key) : null,
    });
  } catch (e) {
    logger.error("GET /api/openai/key/status error:", e);
    res.status(500).json({ error: "Failed to load key" });
  }
});

app.post("/api/openai/key", async (req, res) => {
  try {
    const accountId = req.user?.account_id;
    const apiKey = req.body?.apiKey?.trim();

    if (!accountId) return res.status(401).json({ error: "Missing account" });
    if (!apiKey) return res.status(400).json({ ok: false, error: "Missing apiKey" });

    await saveStoredOpenAIKey(accountId, apiKey);
    await saveStoredAIProviderKey(accountId, "openai", apiKey, true);

    res.json({
      ok: true,
      connected: true,
      maskedKey: maskAIKey(apiKey),
    });
  } catch (e) {
    logger.error("POST /api/openai/key error:", e);
    res.status(500).json({ ok: false, error: "Failed to save key" });
  }
});

app.delete("/api/openai/key", async (req, res) => {
  try {
    const accountId = req.user?.account_id;
    if (!accountId) return res.status(401).json({ error: "Missing account" });

    await deleteStoredOpenAIKey(accountId);
    await deleteStoredAIProviderKey(accountId, "openai");

    res.json({ ok: true, connected: false });
  } catch (e) {
    logger.error("DELETE /api/openai/key error:", e);
    res.status(500).json({ error: "Failed to delete key" });
  }
});

/* ----------------------------- Google Drive Integration ----------------------------- */
let _driveClient = null;
/**
 * getDriveClient reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @returns Promise resolving to the normalized data requested by this module.
 */
async function getDriveClient() {
  if (_driveClient) return _driveClient;

  let auth;
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const creds = JSON.parse(saJson);
    auth = new google.auth.JWT(
      creds.client_email,
      undefined,
      creds.private_key,
      [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ]
    );
  } else {
    const keyPath = path.join(__dirname, "google-drive/config/service-account-key.json");
    if (!fs.existsSync(keyPath)) {
      throw new Error(
        "Google service account credentials not found (set GOOGLE_SERVICE_ACCOUNT_JSON or provide key file)."
      );
    }
    auth = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ],
    });
  }

  _driveClient = {
    drive: google.drive({ version: "v3", auth }),
    sheets: google.sheets({ version: "v4", auth }),
  };
  return _driveClient;
}

app.get("/api/files", async (req, res) => {
  try {
    const { drive, sheets } = await getDriveClient();
    const folderId = "1gT3I2e5SJXNWIoeMUTVzsfh0Jh29QI4L";

    const { data } = await drive.files.list({
      q: `'${folderId}' in parents`,
      fields: "files(id, name, mimeType)",
    });

    const filesWithContent = await Promise.all(
      (data.files || []).map(async (file) => {
        try {
          let content = "Unsupported file type.";

          if (file.mimeType === "application/vnd.google-apps.document") {
            const { data: contentData } = await drive.files.export({
              fileId: file.id,
              mimeType: "text/plain",
            });
            content = contentData;
          } else if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
            const metadata = await sheets.spreadsheets.get({ spreadsheetId: file.id });
            const sheetNames = (metadata.data.sheets || []).map((s) => s.properties.title);
            const sheetContents = {};
            for (const sheetName of sheetNames) {
              try {
                const sheetData = await sheets.spreadsheets.values.get({
                  spreadsheetId: file.id,
                  range: `${sheetName}!A1:Z1000`,
                });
                sheetContents[sheetName] = sheetData.data.values ?? [["(No Data)"]];
              } catch {
                sheetContents[sheetName] = [["Error reading sheet."]];
              }
            }
            content = JSON.stringify(sheetContents);
          } else if (file.mimeType === "application/pdf") {
            const { data: pdfBuffer } = await drive.files.get(
              { fileId: file.id, alt: "media" },
              { responseType: "arraybuffer" }
            );
            const pdfData = await pdfParse(Buffer.from(pdfBuffer));
            content = pdfData.text;
          } else if (file.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
            const tmpPath = path.join(__dirname, `${file.id}.docx`);
            const { data: docxBuffer } = await drive.files.get(
              { fileId: file.id, alt: "media" },
              { responseType: "arraybuffer" }
            );
            fs.writeFileSync(tmpPath, Buffer.from(docxBuffer));
            const docxText = await mammoth.extractRawText({ path: tmpPath });
            content = docxText.value;
            fs.unlinkSync(tmpPath);
          }

          return { ...file, content };
        } catch {
          return { ...file, content: "Error reading file." };
        }
      })
    );

    res.json(filesWithContent);
  } catch (e) {
    logger.error("Google Drive init error:", e.message);
    res.status(503).json({ error: "Google Drive not configured on this deployment" });
  }
});

/** 🔹 GITHUB **/
function getGithubConfig(accountId) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT owner, repo, token FROM github_configs WHERE account_id = ?",
      [accountId],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

/**
 * saveGithubConfig writes module state into the storage or backend boundary used by xHandle. Keeping persistence logic in a dedicated function makes it easier to reason about when engineering artifacts become durable.
 * @param accountId} Stable identifier for the entity this step works with.
 * @param owner} Input consumed by this step of the xHandle workflow.
 * @param repo} Input consumed by this step of the xHandle workflow.
 * @param token} Input consumed by this step of the xHandle workflow.
 * @returns completion of the persistence operation.
 */
function saveGithubConfig(accountId, owner, repo, token) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO github_configs (account_id, owner, repo, token)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET owner=excluded.owner, repo=excluded.repo, token=excluded.token`,
      [accountId, owner, repo, token],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

/**
 * loadGithubConfig reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param req} Express request object for the current API call.
 * @param res} Express response object used to return data to the client.
 * @param next} Express next callback used to continue middleware processing.
 * @returns Promise resolving to the normalized data requested by this module.
 */
async function loadGithubConfig(req, res, next) {
  try {
    const accountId = req.user?.account_id;
    if (!accountId) return res.status(401).json({ error: "Missing account" });
    const cfg = await getGithubConfig(accountId);
    if (!cfg) {
      return res.status(428).json({
        error: "GitHub repository not configured. POST /api/config/repo first.",
      });
    }
    req.github = {
      owner: cfg.owner,
      repo: cfg.repo,
      token: cfg.token || null,
    };
    next();
  } catch (e) {
    logger.error("loadGithubConfig error:", e);
    res.status(500).json({ error: "Failed to load GitHub config" });
  }
}

/**
 * makeGithubClientFrom encapsulates a focused piece of backend request pipeline logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param req} Express request object for the current API call.
 * @returns the value that the next step in this workflow consumes.
 */
function makeGithubClientFrom(req) {
  const { owner, repo, token } = req.github;
  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "xhandle-server",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const baseURL = `https://api.github.com/repos/${owner}/${repo}`;
  return axios.create({ baseURL, headers });
}

app.post("/api/config/repo", async (req, res) => {
  try {
    const accountId = req.user?.account_id;
    if (!accountId) return res.status(401).json({ error: "Missing account" });

    const { owner, repo, token } = req.body || {};
    if (!owner || !repo) {
      return res.status(400).json({ error: "owner and repo are required" });
    }

    await saveGithubConfig(String(accountId), String(owner), String(repo), token ? String(token) : null);
    logger.debug("🔄 Repo config saved:", {
      accountId,
      owner,
      repo,
      token: token ? "*****" : "(none)",
    });
    res.json({ ok: true });
  } catch (e) {
    logger.error("POST /api/config/repo error:", e);
    res.status(500).json({ error: "Failed to save repo config" });
  }
});

app.get("/api/config/repo", async (req, res) => {
  try {
    const accountId = req.user?.account_id;
    if (!accountId) return res.status(401).json({ error: "Missing account" });
    const cfg = await getGithubConfig(accountId);
    if (!cfg) return res.json({ owner: null, repo: null, hasToken: false });
    res.json({ owner: cfg.owner, repo: cfg.repo, hasToken: !!cfg.token });
  } catch (e) {
    logger.error("GET /api/config/repo error:", e);
    res.status(500).json({ error: "Failed to load repo config" });
  }
});

/**
 * ghRepoGet encapsulates a focused piece of backend request pipeline logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param req} Express request object for the current API call.
 * @param path} Input consumed by this step of the xHandle workflow.
 * @param params} Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function ghRepoGet(req, path, params = {}) {
  try {
    const client = makeGithubClientFrom(req);
    const resp = await client.get(path, { params });
    return resp.data;
  } catch (err) {
    const code = err?.response?.status;
    const rl = err?.response?.headers;
    const remaining = rl?.["x-ratelimit-remaining"];
    const limit = rl?.["x-ratelimit-limit"];
    const reset = rl?.["x-ratelimit-reset"];

    if (code === 401 || code === 403) {
      const why = req.github?.token
        ? "Token may be invalid or missing repo scopes."
        : "Repo might be private or anonymous rate limit was exceeded.";
      const extra = remaining != null ? ` (rate ${remaining}/${limit}, reset ${reset})` : "";
      const msg = `GitHub access denied (${code}). ${why}${extra}`;
      logger.error("GitHub error:", msg, err?.response?.data);
      throw new Error(msg);
    }
    throw err;
  }
}

/**
 * getDefaultBranch reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param req} Express request object for the current API call.
 * @returns Promise resolving to the normalized data requested by this module.
 */
async function getDefaultBranch(req) {
  const data = await ghRepoGet(req, "");
  return data?.default_branch || "main";
}

/**
 * resolveBranchToSha encapsulates a focused piece of backend request pipeline logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param req} Express request object for the current API call.
 * @param branch} Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function resolveBranchToSha(req, branch) {
  const data = await ghRepoGet(req, `/branches/${encodeURIComponent(branch)}`);
  return data?.commit?.sha;
}

app.get("/api/github/commits", loadGithubConfig, async (req, res) => {
  try {
    const data = await ghRepoGet(req, "/commits", { per_page: 5 });
    res.json(data);
  } catch (error) {
    logger.error("❌ Error fetching GitHub commits:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to retrieve GitHub commits." });
  }
});

/**
 * repoFilesHandler encapsulates a focused piece of backend request pipeline logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param req} Express request object for the current API call.
 * @param res} Express response object used to return data to the client.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function repoFilesHandler(req, res) {
  try {
    const client = makeGithubClientFrom(req);
    const defaultBranch = await getDefaultBranch(req);
    const branchMeta = await client.get(`/branches/${encodeURIComponent(defaultBranch)}`);
    const sha = branchMeta?.data?.commit?.sha;
    if (!sha) return res.status(404).json({ error: "Branch not found" });

    const treeResp = await client.get(`/git/trees/${sha}`, { params: { recursive: 1 } });
    const tree = treeResp?.data?.tree;
    if (!Array.isArray(tree)) return res.status(404).json({ error: "No tree found" });

    const badDirs = [/^node_modules\//, /^\.git\//, /^venv\//, /^site-packages\//];
    const files = tree
      .filter((n) => n.type === "blob")
      .map((n) => n.path)
      .filter((p) =>
        /\.(mjs|cjs|js|jsx|ts|tsx|py)$/i.test(p) &&
        !badDirs.some((rx) => rx.test(p))
      )
      .map((p) => ({ path: p, name: p.split("/").pop() }));

    res.json(files);
  } catch (err) {
    logger.error("❌ repo-files:", err?.response?.data || err.message);
    res.status(500).json({ error: "Failed to list repo files" });
  }
}

app.post("/api/github/repo-files", async (req, res, next) => {
  const { owner, repo, token } = req.body || {};
  if (owner && repo) {
    req.github = { owner, repo, token: token || null };
    return repoFilesHandler(req, res);
  }
  next();
}, loadGithubConfig, repoFilesHandler);

app.get("/api/github/repo-files", loadGithubConfig, repoFilesHandler);

app.get("/api/github/file", loadGithubConfig, async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: "Missing ?path" });

    const defaultBranch = await getDefaultBranch(req);
    const data = await ghRepoGet(req, `/contents/${encodeURIComponent(filePath)}`, {
      ref: defaultBranch,
    });

    if (!data || !data.content) {
      return res.status(404).json({ error: "File not found or empty" });
    }

    res.json({
      name: data.name,
      encoding: data.encoding || "base64",
      content: data.content,
      sha: data.sha,
      path: data.path,
    });
  } catch (err) {
    logger.error("❌ /api/github/file:", err?.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch file content" });
  }
});

/* ----------------------------- Baselines API ----------------------------- */
app.get("/api/baselines", (req, res) => {
  db.all("SELECT * FROM baselines", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const processed = rows.map((b) => ({
      ...b,
      decomposition_data: b.decomposition_data ? JSON.parse(b.decomposition_data) : [],
    }));
    res.json(processed);
  });
});

app.post("/api/baselines", (req, res) => {
  const { name, decomposition_data } = req.body;
  const createdAt = new Date().toISOString();
  db.run(
    "INSERT INTO baselines (name, created_at, decomposition_data) VALUES (?, ?, ?)",
    [name, createdAt, JSON.stringify(decomposition_data || [])],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, created_at: createdAt, decomposition_data: decomposition_data || [] });
    }
  );
});

app.delete("/api/baselines/:id", (req, res) => {
  db.run("DELETE FROM baselines WHERE id = ?", req.params.id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

/* ----------------------------- OpenAI natural speech proxy ----------------------------- */
const OPENAI_SPEECH_MODEL = process.env.OPENAI_SPEECH_MODEL || "gpt-4o-mini-tts";
const OPENAI_SPEECH_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "marin",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "cedar",
]);

app.post("/api/audio/speech", llmLimiter, async (req, res) => {
  try {
    const apiKey = await resolveOpenAIKeyForRequest(req);
    if (!apiKey) {
      return res.status(401).json({
        error: "An OpenAI API key is required for natural voice. Save one in Settings or configure OPENAI_API_KEY.",
      });
    }

    const input = String(req.body?.input || "").trim();
    if (!input) return res.status(400).json({ error: "Speech input is required." });
    if (input.length > 8000) {
      return res.status(400).json({ error: "Speech input is too long." });
    }

    const requestedVoice = String(req.body?.voice || "").trim().toLowerCase();
    const voice = OPENAI_SPEECH_VOICES.has(requestedVoice)
      ? requestedVoice
      : (process.env.OPENAI_SPEECH_VOICE || "marin");
    const response = await axios.post(
      "https://api.openai.com/v1/audio/speech",
      {
        model: OPENAI_SPEECH_MODEL,
        voice,
        input,
        instructions: "Speak naturally and warmly, like a thoughtful engineering collaborator. Use conversational pacing, subtle emphasis, and short pauses. Avoid an announcer voice.",
        response_format: "mp3",
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
        timeout: 45_000,
      },
    );

    res.set({
      "Content-Type": response.headers["content-type"] || "audio/mpeg",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-AI-Voice-Model": OPENAI_SPEECH_MODEL,
      "X-AI-Voice": voice,
    });
    return res.status(200).send(Buffer.from(response.data));
  } catch (err) {
    const normalized = extractProviderErrorMessage(err);
    logger.error("❌ /api/audio/speech error:", normalized.details || normalized.message);
    return res.status(normalized.status).json({ error: normalized.message });
  }
});

/* ----------------------------- Secure AI chat proxy ----------------------------- */
app.post(["/api/chat", "/api/chatgpt", "/chat"], llmLimiter, async (req, res) => {
  try {
    const resolved = await resolveAIConfigForRequest(req);
    if (!resolved?.apiKey || !resolved?.provider) {
      return res.status(401).json({
        error: "No AI provider key available. Save a local AI provider key in Settings before running AI workflows.",
      });
    }

    const body = req.body || {};
    const provider = resolved.provider;
    const messages = Array.isArray(body.messages)
      ? normalizeChatMessages(body.messages, { preserveMultimodal: provider === "openai" })
      : (typeof body.prompt === "string" ? [{ role: "user", content: body.prompt }] : []);

    if (messages.length === 0) {
      return res.status(400).json({ error: "Provide messages[] or prompt" });
    }

    const stream = body.stream === true;
    const model = resolved.model || AI_PROVIDERS[provider]?.defaultModel;

    if (provider === "claude") {
      const resp = await callClaudeChat({
        apiKey: resolved.apiKey,
        body: { temperature: 0.2, ...body },
        messages,
        model,
      });
      if (stream) {
        return writeTextAsSse(
          res,
          resp.choices?.[0]?.message?.content || "",
          resp.choices?.[0]?.finish_reason || "stop",
        );
      }
      return res.json(resp);
    }

    if (provider === "gemini") {
      const resp = await callGeminiChat({
        apiKey: resolved.apiKey,
        body: { temperature: 0.2, ...body },
        messages,
        model,
      });
      if (stream) {
        return writeTextAsSse(
          res,
          resp.choices?.[0]?.message?.content || "",
          resp.choices?.[0]?.finish_reason || "stop",
        );
      }
      return res.json(resp);
    }

    const openai = new OpenAI({ apiKey: resolved.apiKey });
    const payload = buildChatCompletionPayload(
      {
        temperature: 0.2,
        model,
        ...body,
      },
      messages
    );

    if (!stream) {
      const resp = await openai.chat.completions.create(payload);
      const h = resp?.response?.headers;
      if (h?.get) {
        for (const k of [
          "x-ratelimit-limit-requests",
          "x-ratelimit-remaining-requests",
          "x-ratelimit-reset-requests",
          "x-ratelimit-limit-tokens",
          "x-ratelimit-remaining-tokens",
          "x-ratelimit-reset-tokens",
        ]) {
          const v = h.get(k);
          if (v) res.setHeader(k, v);
        }
      }
      return res.json(resp);
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    const completion = await openai.chat.completions.create({
      ...payload,
      stream: true,
    });

    let finishReason = "";
    for await (const chunk of completion) {
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (delta) res.write(`data: ${JSON.stringify(delta)}\n\n`);
      const chunkFinishReason = chunk.choices?.[0]?.finish_reason;
      if (chunkFinishReason) finishReason = chunkFinishReason;
    }
    res.write(`event: metadata\ndata: ${JSON.stringify({ finish_reason: finishReason || "stop" })}\n\n`);
    res.write("event: done\ndata: [DONE]\n\n");
    res.end();
  } catch (err) {
    const extracted = extractProviderErrorMessage(err);
    logger.error("AI proxy error:", extracted.details || extracted.message);
    if (!res.headersSent) {
      res.status(extracted.status || 500).json({
        error: extracted.message || "LLM request failed",
        provider: normalizeAIProvider(req.header("x-ai-provider")) || req.body?.provider || "unknown",
      });
    }
  }
});

/* ----------------------------- Simple prompt-in/string-out endpoint ----------------------------- */
app.post("/api/openai", llmLimiter, async (req, res) => {
  try {
    const apiKey = await resolveOpenAIKeyForRequest(req);
    if (!apiKey) {
      return res.status(401).json({
        error: "No OpenAI key available. Save a local OpenAI API key in Settings before running OpenAI workflows.",
      });
    }

    const openai = new OpenAI({ apiKey });

    const { prompt, model = process.env.ANALYSIS_MODEL || "gpt-4o-mini", temperature = 0.2 } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const completion = await openai.chat.completions.create({
      model,
      temperature,
      messages: [
        { role: "system", content: "You are a precise, structured systems engineering assistant." },
        { role: "user", content: prompt },
      ],
    });

    const result = completion?.choices?.[0]?.message?.content?.trim() || "";
    res.json({ result, model });
  } catch (err) {
    const extracted = extractProviderErrorMessage(err);
    logger.error("❌ /api/openai error:", extracted.details || extracted.message);
    res.status(extracted.status || 500).json({ error: extracted.message || "LLM request failed" });
  }
});

/* ----------------------------- Misc ----------------------------- */
app.get(["/api/chat/ping", "/chat/ping"], (_, res) => res.json({ ok: true }));

/* ----------------------------- Global error handler ----------------------------- */
app.use((err, req, res, _next) => {
  logger.error("UNHANDLED_ERROR:", err);
  res
    .status(err.status || 500)
    .json({
      error: err.message || "internal_error",
      stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
    });
});

/* ----------------------------- Start ----------------------------- */
const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  logger.debug(`🚀 Server running at http://localhost:${PORT}`);
});
