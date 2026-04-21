/**
 * xHandle: routes server-side licensing module.
 * This file implements part of the backend licensing API used to issue, validate, or route license-related requests.
 * Server-side licensing logic is isolated from the rest of the API so key material, entitlement checks, and request handling stay easier to audit.
 * Related files: server.js, src/license/LicenseContext.jsx, src/license/ActivateLicenseModal.jsx.
 */

// server/license/routes.js
const express = require('express');
const { z } = require('zod');
const { pool } = require('../db');
const { logger } = require('../logger');

const router = express.Router();

/**
 * getActiveLicense reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param accountId Stable identifier for the entity this step works with.
 * @returns Promise resolving to the normalized data requested by this module.
 */
async function getActiveLicense(accountId) {
  const { rows } = await pool.query(
    `select * from licenses
     where account_id=$1 and status='active'
     order by created_at desc
     limit 1`,
    [accountId]
  );
  return rows[0] || null;
}

/**
 * isExpired encapsulates a focused piece of licensing workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param lic Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
const isExpired = (lic) => new Date(lic.expires_at).getTime() < Date.now();

/* GET /api/license/status */
router.get('/status', async (req, res) => {
  try {
    const accountId = req.user?.account_id;
    if (!accountId) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const lic = await getActiveLicense(accountId);
    if (!lic) return res.status(404).json({ ok: false, reason: 'no_license' });

    const expired = isExpired(lic);
    res.json({
      ok: !expired && lic.status === 'active',
      plan: lic.plan,
      seats: lic.seats,
      status: expired ? 'expired' : lic.status,
      expiresAt: lic.expires_at,
      entitlements: lic.entitlements || {}
    });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

/* POST /api/license/activate */
router.post('/activate', async (req, res) => {
  const schema = z.object({ key: z.string().min(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false });

  try {
    const { key } = parsed.data;
    const { rows } = await pool.query(
      `select l.*
       from license_keys k
       join licenses l on l.id = k.license_id
       where k.key = $1`,
      [key]
    );
    const lic = rows[0];
    if (!lic) return res.status(404).json({ ok: false, reason: 'invalid_key' });
    if (isExpired(lic)) return res.status(403).json({ ok: false, reason: 'expired' });
    if (lic.status !== 'active') return res.status(403).json({ ok: false, reason: lic.status });

    res.json({
      ok: true,
      plan: lic.plan,
      seats: lic.seats,
      expiresAt: lic.expires_at,
      entitlements: lic.entitlements || {}
    });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

/* POST /api/license/meter */
router.post('/meter', async (req, res) => {
  const schema = z.object({
    event: z.enum(['ai_tokens', 'analysis_run']),
    quantity: z.number().int().nonnegative()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false });

  try {
    const accountId = req.user?.account_id;
    if (!accountId) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const lic = await getActiveLicense(accountId);
    if (!lic) return res.status(404).json({ ok: false, reason: 'no_license' });
    if (isExpired(lic)) return res.status(403).json({ ok: false, reason: 'expired' });

    if (parsed.data.event === 'ai_tokens') {
      const { rows } = await pool.query(
        `select coalesce(sum(quantity),0)::bigint as used
         from usage_events
         where license_id=$1
           and event='ai_tokens'
           and occurred_at >= date_trunc('day', now())`,
        [lic.id]
      );
      const usedToday = Number(rows[0].used || 0);
      const limit = Number(lic.entitlements?.max_ai_tokens_per_day ?? 0);
      if (limit && usedToday + parsed.data.quantity > limit) {
        return res.status(429).json({ ok: false, reason: 'daily_token_limit' });
      }
    }

    await pool.query(
      `insert into usage_events (license_id, event, quantity)
       values ($1, $2, $3)`,
      [lic.id, parsed.data.event, parsed.data.quantity]
    );

    res.json({ ok: true, entitlements: lic.entitlements || {}, plan: lic.plan });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

module.exports = router;
