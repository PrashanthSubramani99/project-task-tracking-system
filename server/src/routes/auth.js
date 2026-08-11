import express from 'express';
import { db, jsonCol } from '../db.js';
import { hashPassword, verifyPassword, signToken, authenticate, findUserById, PUBLIC_USER_COLS } from '../auth.js';
import { logActivity } from '../activity.js';
import { capabilitiesFor } from '../permissions.js';

const router = express.Router();

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
const pickColor = () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

const shape = (user) => ({
  ...user,
  journey: jsonCol(user.journey, {}),
  notify_prefs: jsonCol(user.notify_prefs, {}),
  theme_prefs: jsonCol(user.theme_prefs, {}),
});

/** Is this a brand new install? Drives the first-run setup screen. */
router.get('/bootstrap', (req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  res.json({ needsSetup: count === 0, userCount: count });
});

/** First-run only: creates the first administrator plus a starter workspace. */
router.post('/setup', (req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0) return res.status(409).json({ error: 'This workspace has already been set up' });

  const { name, email, password, workspace } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const info = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, role, avatar_color, title)
       VALUES (?, ?, ?, 'admin', ?, 'Administrator')`,
    )
    .run(String(name).trim(), String(email).trim().toLowerCase(), hashPassword(password), pickColor());

  const userId = Number(info.lastInsertRowid);

  if (workspace) {
    const key = String(workspace).replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'GEN';
    const project = db
      .prepare(
        `INSERT INTO projects (key, name, description, lead_id, created_by)
         VALUES (?, ?, 'Created during setup — rename or delete any time.', ?, ?)`,
      )
      .run(key, String(workspace).trim(), userId, userId);
    db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'lead')").run(
      Number(project.lastInsertRowid),
      userId,
    );
    logActivity({
      projectId: Number(project.lastInsertRowid),
      entityType: 'project',
      entityId: Number(project.lastInsertRowid),
      entityLabel: key,
      actorId: userId,
      action: 'created',
      summary: `created project ${workspace}`,
    });
  }

  const user = findUserById(userId);
  res.status(201).json({ token: signToken(user), user: shape(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }
  if (!row.is_active) return res.status(403).json({ error: 'This account has been deactivated' });

  const user = findUserById(row.id);
  res.json({ token: signToken(user), user: shape(user) });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: shape(req.user), ...capabilitiesFor(req.user) });
});

router.patch('/me', authenticate, (req, res) => {
  const { name, title, phone, avatar_color, notify_prefs, theme_prefs } = req.body || {};
  db.prepare(
    `UPDATE users SET
        name         = COALESCE(?, name),
        title        = COALESCE(?, title),
        phone        = COALESCE(?, phone),
        avatar_color = COALESCE(?, avatar_color),
        notify_prefs = COALESCE(?, notify_prefs),
        theme_prefs  = COALESCE(?, theme_prefs),
        updated_at   = datetime('now')
      WHERE id = ?`,
  ).run(
    name ?? null,
    title ?? null,
    phone ?? null,
    avatar_color ?? null,
    notify_prefs ? JSON.stringify(notify_prefs) : null,
    theme_prefs ? JSON.stringify(theme_prefs) : null,
    req.user.id,
  );
  res.json({ user: shape(findUserById(req.user.id)) });
});

router.post('/me/password', authenticate, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current_password || '', row.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
    hashPassword(new_password),
    req.user.id,
  );
  res.json({ ok: true });
});

/** Mark a step of the guided onboarding journey as done. */
router.post('/me/journey/:step', authenticate, (req, res) => {
  const journey = jsonCol(req.user.journey, {});
  journey[req.params.step] = new Date().toISOString();
  db.prepare('UPDATE users SET journey = ? WHERE id = ?').run(JSON.stringify(journey), req.user.id);
  res.json({ journey });
});

export default router;
