/**
 * xHandle: logger backend helper.
 * This file contains backend support code used by the xHandle server for logging, persistence, or API composition.
 * Separating backend helpers keeps server startup code smaller and makes operational concerns easier to maintain independently from route logic.
 * Related files: server.js, server/license/routes.js.
 */

const isDev = process.env.NODE_ENV !== "production";

const logger = {
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

module.exports = { logger };
