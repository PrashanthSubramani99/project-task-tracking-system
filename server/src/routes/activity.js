import express from 'express';
import { db } from '../db.js';
import { visibleProjectIds } from '../permissions.js';

const router = express.Router();

/**
 * Cross-project activity stream, scoped to what the caller may see.
 * Rows with no project (user administration) are only shown to admins.
 */
router.get('/', (req, res) => {
  const ids = visibleProjectIds(req.user);
  const where = [];
  const params = [];

  if (req.user.role === 'admin') {
    if (ids.length) {
      where.push(`(a.project_id IS NULL OR a.project_id IN (${ids.map(() => '?').join(',')}))`);
      params.push(...ids);
    } else {
      where.push('a.project_id IS NULL');
    }
  } else {
    if (!ids.length) return res.json({ activities: [], total: 0 });
    where.push(`a.project_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }

  if (req.query.project_id) {
    where.push('a.project_id = ?');
    params.push(req.query.project_id);
  }
  if (req.query.actor_id === 'me') {
    where.push('a.actor_id = ?');
    params.push(req.user.id);
  } else if (req.query.actor_id) {
    where.push('a.actor_id = ?');
    params.push(req.query.actor_id);
  }
  if (req.query.entity_type) {
    where.push('a.entity_type = ?');
    params.push(req.query.entity_type);
  }
  if (req.query.since) {
    where.push('a.created_at >= ?');
    params.push(req.query.since);
  }

  const clause = `WHERE ${where.join(' AND ')}`;
  const limit = Math.min(Number(req.query.limit) || 60, 300);
  const offset = Number(req.query.offset) || 0;

  const activities = db
    .prepare(
      `SELECT a.*, u.name AS actor_name, u.avatar_color AS actor_color,
              p.key AS project_key, p.name AS project_name, p.color AS project_color
         FROM activities a
         LEFT JOIN users u ON u.id = a.actor_id
         LEFT JOIN projects p ON p.id = a.project_id
         ${clause}
        ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM activities a ${clause}`).get(...params);

  res.json({ activities, total });
});

export default router;
