import express from 'express';
import { db } from '../db.js';
import { logActivity, logChanges } from '../activity.js';
import { notify } from '../notify.js';
import { can, requireCap, visibleProjectIds, projectRole, PROJECT_ROLES } from '../permissions.js';

const router = express.Router();

const withStats = (project) => {
  const counts = db
    .prepare(
      `SELECT
         COUNT(*)                                                   AS total,
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)           AS done,
         SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END)    AS in_progress,
         SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END)        AS blocked,
         SUM(CASE WHEN status NOT IN ('done','cancelled')
                   AND due_date IS NOT NULL
                   AND due_date < date('now') THEN 1 ELSE 0 END)    AS overdue
       FROM tasks WHERE project_id = ?`,
    )
    .get(project.id);

  const openActions = db
    .prepare(
      `SELECT COUNT(*) AS count FROM action_items ai
         JOIN meetings m ON m.id = ai.meeting_id
        WHERE m.project_id = ? AND ai.status = 'open'`,
    )
    .get(project.id);

  const total = counts.total || 0;
  return {
    ...project,
    stats: {
      total,
      done: counts.done || 0,
      in_progress: counts.in_progress || 0,
      blocked: counts.blocked || 0,
      overdue: counts.overdue || 0,
      open_action_items: openActions.count || 0,
      completion: total ? Math.round(((counts.done || 0) / total) * 100) : 0,
    },
  };
};

router.get('/', (req, res) => {
  const ids = visibleProjectIds(req.user);
  if (!ids.length) return res.json({ projects: [] });
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT p.*, u.name AS lead_name, u.avatar_color AS lead_color,
              (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) AS member_count
         FROM projects p LEFT JOIN users u ON u.id = p.lead_id
        WHERE p.id IN (${placeholders})
        ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, p.name COLLATE NOCASE`,
    )
    .all(...ids);
  res.json({ projects: rows.map(withStats) });
});

router.get('/:projectId', requireCap('project.view'), (req, res) => {
  const project = db
    .prepare(
      `SELECT p.*, u.name AS lead_name, u.avatar_color AS lead_color
         FROM projects p LEFT JOIN users u ON u.id = p.lead_id WHERE p.id = ?`,
    )
    .get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const members = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.avatar_color, u.title, u.is_active, pm.role, pm.added_at
         FROM project_members pm JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = ? ORDER BY CASE pm.role WHEN 'lead' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.name`,
    )
    .all(req.params.projectId);

  res.json({
    project: withStats(project),
    members,
    myRole: projectRole(req.user, Number(req.params.projectId)),
  });
});

