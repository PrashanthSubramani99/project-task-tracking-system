import express from 'express';
import { db } from '../db.js';

const router = express.Router();

router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const where = ['n.user_id = ?'];
  const params = [req.user.id];
  if (req.query.unread === 'true') where.push('n.read_at IS NULL');

  const notifications = db
    .prepare(
      `SELECT n.*, u.name AS actor_name, u.avatar_color AS actor_color
         FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
        WHERE ${where.join(' AND ')} ORDER BY n.id DESC LIMIT ?`,
    )
    .all(...params, limit);

  const { unread } = db
    .prepare('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .get(req.user.id);

  res.json({ notifications, unread });
});

router.post('/:id/read', (req, res) => {
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ? AND read_at IS NULL")
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.post('/read-all', (req, res) => {
  const info = db
    .prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL")
    .run(req.user.id);
  res.json({ ok: true, marked: info.changes });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.delete('/', (req, res) => {
  const info = db.prepare('DELETE FROM notifications WHERE user_id = ? AND read_at IS NOT NULL').run(req.user.id);
  res.json({ ok: true, cleared: info.changes });
});

export default router;
