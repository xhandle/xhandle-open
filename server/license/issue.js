/**
 * xHandle: issue server-side licensing module.
 * This file implements part of the backend licensing API used to issue, validate, or route license-related requests.
 * Server-side licensing logic is isolated from the rest of the API so key material, entitlement checks, and request handling stay easier to audit.
 * Related files: server.js, src/license/LicenseContext.jsx, src/license/ActivateLicenseModal.jsx.
 */

const crypto = require('crypto');
const { pool } = require('../db');

/**
 * issueLicense encapsulates a focused piece of licensing workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param accountId Stable identifier for the entity this step works with.
 * @param plan Input consumed by this step of the xHandle workflow.
 * @param seats Input consumed by this step of the xHandle workflow.
 * @param months Input consumed by this step of the xHandle workflow.
 * @param entitlementsOverride Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function issueLicense({ accountId, plan='Pro', seats=5, months=6, entitlementsOverride={} }) {
  const expires = new Date(); expires.setMonth(expires.getMonth() + months);

  const base = plan === 'Enterprise' ? {
    max_projects: 1000, max_ai_tokens_per_day: 10_000_000,
    agentic_reports: true, fmea_pipeline: true, whatif_pipeline: true
  } : plan === 'Pro' ? {
    max_projects: 10, max_ai_tokens_per_day: 500_000,
    agentic_reports: true, fmea_pipeline: true, whatif_pipeline: true
  } : {
    max_projects: 1, max_ai_tokens_per_day: 25_000,
    agentic_reports: false, fmea_pipeline: false, whatif_pipeline: false
  };
  const entitlements = { ...base, ...entitlementsOverride };

  const { rows } = await pool.query(
    `insert into licenses (account_id, plan, seats, expires_at, entitlements)
     values ($1,$2,$3,$4,$5) returning id`,
    [accountId, plan, seats, expires.toISOString(), entitlements]
  );
  const licenseId = rows[0].id;

  const key = 'XH-' +
    crypto.randomUUID().split('-')[1].toUpperCase() + '-' +
    crypto.randomUUID().split('-')[2].toUpperCase() + '-' +
    crypto.randomUUID().split('-')[3].toUpperCase();

  await pool.query(`insert into license_keys (license_id, key) values ($1,$2)`, [licenseId, key]);

  return { licenseId, key, plan, seats, expiresAt: expires.toISOString(), entitlements };
}

module.exports = { issueLicense };
