// routes/diagnostics.js — admin-only operational diagnostics.
// Mounted at /api/diag. Every route here MUST be gated by ADMIN_SECRET.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { probeProviders } = require('../services/aiService');

// Timing-safe secret comparison (avoids leaking length/early-exit timing).
function adminOk(req) {
  const provided = req.get('x-admin-secret') || req.query.secret || '';
  const expected = process.env.ADMIN_SECRET || '';
  if (!expected) return false; // fail closed if no admin secret configured
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// GET /api/diag/ai-health — confirm which AI provider keys are live.
// Returns per-provider reachability; never echoes key values.
router.get('/ai-health', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'forbidden' });
  try {
    const result = await probeProviders();
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'probe failed' });
  }
});

module.exports = router;
