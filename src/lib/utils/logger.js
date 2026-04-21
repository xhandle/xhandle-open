/**
 * xHandle: logger shared infrastructure.
 * This file contains shared non-visual infrastructure that multiple parts of xHandle depend on for cross-feature behavior.
 * Shared library modules keep feature code focused on engineering workflows while centralizing reusable concerns such as logging, key management, source collection, and persistence.
 * Related files: src/App.js, src/components/utils/logger.js, src/components/XHandleCopilotView.jsx.
 */

const isDev = process.env.NODE_ENV !== "production";

export const logger = {
  debug: (...args) => {
    if (isDev) console.debug(...args);
  },
  info: (...args) => {
    if (isDev) console.info(...args);
  },
  warn: (...args) => {
    console.warn(...args);
  },
  error: (...args) => {
    console.error(...args);
  },
};

export default logger;
