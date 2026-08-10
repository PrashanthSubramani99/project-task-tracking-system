import express from 'express';
import { db } from '../db.js';
import { visibleProjectIds } from '../permissions.js';

const router = express.Router();

/** `?` placeholders for a list of ids. */
const holders = (arr) => arr.map(() => '?').join(',');

const emptyDashboard = {
  my: { assigned: 0, due_today: 0, overdue: 0, in_progress: 0, done_this_week: 0 },
  myTasks: [], myActionItems: [], team: {}, statusBreakdown: [], upcoming: [], recentActivity: [], projects: [],
};

/**
 * Everything the landing screen needs, in one round trip.
 * Split into "what I owe" and "how the team is doing".
 */
router.get('/dashboard', (req, res) => {
  const ids = visibleProjectIds(req.user);
  if (!ids.length) return res.json(emptyDashboard);
  const scope = holders(ids);

  const my = db
    .prepare(
      `SELECT
         COUNT(*)                                                                          AS assigned,
         SUM(CASE WHEN due_date = date('now') THEN 1 ELSE 0 END)                           AS due_today,
         SUM(CASE WHEN due_date IS NOT NULL AND due_date < date('now') THEN 1 ELSE 0 END)  AS overdue,
         SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END)                           AS in_progress
       FROM tasks
      WHERE assignee_id = ? AND status NOT IN ('done','cancelled') AND project_id IN (${scope})`,
    )
    .get(req.user.id, ...ids);

  const doneThisWeek = db
    .prepare(
      `SELECT COUNT(*) AS count FROM tasks
        WHERE assignee_id = ? AND status = 'done'
          AND completed_at >= datetime('now', '-7 days') AND project_id IN (${scope})`,
    )
    .get(req.user.id, ...ids);

  const myTasks = db
    .prepare(
      `SELECT t.id, t.key, t.title, t.status, t.priority, t.due_date, t.progress,
              p.key AS project_key, p.color AS project_color
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.assignee_id = ? AND t.status NOT IN ('done','cancelled') AND t.project_id IN (${scope})
        ORDER BY t.due_date IS NULL, t.due_date ASC,
                 CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
        LIMIT 12`,
    )
    .all(req.user.id, ...ids);

  const myActionItems = db
    .prepare(
      `SELECT ai.id, ai.text, ai.due_date, ai.priority, m.id AS meeting_id, m.title AS meeting_title, m.occurred_at
         FROM action_items ai JOIN meetings m ON m.id = ai.meeting_id
        WHERE ai.owner_id = ? AND ai.status = 'open' AND m.project_id IN (${scope})
        ORDER BY ai.due_date IS NULL, ai.due_date ASC LIMIT 10`,
    )
    .all(req.user.id, ...ids);

  const team = db
    .prepare(
      `SELECT
         COUNT(*)                                                                         AS total,
         SUM(CASE WHEN status NOT IN ('done','cancelled') THEN 1 ELSE 0 END)               AS open,
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)                                  AS done,
         SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END)                               AS blocked,
         SUM(CASE WHEN status NOT IN ('done','cancelled') AND due_date IS NOT NULL
                   AND due_date < date('now') THEN 1 ELSE 0 END)                           AS overdue,
         SUM(CASE WHEN assignee_id IS NULL AND status NOT IN ('done','cancelled')
                  THEN 1 ELSE 0 END)                                                       AS unassigned
       FROM tasks WHERE project_id IN (${scope})`,
    )
    .get(...ids);

  const openActions = db
    .prepare(
      `SELECT COUNT(*) AS count FROM action_items ai JOIN meetings m ON m.id = ai.meeting_id
        WHERE ai.status = 'open' AND m.project_id IN (${scope})`,
    )
    .get(...ids);

  const statusBreakdown = db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM tasks WHERE project_id IN (${scope}) GROUP BY status`,
    )
    .all(...ids);

  const upcoming = db
    .prepare(
      `SELECT t.id, t.key, t.title, t.due_date, t.priority, t.status,
              u.name AS assignee_name, u.avatar_color AS assignee_color,
              p.key AS project_key, p.color AS project_color
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.status NOT IN ('done','cancelled') AND t.due_date IS NOT NULL
          AND t.due_date <= date('now', '+7 days') AND t.project_id IN (${scope})
        ORDER BY t.due_date ASC LIMIT 15`,
    )
    .all(...ids);

  const recentActivity = db
    .prepare(
      `SELECT a.*, u.name AS actor_name, u.avatar_color AS actor_color, p.key AS project_key
         FROM activities a
         LEFT JOIN users u ON u.id = a.actor_id
         LEFT JOIN projects p ON p.id = a.project_id
        WHERE a.project_id IN (${scope})
        ORDER BY a.id DESC LIMIT 15`,
    )
    .all(...ids);

  const projects = db
    .prepare(
      `SELECT p.id, p.key, p.name, p.color, p.status,
              COUNT(t.id) AS total,
              SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN t.status NOT IN ('done','cancelled') AND t.due_date < date('now')
                       THEN 1 ELSE 0 END) AS overdue
         FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.id IN (${scope}) GROUP BY p.id ORDER BY p.name`,
    )
    .all(...ids);

  res.json({
    my: { ...my, done_this_week: doneThisWeek.count },
    myTasks,
    myActionItems,
    team: { ...team, open_action_items: openActions.count },
    statusBreakdown,
    upcoming,
    recentActivity,
    projects,
  });
});

/**
 * Reporting workbench. Everything is filtered by project and date window so
 * the same endpoint drives the charts, the workload table and the CSV export.
 */
router.get('/summary', (req, res) => {
  const ids = visibleProjectIds(req.user);
  if (!ids.length) return res.json({ empty: true });

  const selected = req.query.project_id ? [Number(req.query.project_id)].filter((id) => ids.includes(id)) : ids;
  if (!selected.length) return res.status(403).json({ error: 'No access to that project' });
  const scope = holders(selected);

  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';
  const range = [from, `${to} 23:59:59`];

  const byStatus = db
    .prepare(`SELECT status, COUNT(*) AS count FROM tasks WHERE project_id IN (${scope}) GROUP BY status`)
    .all(...selected);

  const byPriority = db
    .prepare(
      `SELECT priority, COUNT(*) AS count FROM tasks
        WHERE project_id IN (${scope}) AND status NOT IN ('done','cancelled') GROUP BY priority`,
    )
    .all(...selected);

  const byType = db
    .prepare(`SELECT type, COUNT(*) AS count FROM tasks WHERE project_id IN (${scope}) GROUP BY type`)
    .all(...selected);

  const workload = db
    .prepare(
      `SELECT u.id, u.name, u.avatar_color,
              SUM(CASE WHEN t.status NOT IN ('done','cancelled') THEN 1 ELSE 0 END)          AS open,
              SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END)                      AS in_progress,
              SUM(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END)                          AS blocked,
              SUM(CASE WHEN t.status = 'done' AND t.completed_at BETWEEN ? AND ?
                       THEN 1 ELSE 0 END)                                                    AS completed,
              SUM(CASE WHEN t.status NOT IN ('done','cancelled') AND t.due_date IS NOT NULL
                        AND t.due_date < date('now') THEN 1 ELSE 0 END)                      AS overdue,
              COALESCE(SUM(CASE WHEN t.status NOT IN ('done','cancelled')
                                THEN t.estimate_h ELSE 0 END), 0)                            AS open_hours
         FROM users u
         LEFT JOIN tasks t ON t.assignee_id = u.id AND t.project_id IN (${scope})
        WHERE u.is_active = 1
        GROUP BY u.id
        HAVING open > 0 OR completed > 0
        ORDER BY open DESC, completed DESC`,
    )
    .all(...range, ...selected);

  // Weekly created vs completed — the simplest honest throughput picture.
  const throughput = db
    .prepare(
      `SELECT week, SUM(created) AS created, SUM(completed) AS completed FROM (
         SELECT strftime('%Y-W%W', created_at) AS week, 1 AS created, 0 AS completed
           FROM tasks WHERE project_id IN (${scope}) AND created_at BETWEEN ? AND ?
         UNION ALL
         SELECT strftime('%Y-W%W', completed_at) AS week, 0, 1
           FROM tasks WHERE project_id IN (${scope}) AND completed_at IS NOT NULL
             AND completed_at BETWEEN ? AND ?
       ) GROUP BY week ORDER BY week`,
    )
    .all(...selected, ...range, ...selected, ...range);

  const cycleTime = db
    .prepare(
      `SELECT
         ROUND(AVG(julianday(completed_at) - julianday(created_at)), 1) AS avg_days,
         ROUND(MAX(julianday(completed_at) - julianday(created_at)), 1) AS max_days,
         COUNT(*) AS sample
       FROM tasks
      WHERE project_id IN (${scope}) AND status = 'done' AND completed_at BETWEEN ? AND ?`,
    )
    .get(...selected, ...range);

  // How long open work has been sitting there.
  const aging = db
    .prepare(
      `SELECT
         SUM(CASE WHEN julianday('now') - julianday(created_at) <= 7  THEN 1 ELSE 0 END) AS week_1,
         SUM(CASE WHEN julianday('now') - julianday(created_at) > 7
                   AND julianday('now') - julianday(created_at) <= 14 THEN 1 ELSE 0 END) AS week_2,
         SUM(CASE WHEN julianday('now') - julianday(created_at) > 14
                   AND julianday('now') - julianday(created_at) <= 30 THEN 1 ELSE 0 END) AS month_1,
         SUM(CASE WHEN julianday('now') - julianday(created_at) > 30  THEN 1 ELSE 0 END) AS older
       FROM tasks WHERE project_id IN (${scope}) AND status NOT IN ('done','cancelled')`,
    )
    .get(...selected);

  const meetings = db
    .prepare(
      `SELECT COUNT(*) AS count, source FROM meetings
        WHERE project_id IN (${scope}) AND occurred_at BETWEEN ? AND ? GROUP BY source`,
    )
    .all(...selected, ...range);

  const actionItemFunnel = db
    .prepare(
      `SELECT ai.status, COUNT(*) AS count FROM action_items ai
         JOIN meetings m ON m.id = ai.meeting_id
        WHERE m.project_id IN (${scope}) AND m.occurred_at BETWEEN ? AND ?
        GROUP BY ai.status`,
    )
    .all(...selected, ...range);

  const overdueList = db
    .prepare(
      `SELECT t.id, t.key, t.title, t.due_date, t.priority, t.status,
              CAST(julianday('now') - julianday(t.due_date) AS INTEGER) AS days_late,
              u.name AS assignee_name, u.avatar_color AS assignee_color, p.key AS project_key
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.project_id IN (${scope}) AND t.status NOT IN ('done','cancelled')
          AND t.due_date IS NOT NULL AND t.due_date < date('now')
        ORDER BY t.due_date ASC LIMIT 50`,
    )
    .all(...selected);

  res.json({
    range: { from, to },
    byStatus, byPriority, byType, workload, throughput, cycleTime, aging,
    meetings, actionItemFunnel, overdueList,
  });
});

/** CSV export for whoever still wants it in a spreadsheet. */
router.get('/export', (req, res) => {
  const ids = visibleProjectIds(req.user);
  if (!ids.length) return res.status(200).type('text/csv').send('');
  const selected = req.query.project_id ? [Number(req.query.project_id)].filter((id) => ids.includes(id)) : ids;
  if (!selected.length) return res.status(403).json({ error: 'No access to that project' });

  const rows = db
    .prepare(
      `SELECT p.key AS project, t.key, t.title, t.type, t.status, t.priority,
              COALESCE(a.name, '') AS assignee, COALESCE(r.name, '') AS reporter,
              COALESCE(t.due_date, '') AS due_date, t.estimate_h, t.spent_h, t.progress,
              t.created_at, COALESCE(t.completed_at, '') AS completed_at,
              COALESCE(m.title, '') AS from_meeting
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN users a ON a.id = t.assignee_id
         LEFT JOIN users r ON r.id = t.reporter_id
         LEFT JOIN meetings m ON m.id = t.meeting_id
        WHERE t.project_id IN (${holders(selected)})
        ORDER BY p.key, t.number`,
    )
    .all(...selected);

  const headers = rows.length
    ? Object.keys(rows[0])
    : ['project', 'key', 'title', 'type', 'status', 'priority', 'assignee'];
  const escape = (value) => {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n');

  res.type('text/csv').set('Content-Disposition', 'attachment; filename="teamtrack-tasks.csv"').send(csv);
});

export default router;
