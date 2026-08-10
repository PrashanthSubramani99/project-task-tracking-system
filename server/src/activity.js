import { db } from './db.js';

const FIELD_LABELS = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  assignee_id: 'assignee',
  reporter_id: 'reporter',
  due_date: 'due date',
  start_date: 'start date',
  estimate_h: 'estimate',
  spent_h: 'time spent',
  progress: 'progress',
  type: 'type',
  labels: 'labels',
  parent_id: 'parent',
  blocked_reason: 'blocked reason',
  project_id: 'project',
  owner_id: 'owner',
  environment: 'environment',
  port: 'port',
  host: 'host',
  category: 'category',
  body: 'content',
  summary: 'summary',
  raw_notes: 'notes',
  decisions: 'decisions',
  occurred_at: 'date',
  role: 'role',
};

const userName = (id) => {
  if (!id) return 'Unassigned';
  const row = db.prepare('SELECT name FROM users WHERE id = ?').get(id);
  return row ? row.name : `User #${id}`;
};

/** Turn a stored value into something readable in the activity feed. */
function display(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'assignee_id' || field === 'reporter_id' || field === 'owner_id' || field === 'lead_id') {
    return userName(Number(value));
  }
  if (field === 'labels') {
    try {
      const arr = JSON.parse(value);
      return arr.length ? arr.join(', ') : '—';
    } catch {
      return String(value);
    }
  }
  if (field === 'progress') return `${value}%`;
  if (typeof value === 'string' && value.length > 120) return `${value.slice(0, 117)}…`;
  return String(value);
}

export const fieldLabel = (field) => FIELD_LABELS[field] || field.replace(/_/g, ' ');

/**
 * Record one activity row.
 * Returns the inserted id so callers can chain notifications to it.
 */
export function logActivity({
  projectId = null,
  entityType,
  entityId,
  entityLabel = '',
  actorId = null,
  action,
  field = '',
  oldValue = '',
  newValue = '',
  summary = '',
}) {
  const info = db
    .prepare(
      `INSERT INTO activities
         (project_id, entity_type, entity_id, entity_label, actor_id, action, field, old_value, new_value, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      projectId,
      entityType,
      entityId,
      entityLabel,
      actorId,
      action,
      field,
      oldValue === null || oldValue === undefined ? '' : String(oldValue),
      newValue === null || newValue === undefined ? '' : String(newValue),
      summary,
    );
  return info.lastInsertRowid;
}

/**
 * Compare before/after rows and write one activity row per changed field.
 * Returns the list of changes so the caller can decide who to notify.
 */
export function logChanges({ before, after, fields, entityType, entityId, entityLabel, projectId, actorId }) {
  const changes = [];
  for (const field of fields) {
    const oldV = before[field];
    const newV = after[field];
    if (String(oldV ?? '') === String(newV ?? '')) continue;
    changes.push({ field, from: oldV, to: newV });
    logActivity({
      projectId,
      entityType,
      entityId,
      entityLabel,
      actorId,
      action: 'updated',
      field,
      oldValue: oldV,
      newValue: newV,
      summary: `changed ${fieldLabel(field)} from ${display(field, oldV)} to ${display(field, newV)}`,
    });
  }
  return changes;
}

export function activityFor(entityType, entityId, limit = 100) {
  return db
    .prepare(
      `SELECT a.*, u.name AS actor_name, u.avatar_color AS actor_color
         FROM activities a
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.entity_type = ? AND a.entity_id = ?
        ORDER BY a.id DESC
        LIMIT ?`,
    )
    .all(entityType, entityId, limit);
}
