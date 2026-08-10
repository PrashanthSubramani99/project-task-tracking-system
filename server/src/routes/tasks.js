import express from 'express';
import { db, tx, jsonCol } from '../db.js';
import { logActivity, logChanges, activityFor, fieldLabel } from '../activity.js';
import { notify, notifyMany, taskAudience, addWatcher, resolveMentions } from '../notify.js';
import { can, requireCap, visibleProjectIds } from '../permissions.js';

const router = express.Router();

export const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'];
export const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
export const TYPES = ['task', 'bug', 'improvement', 'action', 'doc'];

const STATUS_LABELS = {
  backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', in_review: 'In review',
  blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled',
};

/** Progress the board implies, so the bar never contradicts the column. */
const IMPLIED_PROGRESS = { backlog: 0, todo: 0, in_progress: 50, in_review: 80, blocked: null, done: 100, cancelled: null };

const TASK_SELECT = `
  SELECT t.*,
         p.key   AS project_key, p.name AS project_name, p.color AS project_color,
         a.name  AS assignee_name, a.avatar_color AS assignee_color,
         r.name  AS reporter_name, r.avatar_color AS reporter_color,
         pt.key  AS parent_key,  pt.title AS parent_title,
         m.title AS meeting_title,
         (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id)     AS comment_count,
         (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id)      AS subtask_count,
         (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done') AS subtask_done
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN users a   ON a.id = t.assignee_id
    LEFT JOIN users r   ON r.id = t.reporter_id
    LEFT JOIN tasks pt  ON pt.id = t.parent_id
    LEFT JOIN meetings m ON m.id = t.meeting_id`;

const shape = (row) =>
  row && {
    ...row,
    labels: jsonCol(row.labels, []),
    is_overdue: Boolean(row.due_date && row.due_date < new Date().toISOString().slice(0, 10) && !['done', 'cancelled'].includes(row.status)),
  };

const taskProjectId = (req) => {
  if (req.body?.project_id) return Number(req.body.project_id);
  const row = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(req.params.id);
  return row ? row.project_id : null;
};

// ----------------------------------------------------------------- list ----

