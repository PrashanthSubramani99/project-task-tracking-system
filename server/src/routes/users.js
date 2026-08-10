import express from 'express';
import { db, jsonCol } from '../db.js';
import { hashPassword, PUBLIC_USER_COLS, requireOrgRole } from '../auth.js';
import { logActivity, logChanges } from '../activity.js';
import { notify } from '../notify.js';
import { ORG_ROLES } from '../permissions.js';

const router = express.Router();

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

const shape = (u) => ({ ...u, journey: jsonCol(u.journey, {}), notify_prefs: jsonCol(u.notify_prefs, {}) });

/** Directory — everyone can see who is on the team. */
router.get('/', (req, res) => {
  const includeInactive = req.query.include_inactive === 'true';
  const rows = db
    .prepare(
      `SELECT ${PUBLIC_USER_COLS} FROM users
        ${includeInactive ? '' : 'WHERE is_active = 1'}
        ORDER BY is_active DESC, name COLLATE NOCASE`,
    )
    .all();
  res.json({ users: rows.map(shape) });
});

router.get('/:id', (req, res) => {
  const user = db.prepare(`SELECT ${PUBLIC_USER_COLS} FROM users WHERE id = ?`).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const workload = db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM tasks
        WHERE assignee_id = ? AND status NOT IN ('done','cancelled')
        GROUP BY status`,
    )
    .all(req.params.id);

  const projects = db
    .prepare(
      `SELECT p.id, p.key, p.name, p.color, pm.role
         FROM project_members pm JOIN projects p ON p.id = pm.project_id
        WHERE pm.user_id = ? ORDER BY p.name`,
    )
    .all(req.params.id);

  res.json({ user: shape(user), workload, projects });
});

router.post('/', requireOrgRole('admin', 'manager'), (req, res) => {
  const { name, email, password, role = 'member', title = '', phone = '' } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!ORG_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
  // A manager must not be able to mint another administrator.
  if (req.user.role !== 'admin' && role === 'admin') {
    return res.status(403).json({ error: 'Only an administrator can create administrator accounts' });
  }

  const normalised = String(email).trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalised)) {
    return res.status(409).json({ error: 'A user with that email already exists' });
  }

  const info = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, role, title, phone, avatar_color)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      String(name).trim(),
      normalised,
      hashPassword(password),
      role,
      title,
      phone,
      AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    );

  const id = Number(info.lastInsertRowid);
  logActivity({
    entityType: 'user',
    entityId: id,
    entityLabel: String(name).trim(),
    actorId: req.user.id,
    action: 'created',
    summary: `added ${String(name).trim()} to the team as ${role}`,
  });
  notify({
    userId: id,
    actorId: req.user.id,
    type: 'project',
    title: 'Welcome to InfyTrack',
    body: `${req.user.name} created your account. Start with the guided tour on your dashboard.`,
    link: '/dashboard',
  });

  res.status(201).json({ user: shape(db.prepare(`SELECT ${PUBLIC_USER_COLS} FROM users WHERE id = ?`).get(id)) });
});

router.patch('/:id', requireOrgRole('admin', 'manager'), (req, res) => {
  const id = Number(req.params.id);
  const before = db.prepare(`SELECT ${PUBLIC_USER_COLS} FROM users WHERE id = ?`).get(id);
  if (!before) return res.status(404).json({ error: 'User not found' });

  const { name, email, role, title, phone, avatar_color, is_active, password } = req.body || {};

  if (role && !ORG_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
  if (req.user.role !== 'admin' && (role === 'admin' || before.role === 'admin')) {
    return res.status(403).json({ error: 'Only an administrator can change administrator accounts' });
  }
  // Never let the last administrator lock everybody out.
  if ((role && role !== 'admin' && before.role === 'admin') || (is_active === false && before.role === 'admin')) {
    const { count } = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get();
    if (count <= 1) return res.status(400).json({ error: 'There must be at least one active administrator' });
  }

  if (email) {
    const normalised = String(email).trim().toLowerCase();
    const clash = db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(normalised, id);
    if (clash) return res.status(409).json({ error: 'A user with that email already exists' });
  }

  db.prepare(
    `UPDATE users SET
        name         = COALESCE(?, name),
        email        = COALESCE(?, email),
        role         = COALESCE(?, role),
        title        = COALESCE(?, title),
        phone        = COALESCE(?, phone),
        avatar_color = COALESCE(?, avatar_color),
        is_active    = COALESCE(?, is_active),
        updated_at   = datetime('now')
      WHERE id = ?`,
  ).run(
    name ?? null,
    email ? String(email).trim().toLowerCase() : null,
    role ?? null,
    title ?? null,
    phone ?? null,
    avatar_color ?? null,
    is_active === undefined ? null : is_active ? 1 : 0,
    id,
  );

  if (password) {
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
    logActivity({
      entityType: 'user', entityId: id, entityLabel: before.name, actorId: req.user.id,
      action: 'updated', field: 'password', summary: 'reset the password',
    });
  }

  const after = db.prepare(`SELECT ${PUBLIC_USER_COLS} FROM users WHERE id = ?`).get(id);
  logChanges({
    before, after,
    fields: ['name', 'email', 'role', 'title', 'phone', 'is_active'],
    entityType: 'user', entityId: id, entityLabel: after.name,
    projectId: null, actorId: req.user.id,
  });

  if (role && role !== before.role) {
    notify({
      userId: id, actorId: req.user.id, type: 'project',
      title: 'Your access level changed',
      body: `${req.user.name} changed your role from ${before.role} to ${role}.`,
      link: '/settings',
    });
  }

  res.json({ user: shape(after) });
});

router.delete('/:id', requireOrgRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account' });
  const user = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') {
    const { count } = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get();
    if (count <= 1) return res.status(400).json({ error: 'There must be at least one active administrator' });
  }
  // Deactivate rather than delete so history, comments and activity survive.
  db.prepare("UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
  logActivity({
    entityType: 'user', entityId: id, entityLabel: user.name, actorId: req.user.id,
    action: 'deactivated', summary: `deactivated ${user.name}`,
  });
  res.json({ ok: true });
});

export default router;
