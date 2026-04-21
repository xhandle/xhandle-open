/**
 * xHandle: db backend helper.
 * This file contains backend support code used by the xHandle server for logging, persistence, or API composition.
 * Separating backend helpers keeps server startup code smaller and makes operational concerns easier to maintain independently from route logic.
 * Related files: server.js, server/license/routes.js.
 */

// server/db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

module.exports = { pool };
