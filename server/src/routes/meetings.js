import express from 'express';
import { db, tx } from '../db.js';
import { logActivity, logChanges, activityFor } from '../activity.js';
import { notify, notifyMany } from '../notify.js';
import { can, requireCap, visibleProjectIds } from '../permissions.js';
import { parseActionItems } from '../parser.js';
import { parsePagination } from '../paginate.js';
import { createTask } from './tasks.js';

const router = express.Router();

const SOURCES = ['gmeet', 'whatsapp', 'call', 'in_person', 'other'];
const SOURCE_LABELS = {
  gmeet: 'Google Meet', whatsapp: 'WhatsApp', call: 'Phone call', in_person: 'In person', other: 'Other',
};

const meetingProjectId = (req) => {
  if (req.body?.project_id) return Number(req.body.project_id);
  const row = db.prepare('SELECT project_id FROM meetings WHERE id = ?').get(req.params.id);
  return row ? row.project_id : null;
};

const MEETING_SELECT = `
  SELECT m.*, p.key AS project_key, p.name AS project_name, p.color AS project_color,
         u.name AS created_by_name, u.avatar_color AS created_by_color,
         (SELECT COUNT(*) FROM action_items ai WHERE ai.meeting_id = m.id) AS action_count,
         (SELECT COUNT(*) FROM action_items ai WHERE ai.meeting_id = m.id AND ai.status = 'open') AS open_action_count,
         (SELECT COUNT(*) FROM meeting_attendees ma WHERE ma.meeting_id = m.id) AS attendee_count
    FROM meetings m
    LEFT JOIN projects p ON p.id = m.project_id
    LEFT JOIN users u ON u.id = m.created_by`;

// ---------------------------------------------------------------- list ----