router.post('/', (req, res) => {
  if (!can(req.user, 'project.create')) {
    return res.status(403).json({ error: 'Only managers and administrators can create projects' });
  }
  const { name, key, description = '', color = '#6366f1', lead_id, start_date, target_date, members = [] } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Project name is required' });

  let projectKey = String(key || name).replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  if (!projectKey) projectKey = 'PROJ';
  // Keys must be unique — they prefix every task id.
  let candidate = projectKey;
  let suffix = 1;
  while (db.prepare('SELECT 1 FROM projects WHERE key = ?').get(candidate)) {
    candidate = `${projectKey.slice(0, 5)}${suffix++}`;
  }

  const leadId = lead_id ?? req.user.id;
  const info = db
    .prepare(
      `INSERT INTO projects (key, name, description, color, lead_id, start_date, target_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(candidate, String(name).trim(), description, color, leadId, start_date || null, target_date || null, req.user.id);

  const projectId = Number(info.lastInsertRowid);
  const addMember = db.prepare('INSERT OR REPLACE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)');
  addMember.run(projectId, leadId, 'lead');
  if (req.user.id !== leadId) addMember.run(projectId, req.user.id, 'member');
  for (const m of members) {
    const userId = typeof m === 'object' ? m.user_id : m;
    const role = typeof m === 'object' && PROJECT_ROLES.includes(m.role) ? m.role : 'member';
    if (userId && userId !== leadId) {
      addMember.run(projectId, userId, role);
      notify({
        userId, actorId: req.user.id, type: 'project',
        title: `Added to ${name}`,
        body: `${req.user.name} added you to the project ${name} as ${role}.`,
        link: `/projects/${projectId}`,
      });
    }
  }

  logActivity({
    projectId, entityType: 'project', entityId: projectId, entityLabel: candidate,
    actorId: req.user.id, action: 'created', summary: `created project ${name}`,
  });

  res.status(201).json({ project: withStats(db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)) });
});

router.patch('/:projectId', requireCap('project.edit'), (req, res) => {
  const id = Number(req.params.projectId);
  const before = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!before) return res.status(404).json({ error: 'Project not found' });

  const { name, description, color, status, lead_id, start_date, target_date } = req.body || {};
  db.prepare(
    `UPDATE projects SET
        name        = COALESCE(?, name),
        description = COALESCE(?, description),
        color       = COALESCE(?, color),
        status      = COALESCE(?, status),
        lead_id     = COALESCE(?, lead_id),
        start_date  = COALESCE(?, start_date),
        target_date = COALESCE(?, target_date),
        updated_at  = datetime('now')
      WHERE id = ?`,
  ).run(name ?? null, description ?? null, color ?? null, status ?? null, lead_id ?? null,
        start_date ?? null, target_date ?? null, id);

  if (lead_id && lead_id !== before.lead_id) {
    db.prepare("INSERT OR REPLACE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'lead')").run(id, lead_id);
  }

  const after = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  logChanges({
    before, after,
    fields: ['name', 'description', 'status', 'lead_id', 'start_date', 'target_date'],
    entityType: 'project', entityId: id, entityLabel: after.key, projectId: id, actorId: req.user.id,
  });

  res.json({ project: withStats(after) });
});

router.delete('/:projectId', requireCap('project.delete'), (req, res) => {
  const id = Number(req.params.projectId);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  logActivity({
    entityType: 'project', entityId: id, entityLabel: project.key, actorId: req.user.id,
    action: 'deleted', summary: `deleted project ${project.name}`,
  });
  res.json({ ok: true });
});

// ------------------------------------------------------------- members ----

router.post('/:projectId/members', requireCap('project.members'), (req, res) => {
  const projectId = Number(req.params.projectId);
  const { user_id, role = 'member' } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'Pick a person to add' });
  if (!PROJECT_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown project role' });

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(user_id);
  if (!project || !user) return res.status(404).json({ error: 'Project or user not found' });

  db.prepare('INSERT OR REPLACE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)').run(
    projectId, user_id, role,
  );
  logActivity({
    projectId, entityType: 'project', entityId: projectId, entityLabel: project.key,
    actorId: req.user.id, action: 'updated', field: 'members',
    summary: `added ${user.name} to the project as ${role}`,
  });
  notify({
    userId: user_id, actorId: req.user.id, type: 'project',
    title: `Added to ${project.name}`,
    body: `${req.user.name} added you as ${role}.`,
    link: `/projects/${projectId}`,
  });

  res.status(201).json({ ok: true });
});

router.patch('/:projectId/members/:userId', requireCap('project.members'), (req, res) => {
  const projectId = Number(req.params.projectId);
  const userId = Number(req.params.userId);
  const { role } = req.body || {};
  if (!PROJECT_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown project role' });

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  if (!project || !user) return res.status(404).json({ error: 'Project or user not found' });

  // Do not strip the last lead — someone has to be able to administer it.
  if (role !== 'lead') {
    const { count } = db
      .prepare("SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND role = 'lead'")
      .get(projectId);
    const current = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId);
    if (current?.role === 'lead' && count <= 1) {
      return res.status(400).json({ error: 'A project needs at least one lead' });
    }
  }

  db.prepare('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?').run(role, projectId, userId);
  logActivity({
    projectId, entityType: 'project', entityId: projectId, entityLabel: project.key,
    actorId: req.user.id, action: 'updated', field: 'members',
    summary: `changed ${user.name}'s project role to ${role}`,
  });
  notify({
    userId, actorId: req.user.id, type: 'project',
    title: `Your role in ${project.name} changed`,
    body: `You are now a ${role} on this project.`,
    link: `/projects/${projectId}`,
  });
  res.json({ ok: true });
});

router.delete('/:projectId/members/:userId', requireCap('project.members'), (req, res) => {
  const projectId = Number(req.params.projectId);
  const userId = Number(req.params.userId);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  if (!project || !user) return res.status(404).json({ error: 'Project or user not found' });

  const current = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId);
  if (current?.role === 'lead') {
    const { count } = db
      .prepare("SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND role = 'lead'")
      .get(projectId);
    if (count <= 1) return res.status(400).json({ error: 'A project needs at least one lead' });
  }

  db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, userId);
  logActivity({
    projectId, entityType: 'project', entityId: projectId, entityLabel: project.key,
    actorId: req.user.id, action: 'updated', field: 'members',
    summary: `removed ${user.name} from the project`,
  });
  res.json({ ok: true });
});

export default router;
