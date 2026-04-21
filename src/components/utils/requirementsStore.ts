/**
 * xHandle: requirements store shared UI utility.
 * This file provides shared helper logic used by frontend components, often as a compatibility layer while imports converge on the newer lib-oriented architecture.
 * Keeping reusable helpers in one place reduces duplication across feature surfaces and makes local-first data handling, exports, and copilot context easier to evolve safely.
 * Related files: src/lib/storage/indexedDB.js, src/lib/storage/requirementsStore.ts, src/components/XHandleCopilotView.jsx.
 */

export * from "../../lib/storage/requirementsStore";