router.get('/', (req, res) => {
  const ids = visibleProjectIds(req.user);
  if (!ids.length) return res.json({ tasks: [], total: 0 });

  const where = [`t.project_id IN (${ids.map(() => '?').join(',')})`];
  const params = [...ids];

  const listParam = (value, column) => {
    if (!value) return;
    const values = String(value).split(',').map((v) => v.trim()).filter(Boolean);
    if (!values.length) return;
    where.push(`${column} IN (${values.map(() => '?').join(',')})`);
    params.push(...values);
  };

  if (req.query.project_id) listParam(req.query.project_id, 't.project_id');
  listParam(req.query.status, 't.status');
  listParam(req.query.priority, 't.priority');
  listParam(req.query.type, 't.type');

  if (req.query.assignee_id === 'me') {
    where.push('t.assignee_id = ?');
    params.push(req.user.id);
  } else if (req.query.assignee_id === 'none') {
    where.push('t.assignee_id IS NULL');
  } else if (req.query.assignee_id) {
    listParam(req.query.assignee_id, 't.assignee_id');
  }

  if (req.query.meeting_id) {
    where.push('t.meeting_id = ?');
    params.push(req.query.meeting_id);
  }
  if (req.query.parent_id) {
    where.push('t.parent_id = ?');
    params.push(req.query.parent_id);
  }
  if (req.query.open === 'true') where.push("t.status NOT IN ('done','cancelled')");
  if (req.query.overdue === 'true') {
    where.push("t.status NOT IN ('done','cancelled') AND t.due_date IS NOT NULL AND t.due_date < date('now')");
  }
  if (req.query.due_within) {
    const days = Number(req.query.due_within) || 7;
    where.push(
      `t.status NOT IN ('done','cancelled') AND t.due_date IS NOT NULL AND t.due_date <= date('now', '+${days} days')`,
    );
  }
  if (req.query.label) {
    where.push('t.labels LIKE ?');
    params.push(`%"${req.query.label}"%`);
  }
  if (req.query.q) {
    where.push('(t.title LIKE ? OR t.description LIKE ? OR t.key LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like, like);
  }

  const sortMap = {
    updated: 't.updated_at DESC',
    created: 't.created_at DESC',
    due: 't.due_date IS NULL, t.due_date ASC',
    priority: `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
    status: `CASE t.status ${STATUSES.map((s, i) => `WHEN '${s}' THEN ${i}`).join(' ')} END, t.position`,
    key: 't.project_id, t.number DESC',
  };
  const order = sortMap[req.query.sort] || sortMap.updated;

  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const offset = Number(req.query.offset) || 0;

  const clause = `WHERE ${where.join(' AND ')}`;
  const rows = db.prepare(`${TASK_SELECT} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM tasks t ${clause}`).get(...params);

  res.json({ tasks: rows.map(shape), total });
});

/** Board view: the same filtered set, already bucketed into columns. */
router.get('/board', (req, res) => {
  const ids = visibleProjectIds(req.user);
  if (!ids.length) return res.json({ columns: [] });

  const where = [`t.project_id IN (${ids.map(() => '?').join(',')})`];
  const params = [...ids];
  if (req.query.project_id) {
    where.push('t.project_id = ?');
    params.push(req.query.project_id);
  }
  if (req.query.assignee_id === 'me') {
    where.push('t.assignee_id = ?');
    params.push(req.user.id);
  } else if (req.query.assignee_id) {
    where.push('t.assignee_id = ?');
    params.push(req.query.assignee_id);
  }
  if (req.query.q) {
    where.push('(t.title LIKE ? OR t.key LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`);
  }
  if (req.query.priority) {
    where.push('t.priority = ?');
    params.push(req.query.priority);
  }

  const rows = db
    .prepare(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.position, t.id DESC`)
    .all(...params)
    .map(shape);

  const visible = req.query.include_cancelled === 'true' ? STATUSES : STATUSES.filter((s) => s !== 'cancelled');
  res.json({
    columns: visible.map((status) => ({
      status,
      label: STATUS_LABELS[status],
      tasks: rows.filter((t) => t.status === status),
    })),
  });
});

// ------------------------------------------------------------- one task ----

router.get('/:id', (req, res) => {
  const task = shape(db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(req.params.id));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!can(req.user, 'task.view', task.project_id)) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }

  const comments = db
    .prepare(
      `SELECT c.*, u.name AS author_name, u.avatar_color AS author_color
         FROM comments c LEFT JOIN users u ON u.id = c.author_id
        WHERE c.task_id = ? ORDER BY c.created_at ASC`,
    )
    .all(task.id);

  const subtasks = db
    .prepare(`${TASK_SELECT} WHERE t.parent_id = ? ORDER BY t.position, t.id`)
    .all(task.id)
    .map(shape);

  const watchers = db
    .prepare(
      `SELECT u.id, u.name, u.avatar_color FROM task_watchers w
         JOIN users u ON u.id = w.user_id WHERE w.task_id = ?`,
    )
    .all(task.id);

  const links = db.prepare('SELECT * FROM task_links WHERE task_id = ? ORDER BY id').all(task.id);

  res.json({
    task,
    comments,
    subtasks,
    watchers,
    links,
    activity: activityFor('task', task.id),
    isWatching: watchers.some((w) => w.id === req.user.id),
  });
});

// ---------------------------------------------------------------- create ----

/** Allocate the next per-project number so keys read APP-1, APP-2, … */
function nextKey(projectId) {
  const project = db.prepare('SELECT key, seq FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  const number = project.seq + 1;
  db.prepare('UPDATE projects SET seq = ? WHERE id = ?').run(number, projectId);
  return { key: `${project.key}-${number}`, number };
}

export function createTask(payload, actor) {
  const {
    project_id, title, description = '', type = 'task', status = 'todo', priority = 'medium',
    assignee_id = null, due_date = null, start_date = null, estimate_h = 0, parent_id = null,
    meeting_id = null, labels = [], progress,
  } = payload;

  const { key, number } = nextKey(project_id);
  const position = (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tasks WHERE project_id = ? AND status = ?')
    .get(project_id, status)).p;

  const info = db
    .prepare(
      `INSERT INTO tasks
         (project_id, key, number, title, description, type, status, priority, assignee_id, reporter_id,
          due_date, start_date, estimate_h, parent_id, meeting_id, labels, position, progress, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      project_id, key, number, String(title).trim(), description, type, status, priority,
      assignee_id || null, actor.id, due_date || null, start_date || null, Number(estimate_h) || 0,
      parent_id || null, meeting_id || null, JSON.stringify(labels || []), position,
      progress ?? IMPLIED_PROGRESS[status] ?? 0,
      status === 'done' ? new Date().toISOString() : null,
    );

  const id = Number(info.lastInsertRowid);
  addWatcher(id, actor.id);
  addWatcher(id, assignee_id);

  logActivity({
    projectId: project_id, entityType: 'task', entityId: id, entityLabel: key,
    actorId: actor.id, action: 'created', summary: `created ${key} — ${title}`,
  });

  if (assignee_id && assignee_id !== actor.id) {
    notify({
      userId: assignee_id, actorId: actor.id, type: 'assigned',
      title: `${key} assigned to you`,
      body: `${actor.name} assigned you “${title}”.`,
      link: `/tasks/${id}`,
      severity: priority === 'urgent' ? 'critical' : 'info',
    });
  }
  return id;
}

router.post('/', requireCap('task.create', (req) => Number(req.body?.project_id) || null), (req, res) => {
  const { project_id, title } = req.body || {};
  if (!project_id) return res.status(400).json({ error: 'Pick a project for this task' });
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Task title is required' });
  if (req.body.status && !STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Unknown status' });
  if (req.body.priority && !PRIORITIES.includes(req.body.priority)) return res.status(400).json({ error: 'Unknown priority' });
  if (req.body.type && !TYPES.includes(req.body.type)) return res.status(400).json({ error: 'Unknown task type' });

  const id = tx(() => createTask(req.body, req.user));
  res.status(201).json({ task: shape(db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id)) });
});

// ---------------------------------------------------------------- update ----

const EDITABLE = [
  'title', 'description', 'type', 'status', 'priority', 'assignee_id', 'due_date',
  'start_date', 'estimate_h', 'spent_h', 'progress', 'parent_id', 'labels', 'blocked_reason',
];

router.patch('/:id', requireCap('task.edit', taskProjectId), (req, res) => {
  const id = Number(req.params.id);
  const before = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!before) return res.status(404).json({ error: 'Task not found' });

  const body = req.body || {};
  if (body.status && !STATUSES.includes(body.status)) return res.status(400).json({ error: 'Unknown status' });
  if (body.priority && !PRIORITIES.includes(body.priority)) return res.status(400).json({ error: 'Unknown priority' });
  if (body.type && !TYPES.includes(body.type)) return res.status(400).json({ error: 'Unknown task type' });
  if (body.parent_id && Number(body.parent_id) === id) return res.status(400).json({ error: 'A task cannot be its own parent' });

  const patch = {};
  for (const field of EDITABLE) {
    if (!(field in body)) continue;
    patch[field] = field === 'labels' ? JSON.stringify(body.labels || []) : body[field];
  }

  // Moving to a status carries its implied progress unless the caller set one.
  if (patch.status && patch.progress === undefined) {
    const implied = IMPLIED_PROGRESS[patch.status];
    if (implied !== null && implied !== undefined) patch.progress = implied;
  }
  if (patch.progress !== undefined) patch.progress = Math.max(0, Math.min(100, Number(patch.progress) || 0));

  if (!Object.keys(patch).length) return res.json({ task: shape(db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id)) });

  const assignments = Object.keys(patch).map((f) => `${f} = ?`).join(', ');
  db.prepare(`UPDATE tasks SET ${assignments}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(patch), id);

  if (patch.status === 'done' && before.status !== 'done') {
    db.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  } else if (patch.status && patch.status !== 'done' && before.status === 'done') {
    db.prepare('UPDATE tasks SET completed_at = NULL WHERE id = ?').run(id);
  }

  const after = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  const changes = logChanges({
    before, after, fields: EDITABLE,
    entityType: 'task', entityId: id, entityLabel: after.key,
    projectId: after.project_id, actorId: req.user.id,
  });

  if (changes.length) {
    const statusChange = changes.find((c) => c.field === 'status');
    const assigneeChange = changes.find((c) => c.field === 'assignee_id');

    if (assigneeChange && after.assignee_id) {
      addWatcher(id, after.assignee_id);
      notify({
        userId: after.assignee_id, actorId: req.user.id, type: 'assigned',
        title: `${after.key} assigned to you`,
        body: `${req.user.name} assigned you “${after.title}”.`,
        link: `/tasks/${id}`,
        severity: after.priority === 'urgent' ? 'critical' : 'info',
      });
    }

    if (statusChange) {
      notifyMany(taskAudience(id), {
        actorId: req.user.id, type: 'status',
        title: `${after.key} moved to ${STATUS_LABELS[after.status]}`,
        body: `${req.user.name} moved “${after.title}” from ${STATUS_LABELS[before.status]} to ${STATUS_LABELS[after.status]}.`,
        link: `/tasks/${id}`,
        severity: after.status === 'blocked' ? 'warning' : 'info',
      });
    } else {
      // One digest-style ping for other edits rather than one per field.
      const fields = changes.filter((c) => c.field !== 'assignee_id').map((c) => fieldLabel(c.field));
      if (fields.length) {
        notifyMany(taskAudience(id), {
          actorId: req.user.id, type: 'status',
          title: `${after.key} updated`,
          body: `${req.user.name} changed ${fields.join(', ')}.`,
          link: `/tasks/${id}`,
        });
      }
    }
  }

  res.json({ task: shape(db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id)), changes });
});

/** Board drag-and-drop: change column and ordering in one call. */
router.post('/:id/move', requireCap('task.transition', taskProjectId), (req, res) => {
  const id = Number(req.params.id);
  const { status, position } = req.body || {};
  const before = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!before) return res.status(404).json({ error: 'Task not found' });
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });

  const implied = IMPLIED_PROGRESS[status];
  db.prepare(
    `UPDATE tasks SET status = ?, position = ?, progress = COALESCE(?, progress),
            completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, ?) ELSE NULL END,
            updated_at = datetime('now')
      WHERE id = ?`,
  ).run(status, position ?? before.position, implied ?? null, status, new Date().toISOString(), id);

  if (status !== before.status) {
    logActivity({
      projectId: before.project_id, entityType: 'task', entityId: id, entityLabel: before.key,
      actorId: req.user.id, action: 'updated', field: 'status',
      oldValue: before.status, newValue: status,
      summary: `moved ${before.key} from ${STATUS_LABELS[before.status]} to ${STATUS_LABELS[status]}`,
    });
    notifyMany(taskAudience(id), {
      actorId: req.user.id, type: 'status',
      title: `${before.key} moved to ${STATUS_LABELS[status]}`,
      body: `${req.user.name} moved “${before.title}”.`,
      link: `/tasks/${id}`,
      severity: status === 'blocked' ? 'warning' : 'info',
    });
  }

  res.json({ task: shape(db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id)) });
});

/** Bulk edit from the list view (assign five things to one person at once). */
router.post('/bulk', (req, res) => {
  const { ids = [], patch = {} } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Select at least one task' });

  const allowed = ['status', 'priority', 'assignee_id', 'due_date'];
  const fields = Object.keys(patch).filter((f) => allowed.includes(f));
  if (!fields.length) return res.status(400).json({ error: 'Nothing to change' });

  let updated = 0;
  const skipped = [];
  tx(() => {
    for (const id of ids) {
      const before = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      if (!before) continue;
      if (!can(req.user, 'task.edit', before.project_id)) {
        skipped.push(before.key);
        continue;
      }
      const sets = fields.map((f) => `${f} = ?`).join(', ');
      db.prepare(`UPDATE tasks SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(
        ...fields.map((f) => patch[f]), id,
      );
      const after = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      logChanges({
        before, after, fields,
        entityType: 'task', entityId: id, entityLabel: after.key,
        projectId: after.project_id, actorId: req.user.id,
      });
      if (patch.assignee_id && patch.assignee_id !== before.assignee_id) {
        addWatcher(id, patch.assignee_id);
        notify({
          userId: patch.assignee_id, actorId: req.user.id, type: 'assigned',
          title: `${after.key} assigned to you`,
          body: `${req.user.name} assigned you “${after.title}”.`,
          link: `/tasks/${id}`,
        });
      }
      updated += 1;
    }
  });

  res.json({ updated, skipped });
});

