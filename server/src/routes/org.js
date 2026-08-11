import express from 'express';
import { db } from '../db.js';
import { authenticate, requireOrgRole } from '../auth.js';

const router = express.Router();

const DEFAULTS = { app_name: 'InfyTrack', logo: null, favicon: null };

function getSettings() {
  const row = db.prepare('SELECT app_name, logo, favicon FROM org_settings WHERE id = 1').get();
  return row || DEFAULTS;
}

/** Public: the sign-in screen needs the right branding before anyone is authenticated. */
router.get('/', (req, res) => {
  res.json(getSettings());
});

/** Admin only: rename the workspace, swap the logo, swap the favicon. */
router.patch('/', authenticate, requireOrgRole('admin'), (req, res) => {
  const body = req.body || {};
  const current = getSettings();

  const app_name = body.app_name !== undefined ? String(body.app_name).trim() : current.app_name;
  if (!app_name) return res.status(400).json({ error: 'Application name cannot be empty' });

  const logo = body.logo !== undefined ? body.logo : current.logo;
  const favicon = body.favicon !== undefined ? body.favicon : current.favicon;

  db.prepare(
    `UPDATE org_settings SET app_name = ?, logo = ?, favicon = ?, updated_at = datetime('now') WHERE id = 1`,
  ).run(app_name, logo, favicon);

  res.json(getSettings());
});

export default router;