router.get('/', (req, res) => {
  const ids = visibleProjectIds(req.user);
  if (!ids.length) {
    const { page, limit } = parsePagination(req.query);
    return res.json({ meetings: [], total: 0, page, limit });
  }

  const where = [`m.project_id IN (${ids.map(() => '?').join(',')})`];
  const params = [...ids];
  if (req.query.project_id) {
    where.push('m.project_id = ?');
    params.push(req.query.project_id);
  }
  if (req.query.source) {
    where.push('m.source = ?');
    params.push(req.query.source);
  }
  if (req.query.q) {
    where.push('(m.title LIKE ? OR m.summary LIKE ? OR m.raw_notes LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like, like);
  }
  if (req.query.has_open_actions === 'true') {
    where.push("EXISTS (SELECT 1 FROM action_items ai WHERE ai.meeting_id = m.id AND ai.status = 'open')");
  }

  const { limit, offset, page } = parsePagination(req.query);
  const clause = `WHERE ${where.join(' AND ')}`;
  const rows = db
    .prepare(`${MEETING_SELECT} ${clause} ORDER BY m.occurred_at DESC, m.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM meetings m ${clause}`).get(...params);

  res.json({ meetings: rows, total, page, limit });
});

/**
 * Every action item still waiting on someone, across all visible projects.
 * This is the "nothing gets dropped" screen.
 */
router.get('/action-items', (req, res) => {
  const ids = visibleProjectIds(req.user);
  if (!ids.length) {
    const { page, limit } = parsePagination(req.query);
    return res.json({ items: [], total: 0, page, limit });
  }

  const where = [`m.project_id IN (${ids.map(() => '?').join(',')})`];
  const params = [...ids];
  if (req.query.status) {
    where.push('ai.status = ?');
    params.push(req.query.status);
  } else {
    where.push("ai.status = 'open'");
  }
  if (req.query.owner_id === 'me') {
    where.push('ai.owner_id = ?');
    params.push(req.user.id);
  } else if (req.query.owner_id === 'none') {
    where.push('ai.owner_id IS NULL');
  } else if (req.query.owner_id) {
    where.push('ai.owner_id = ?');
    params.push(req.query.owner_id);
  }
  if (req.query.project_id) {
    where.push('m.project_id = ?');
    params.push(req.query.project_id);
  }
  if (req.query.q) {
    where.push('ai.text LIKE ?');
    params.push(`%${req.query.q}%`);
  }

  const { limit, offset, page } = parsePagination(req.query);
  const clause = `WHERE ${where.join(' AND ')}`;
  const items = db
    .prepare(
      `SELECT ai.*, m.title AS meeting_title, m.occurred_at, m.source, m.project_id,
              p.key AS project_key, p.name AS project_name, p.color AS project_color,
              o.name AS owner_name, o.avatar_color AS owner_color,
              t.key AS task_key, t.status AS task_status
         FROM action_items ai
         JOIN meetings m ON m.id = ai.meeting_id
         LEFT JOIN projects p ON p.id = m.project_id
         LEFT JOIN users o ON o.id = ai.owner_id
         LEFT JOIN tasks t ON t.id = ai.task_id
        ${clause}
        ORDER BY ai.due_date IS NULL, ai.due_date ASC, m.occurred_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM action_items ai JOIN meetings m ON m.id = ai.meeting_id ${clause}`)
    .get(...params);

  // Summary counts across the FULL filtered set (not just this page), so the
  // "N overdue" / "N with no owner" callouts stay accurate under pagination.
  const { overdue_count } = db
    .prepare(
      `SELECT COUNT(*) AS overdue_count FROM action_items ai JOIN meetings m ON m.id = ai.meeting_id
        ${clause} AND ai.due_date IS NOT NULL AND ai.due_date < date('now')`,
    )
    .get(...params);
  const { unowned_count } = db
    .prepare(
      `SELECT COUNT(*) AS unowned_count FROM action_items ai JOIN meetings m ON m.id = ai.meeting_id
        ${clause} AND ai.owner_id IS NULL`,
    )
    .get(...params);

  res.json({ items, total, page, limit, overdue_count, unowned_count });
});

/**
 * Dry-run the parser so the UI can preview extracted items before saving.
 * Nothing is written here.
 */
router.post('/parse', (req, res) => {
  const { notes, project_id, occurred_at } = req.body || {};
  if (!notes || !String(notes).trim()) return res.status(400).json({ error: 'Paste some notes first' });

  const people = project_id
    ? db
        .prepare(
          `SELECT u.id, u.name, u.email FROM project_members pm
             JOIN users u ON u.id = pm.user_id
            WHERE pm.project_id = ? AND u.is_active = 1`,
        )
        .all(project_id)
    : db.prepare('SELECT id, name, email FROM users WHERE is_active = 1').all();

  const result = parseActionItems(notes, { people, baseDate: occurred_at ? new Date(occurred_at) : new Date() });
  res.json(result);
});

// ------------------------------------------------------------ one meeting ----

router.get('/:id', (req, res) => {
  const meeting = db.prepare(`${MEETING_SELECT} WHERE m.id = ?`).get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (!can(req.user, 'meeting.view', meeting.project_id)) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }

  const attendees = db
    .prepare(
      `SELECT u.id, u.name, u.avatar_color, u.title FROM meeting_attendees ma
         JOIN users u ON u.id = ma.user_id WHERE ma.meeting_id = ?`,
    )
    .all(meeting.id);

  const actionItems = db
    .prepare(
      `SELECT ai.*, o.name AS owner_name, o.avatar_color AS owner_color,
              t.key AS task_key, t.status AS task_status, t.assignee_id AS task_assignee_id
         FROM action_items ai
         LEFT JOIN users o ON o.id = ai.owner_id
         LEFT JOIN tasks t ON t.id = ai.task_id
        WHERE ai.meeting_id = ? ORDER BY ai.position, ai.id`,
    )
    .all(meeting.id);

  const tasks = db
    .prepare(
      `SELECT t.id, t.key, t.title, t.status, t.priority, t.due_date,
              u.name AS assignee_name, u.avatar_color AS assignee_color
         FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.meeting_id = ? ORDER BY t.id`,
    )
    .all(meeting.id);

  res.json({ meeting, attendees, actionItems, tasks, activity: activityFor('meeting', meeting.id) });
});

// ---------------------------------------------------------------- create ----

