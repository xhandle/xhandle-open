/**
 * xHandle: backend API entrypoint.
 * This file boots the Express-based backend used by xHandle for LLM proxying, document ingestion, licensing, lightweight persistence, and external integration helpers.
 * It is the server-side boundary between the local-first UI and any operations that need secrets, rate limiting, filesystem access, or third-party API calls.
 * Related files: server/logger.js, server/db.js, server/license/routes.js, src/lib/api/backendConfig.js.
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

const app = express();

const CORS_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Requested-With",
  "Accept",
  "Origin",
  "x-account-id",
  "x-ai-provider",
  "x-ai-api-key"
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
    express.json({ limit: "10mb" })(req, res, (err) => {
      if (err) return next(err);
      express.urlencoded({ extended: true, limit: "10mb" })(req, res, next);
    });
  } else {
    next();
  }
});

// LLM rate limit
const llmLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// [LICENSING] bring in the license API router
const licenseRouter = require("./server/license/routes");

/* ----------------------------- OpenAI Realtime: ephemeral session ----------------------------- */
app.post("/api/rt/session", async (req, res) => {
  try {
    const key = process.env.OPENAI_API_KEY || process.env.OPENAI_TOKEN;
    if (!key) {
      return res.status(500).json({ error: "OpenAI API key missing (OPENAI_API_KEY)" });
    }
    const { model = "gpt-4o-realtime-preview", voice = "verse" } = req.body || {};
    const r = await axios.post(
      "https://api.openai.com/v1/realtime/sessions",
      { model, voice },
      {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "realtime=v1",
        },
        timeout: 15_000,
      }
    );
    return res.status(r.status).json(r.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || { error: err.message };
    logger.error("❌ /api/rt/session error:", data);
    return res.status(status).json(data);
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
    defaultModel: process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    envKey: () => process.env.ANTHROPIC_API_KEY || null,
  },
  gemini: {
    label: "Gemini",
    defaultModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    envKey: () => process.env.GEMINI_API_KEY || null,
  },
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
  if (!model) return AI_PROVIDERS[provider]?.defaultModel || null;

  if (provider === "openai") return model;
  if (provider === "claude" && /^claude/i.test(model)) return model;
  if (provider === "gemini" && /^gemini/i.test(model)) return model;

  return AI_PROVIDERS[provider]?.defaultModel || model;
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

/**
 * normalizeChatMessages prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param messages} Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function normalizeChatMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((message) => message && typeof message === "object")
    .map((message) => ({
      role: typeof message.role === "string" ? message.role : "user",
      content: normalizeMessageContent(message.content),
    }))
    .filter((message) => message.content.trim().length > 0);
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
  const accountId = req.user?.account_id;

  if (accountId) {
    const stored = await getStoredOpenAIKey(accountId);
    if (stored?.api_key) {
      return stored.api_key;
    }
  }

  return process.env.OPENAI_API_KEY || process.env.OPENAI_TOKEN || null;
}

async function resolveAIConfigForRequest(req) {
  const body = req.body || {};
  const requestedProvider = normalizeAIProvider(body.provider);
  const headerProvider = normalizeAIProvider(req.header("x-ai-provider"));
  const headerApiKey = normalizeProviderApiKey(headerProvider || requestedProvider, req.header("x-ai-api-key"));
  const accountId = req.user?.account_id;

  if (headerProvider && headerApiKey) {
    return {
      provider: headerProvider,
      apiKey: headerApiKey,
      model: resolveModelForProvider(headerProvider, body.model),
    };
  }

  if (accountId) {
    if (requestedProvider) {
      const stored = await getStoredAIProviderKey(accountId, requestedProvider);
      if (stored?.api_key) {
        return {
          provider: requestedProvider,
          apiKey: stored.api_key,
          model: resolveModelForProvider(requestedProvider, body.model),
        };
      }
    }

    const savedProviders = await listStoredAIProviderKeys(accountId);
    const activeStored = savedProviders.find((row) => row.is_active);
    if (activeStored?.api_key) {
      return {
        provider: activeStored.provider,
        apiKey: activeStored.api_key,
        model: resolveModelForProvider(activeStored.provider, body.model),
      };
    }
  }

  const envProviderOrder = requestedProvider
    ? [requestedProvider]
    : ["openai", "claude", "gemini"];

  for (const provider of envProviderOrder) {
    const apiKey = AI_PROVIDERS[provider]?.envKey?.();
    if (apiKey) {
      return {
        provider,
        apiKey,
        model: resolveModelForProvider(provider, body.model),
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

function toOpenAICompatibleResponse({ provider, model, text, raw }) {
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
        finish_reason: "stop",
      },
    ],
    raw,
  };
}

async function callClaudeChat({ apiKey, body, messages, model }) {
  const { system, conversation } = splitSystemMessages(messages);
  const payload = {
    model,
    max_tokens: Number(body.max_tokens) || 1200,
    messages: conversation.length ? conversation : [{ role: "user", content: body.prompt || "Continue." }],
  };

  if (system) payload.system = system;
  if (typeof body.temperature === "number") payload.temperature = body.temperature;
  if (typeof body.top_p === "number") payload.top_p = body.top_p;
  if (typeof body.top_k === "number") payload.top_k = body.top_k;
  if (Array.isArray(body.stop_sequences)) payload.stop_sequences = body.stop_sequences;

  const resp = await axios.post("https://api.anthropic.com/v1/messages", payload, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    timeout: 60_000,
  });

  const text = Array.isArray(resp.data?.content)
    ? resp.data.content.filter((part) => part?.type === "text").map((part) => part.text || "").join("")
    : "";

  return toOpenAICompatibleResponse({
    provider: "claude",
    model,
    text,
    raw: resp.data,
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

  const resp = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    payload,
    {
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
      },
      timeout: 60_000,
    }
  );

  const text = Array.isArray(resp.data?.candidates)
    ? resp.data.candidates
        .flatMap((candidate) => candidate?.content?.parts || [])
        .map((part) => part?.text || "")
        .join("")
    : "";

  return toOpenAICompatibleResponse({
    provider: "gemini",
    model,
    text,
    raw: resp.data,
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

/* ----------------------------- Licensing API ----------------------------- */
app.use("/api/license", licenseRouter);

/* ----------------------------- Secure AI chat proxy ----------------------------- */
app.post(["/api/chat", "/api/chatgpt", "/chat"], llmLimiter, async (req, res) => {
  try {
    const resolved = await resolveAIConfigForRequest(req);
    if (!resolved?.apiKey || !resolved?.provider) {
      return res.status(500).json({ error: "No AI provider key available" });
    }

    const body = req.body || {};
    const messages = Array.isArray(body.messages)
      ? normalizeChatMessages(body.messages)
      : (typeof body.prompt === "string" ? [{ role: "user", content: body.prompt }] : []);

    if (messages.length === 0) {
      return res.status(400).json({ error: "Provide messages[] or prompt" });
    }

    const stream = body.stream === true;
    const provider = resolved.provider;
    const model = resolved.model || AI_PROVIDERS[provider]?.defaultModel;

    if (stream && provider !== "openai") {
      return res.status(400).json({
        error: `${providerLabel(provider)} streaming is not enabled on this proxy yet`,
      });
    }

    if (!stream && provider === "claude") {
      const resp = await callClaudeChat({
        apiKey: resolved.apiKey,
        body: { temperature: 0.2, ...body },
        messages,
        model,
      });
      return res.json(resp);
    }

    if (!stream && provider === "gemini") {
      const resp = await callGeminiChat({
        apiKey: resolved.apiKey,
        body: { temperature: 0.2, ...body },
        messages,
        model,
      });
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

    for await (const chunk of completion) {
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (delta) res.write(`data: ${JSON.stringify(delta)}\n\n`);
    }
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
      return res.status(500).json({ error: "No OpenAI key available" });
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
    logger.error("❌ /api/openai error:", err?.response?.data || err.message);
    res.status(500).json({ error: "LLM request failed" });
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