router.delete('/:id', requireCap('task.delete', taskProjectId), (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  logActivity({
    projectId: task.project_id, entityType: 'task', entityId: task.id, entityLabel: task.key,
    actorId: req.user.id, action: 'deleted', summary: `deleted ${task.key} — ${task.title}`,
  });
  res.json({ ok: true });
});

// -------------------------------------------------------------- comments ----

router.post('/:id/comments', requireCap('comment.create', taskProjectId), (req, res) => {
  const id = Number(req.params.id);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write something first' });

  const info = db.prepare('INSERT INTO comments (task_id, author_id, body) VALUES (?, ?, ?)').run(id, req.user.id, body);
  addWatcher(id, req.user.id);

  logActivity({
    projectId: task.project_id, entityType: 'task', entityId: id, entityLabel: task.key,
    actorId: req.user.id, action: 'commented',
    summary: `commented: ${body.length > 90 ? `${body.slice(0, 87)}…` : body}`,
  });

  const mentioned = resolveMentions(body);
  notifyMany(mentioned, {
    actorId: req.user.id, type: 'mentioned',
    title: `${req.user.name} mentioned you on ${task.key}`,
    body,
    link: `/tasks/${id}`,
  });
  notifyMany(
    taskAudience(id).filter((uid) => !mentioned.includes(uid)),
    {
      actorId: req.user.id, type: 'comment',
      title: `New comment on ${task.key}`,
      body: `${req.user.name}: ${body.length > 120 ? `${body.slice(0, 117)}…` : body}`,
      link: `/tasks/${id}`,
    },
  );

  const comment = db
    .prepare(
      `SELECT c.*, u.name AS author_name, u.avatar_color AS author_color
         FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.id = ?`,
    )
    .get(Number(info.lastInsertRowid));
  res.status(201).json({ comment });
});

