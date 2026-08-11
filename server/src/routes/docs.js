import express from 'express';
import { db, jsonCol } from '../db.js';
import { logActivity, logChanges, activityFor } from '../activity.js';
import { can, requireCap, visibleProjectIds } from '../permissions.js';
import { parsePagination } from '../paginate.js';

const router = express.Router();

const CATEGORIES = ['runbook', 'spec', 'how_to', 'decision', 'onboarding', 'other'];

const DOC_SELECT = `
  SELECT d.*, p.key AS project_key, p.name AS project_name, p.color AS project_color,
         c.name AS created_by_name, u.name AS updated_by_name, u.avatar_color AS updated_by_color
    FROM docs d
    LEFT JOIN projects p ON p.id = d.project_id
    LEFT JOIN users c ON c.id = d.created_by
    LEFT JOIN users u ON u.id = d.updated_by`;

const shape = (row) => row && { ...row, tags: jsonCol(row.tags, []) };

const docProjectId = (req) => {
  if (req.body?.project_id) return Number(req.body.project_id);
  const row = db.prepare('SELECT project_id FROM docs WHERE id = ?').get(req.params.id);
  return row ? row.project_id : null;
};

router.get('/', (req, res) => {
  const ids = visibleProjectIds(req.user);
  if (!ids.length) {
    const { page, limit } = parsePagination(req.query);
    return res.json({ docs: [], total: 0, page, limit });
  }

  const where = [`d.project_id IN (${ids.map(() => '?').join(',')})`];
  const params = [...ids];
  if (req.query.project_id) {
    where.push('d.project_id = ?');
    params.push(req.query.project_id);
  }
  if (req.query.category) {
    where.push('d.category = ?');
    params.push(req.query.category);
  }
  if (req.query.q) {
    where.push('(d.title LIKE ? OR d.body LIKE ? OR d.tags LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like, like);
  }

  const { limit, offset, page } = parsePagination(req.query);
  const clause = `WHERE ${where.join(' AND ')}`;
  const rows = db
    .prepare(`${DOC_SELECT} ${clause} ORDER BY d.pinned DESC, d.updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM docs d ${clause}`).get(...params);
  res.json({ docs: rows.map(shape), total, page, limit });
});

router.get('/:id', (req, res) => {
  const doc = shape(db.prepare(`${DOC_SELECT} WHERE d.id = ?`).get(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!can(req.user, 'doc.view', doc.project_id)) return res.status(403).json({ error: 'No access to this project' });
  res.json({ doc, activity: activityFor('doc', doc.id) });
});

router.post('/', requireCap('doc.create', (req) => Number(req.body?.project_id) || null), (req, res) => {
  const { project_id, title, category = 'other', body = '', tags = [], pinned = false } = req.body || {};
  if (!project_id) return res.status(400).json({ error: 'Pick a project for this document' });
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Give the document a title' });
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Unknown category' });

  const info = db
    .prepare(
      `INSERT INTO docs (project_id, title, category, body, tags, pinned, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(project_id, String(title).trim(), category, body, JSON.stringify(tags), pinned ? 1 : 0, req.user.id, req.user.id);

  const id = Number(info.lastInsertRowid);
  logActivity({
    projectId: project_id, entityType: 'doc', entityId: id, entityLabel: String(title).trim(),
    actorId: req.user.id, action: 'created', summary: `wrote the document “${String(title).trim()}”`,
  });
  res.status(201).json({ doc: shape(db.prepare(`${DOC_SELECT} WHERE d.id = ?`).get(id)) });
});

router.patch('/:id', requireCap('doc.edit', docProjectId), (req, res) => {
  const id = Number(req.params.id);
  const before = db.prepare('SELECT * FROM docs WHERE id = ?').get(id);
  if (!before) return res.status(404).json({ error: 'Document not found' });

  const { title, category, body, tags, pinned } = req.body || {};
  if (category && !CATEGORIES.includes(category)) return res.status(400).json({ error: 'Unknown category' });

  db.prepare(
    `UPDATE docs SET
        title = COALESCE(?, title), category = COALESCE(?, category), body = COALESCE(?, body),
        tags = COALESCE(?, tags), pinned = COALESCE(?, pinned),
        updated_by = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).run(
    title ?? null, category ?? null, body ?? null,
    tags ? JSON.stringify(tags) : null,
    pinned === undefined ? null : pinned ? 1 : 0,
    req.user.id, id,
  );

  const after = db.prepare('SELECT * FROM docs WHERE id = ?').get(id);
  logChanges({
    before, after, fields: ['title', 'category', 'body', 'pinned'],
    entityType: 'doc', entityId: id, entityLabel: after.title,
    projectId: after.project_id, actorId: req.user.id,
  });
  res.json({ doc: shape(db.prepare(`${DOC_SELECT} WHERE d.id = ?`).get(id)) });
});

router.delete('/:id', requireCap('doc.delete', docProjectId), (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  db.prepare('DELETE FROM docs WHERE id = ?').run(doc.id);
  logActivity({
    projectId: doc.project_id, entityType: 'doc', entityId: doc.id, entityLabel: doc.title,
    actorId: req.user.id, action: 'deleted', summary: `deleted the document “${doc.title}”`,
  });
  res.json({ ok: true });
});

export default router;