router.post('/', requireCap('meeting.create', (req) => Number(req.body?.project_id) || null), (req, res) => {
  const {
    project_id, title, source = 'gmeet', occurred_at, duration_min = 0, location = '',
    summary = '', raw_notes = '', decisions = '', attendees = [], action_items = [], status = 'published',
  } = req.body || {};

  if (!project_id) return res.status(400).json({ error: 'Pick a project for this meeting' });
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Give the discussion a title' });
  if (!SOURCES.includes(source)) return res.status(400).json({ error: 'Unknown meeting source' });

  const when = occurred_at || new Date().toISOString().slice(0, 16).replace('T', ' ');

  const meetingId = tx(() => {
    const info = db
      .prepare(
        `INSERT INTO meetings
           (project_id, title, source, occurred_at, duration_min, location, summary, raw_notes, decisions, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(project_id, String(title).trim(), source, when, Number(duration_min) || 0, location,
           summary, raw_notes, decisions, status, req.user.id);

    const id = Number(info.lastInsertRowid);

    const addAttendee = db.prepare('INSERT OR IGNORE INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)');
    addAttendee.run(id, req.user.id);
    for (const userId of attendees) if (userId) addAttendee.run(id, userId);

    const addItem = db.prepare(
      `INSERT INTO action_items (meeting_id, text, owner_id, due_date, priority, position)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    action_items.forEach((item, index) => {
      const text = String(item.text || '').trim();
      if (!text) return;
      addItem.run(id, text, item.owner_id || null, item.due_date || null, item.priority || 'medium', index);
    });

    return id;
  });

  const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
  logActivity({
    projectId: project_id, entityType: 'meeting', entityId: meetingId, entityLabel: meeting.title,
    actorId: req.user.id, action: 'created',
    summary: `logged a ${SOURCE_LABELS[source]} discussion — ${meeting.title}`,
  });

  // Tell attendees and item owners that the notes exist and what is on them.
  const savedItems = db.prepare('SELECT * FROM action_items WHERE meeting_id = ?').all(meetingId);
  notifyMany(attendees, {
    actorId: req.user.id, type: 'action_item',
    title: `Notes published: ${meeting.title}`,
    body: `${req.user.name} shared notes with ${savedItems.length} action item(s).`,
    link: `/meetings/${meetingId}`,
  });
  for (const item of savedItems) {
    if (!item.owner_id) continue;
    notify({
      userId: item.owner_id, actorId: req.user.id, type: 'action_item',
      title: 'You picked up an action item',
      body: `${item.text}${item.due_date ? ` (due ${item.due_date})` : ''}`,
      link: `/meetings/${meetingId}`,
      severity: item.priority === 'urgent' ? 'critical' : 'info',
    });
  }

  res.status(201).json({ meeting: db.prepare(`${MEETING_SELECT} WHERE m.id = ?`).get(meetingId) });
});

router.patch('/:id', requireCap('meeting.edit', meetingProjectId), (req, res) => {
  const id = Number(req.params.id);
  const before = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
  if (!before) return res.status(404).json({ error: 'Meeting not found' });

  const { title, source, occurred_at, duration_min, location, summary, raw_notes, decisions, status, attendees } = req.body || {};
  if (source && !SOURCES.includes(source)) return res.status(400).json({ error: 'Unknown meeting source' });

  db.prepare(
    `UPDATE meetings SET
        title = COALESCE(?, title), source = COALESCE(?, source),
        occurred_at = COALESCE(?, occurred_at), duration_min = COALESCE(?, duration_min),
        location = COALESCE(?, location), summary = COALESCE(?, summary),
        raw_notes = COALESCE(?, raw_notes), decisions = COALESCE(?, decisions),
        status = COALESCE(?, status), updated_at = datetime('now')
      WHERE id = ?`,
  ).run(title ?? null, source ?? null, occurred_at ?? null, duration_min ?? null, location ?? null,
        summary ?? null, raw_notes ?? null, decisions ?? null, status ?? null, id);

  if (Array.isArray(attendees)) {
    db.prepare('DELETE FROM meeting_attendees WHERE meeting_id = ?').run(id);
    const add = db.prepare('INSERT OR IGNORE INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)');
    for (const userId of attendees) if (userId) add.run(id, userId);
  }

  const after = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
  logChanges({
    before, after,
    fields: ['title', 'source', 'occurred_at', 'summary', 'raw_notes', 'decisions', 'status'],
    entityType: 'meeting', entityId: id, entityLabel: after.title,
    projectId: after.project_id, actorId: req.user.id,
  });

  res.json({ meeting: db.prepare(`${MEETING_SELECT} WHERE m.id = ?`).get(id) });
});

router.delete('/:id', requireCap('meeting.delete', meetingProjectId), (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  db.prepare('DELETE FROM meetings WHERE id = ?').run(meeting.id);
  logActivity({
    projectId: meeting.project_id, entityType: 'meeting', entityId: meeting.id, entityLabel: meeting.title,
    actorId: req.user.id, action: 'deleted', summary: `deleted the notes for ${meeting.title}`,
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------- action items ----

router.post('/:id/action-items', requireCap('action.manage', meetingProjectId), (req, res) => {
  const meetingId = Number(req.params.id);
  const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

  const { text, owner_id = null, due_date = null, priority = 'medium' } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Describe the action item' });

  const { p } = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM action_items WHERE meeting_id = ?').get(meetingId);
  const info = db
    .prepare('INSERT INTO action_items (meeting_id, text, owner_id, due_date, priority, position) VALUES (?, ?, ?, ?, ?, ?)')
    .run(meetingId, String(text).trim(), owner_id, due_date, priority, p);

  logActivity({
    projectId: meeting.project_id, entityType: 'meeting', entityId: meetingId, entityLabel: meeting.title,
    actorId: req.user.id, action: 'updated', field: 'action_items',
    summary: `added an action item — ${String(text).trim()}`,
  });
  if (owner_id) {
    notify({
      userId: owner_id, actorId: req.user.id, type: 'action_item',
      title: 'New action item for you',
      body: `${text}${due_date ? ` (due ${due_date})` : ''}`,
      link: `/meetings/${meetingId}`,
    });
  }

  res.status(201).json({ item: db.prepare('SELECT * FROM action_items WHERE id = ?').get(Number(info.lastInsertRowid)) });
});

router.patch('/:id/action-items/:itemId', requireCap('action.manage', meetingProjectId), (req, res) => {
  const item = db.prepare('SELECT * FROM action_items WHERE id = ? AND meeting_id = ?').get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Action item not found' });
  const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(item.meeting_id);

  const { text, owner_id, due_date, priority, status } = req.body || {};
  if (status && !['open', 'converted', 'dropped'].includes(status)) {
    return res.status(400).json({ error: 'Unknown action item status' });
  }

  db.prepare(
    `UPDATE action_items SET
        text = COALESCE(?, text), owner_id = COALESCE(?, owner_id),
        due_date = COALESCE(?, due_date), priority = COALESCE(?, priority),
        status = COALESCE(?, status), updated_at = datetime('now')
      WHERE id = ?`,
  ).run(text ?? null, owner_id ?? null, due_date ?? null, priority ?? null, status ?? null, item.id);

  const after = db.prepare('SELECT * FROM action_items WHERE id = ?').get(item.id);
  logChanges({
    before: item, after, fields: ['text', 'owner_id', 'due_date', 'priority', 'status'],
    entityType: 'meeting', entityId: meeting.id, entityLabel: meeting.title,
    projectId: meeting.project_id, actorId: req.user.id,
  });

  if (owner_id && owner_id !== item.owner_id) {
    notify({
      userId: owner_id, actorId: req.user.id, type: 'action_item',
      title: 'An action item was assigned to you',
      body: after.text, link: `/meetings/${meeting.id}`,
    });
  }

  res.json({ item: after });
});

router.delete('/:id/action-items/:itemId', requireCap('action.manage', meetingProjectId), (req, res) => {
  db.prepare('DELETE FROM action_items WHERE id = ? AND meeting_id = ?').run(req.params.itemId, req.params.id);
  res.json({ ok: true });
});

/**
 * Promote action items into real, trackable tasks.
 * Accepts a subset of ids so a lead can convert only what is ready.
 */
router.post('/:id/convert', requireCap('task.create', meetingProjectId), (req, res) => {
  const meetingId = Number(req.params.id);
  const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

  const { item_ids, defaults = {} } = req.body || {};
  const items = (
    item_ids?.length
      ? db
          .prepare(
            `SELECT * FROM action_items WHERE meeting_id = ? AND status = 'open'
              AND id IN (${item_ids.map(() => '?').join(',')})`,
          )
          .all(meetingId, ...item_ids)
      : db.prepare("SELECT * FROM action_items WHERE meeting_id = ? AND status = 'open'").all(meetingId)
  );

  if (!items.length) return res.status(400).json({ error: 'No open action items to convert' });

  const created = tx(() =>
    items.map((item) => {
      const taskId = createTask(
        {
          project_id: meeting.project_id,
          title: item.text.length > 160 ? `${item.text.slice(0, 157)}…` : item.text,
          description: `From “${meeting.title}” on ${meeting.occurred_at}.\n\n${item.text}`,
          type: 'action',
          status: defaults.status || 'todo',
          priority: item.priority || 'medium',
          assignee_id: item.owner_id,
          due_date: item.due_date,
          meeting_id: meetingId,
          labels: ['from-meeting'],
        },
        req.user,
      );
      db.prepare("UPDATE action_items SET status = 'converted', task_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(taskId, item.id);
      return db.prepare('SELECT id, key, title, assignee_id FROM tasks WHERE id = ?').get(taskId);
    }),
  );

  logActivity({
    projectId: meeting.project_id, entityType: 'meeting', entityId: meetingId, entityLabel: meeting.title,
    actorId: req.user.id, action: 'updated', field: 'action_items',
    summary: `converted ${created.length} action item(s) into tasks`,
  });

  res.status(201).json({ tasks: created });
});

export default router;