router.delete('/:id/comments/:commentId', (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(comment.task_id);

  const isAuthor = comment.author_id === req.user.id;
  if (!isAuthor && !can(req.user, 'comment.delete.any', task.project_id)) {
    return res.status(403).json({ error: 'You can only delete your own comments' });
  }
  db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
  logActivity({
    projectId: task.project_id, entityType: 'task', entityId: task.id, entityLabel: task.key,
    actorId: req.user.id, action: 'updated', field: 'comment', summary: 'deleted a comment',
  });
  res.json({ ok: true });
});

// ------------------------------------------------------ watchers + links ----

router.post('/:id/watch', (req, res) => {
  const id = Number(req.params.id);
  const task = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!can(req.user, 'task.view', task.project_id)) return res.status(403).json({ error: 'No access to this project' });

  const watching = db.prepare('SELECT 1 FROM task_watchers WHERE task_id = ? AND user_id = ?').get(id, req.user.id);
  if (watching) {
    db.prepare('DELETE FROM task_watchers WHERE task_id = ? AND user_id = ?').run(id, req.user.id);
    return res.json({ watching: false });
  }
  addWatcher(id, req.user.id);
  res.json({ watching: true });
});

router.post('/:id/links', requireCap('task.edit', taskProjectId), (req, res) => {
  const { label, url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'A link needs a URL' });
  const info = db.prepare('INSERT INTO task_links (task_id, label, url) VALUES (?, ?, ?)').run(
    req.params.id, label || url, url,
  );
  res.status(201).json({ link: db.prepare('SELECT * FROM task_links WHERE id = ?').get(Number(info.lastInsertRowid)) });
});

router.delete('/:id/links/:linkId', requireCap('task.edit', taskProjectId), (req, res) => {
  db.prepare('DELETE FROM task_links WHERE id = ? AND task_id = ?').run(req.params.linkId, req.params.id);
  res.json({ ok: true });
});

export default router;
