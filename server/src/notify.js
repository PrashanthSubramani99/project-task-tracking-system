import { db, jsonCol } from './db.js';

const DEFAULT_PREFS = {
  assigned: true,
  mentioned: true,
  comment: true,
  status: true,
  due: true,
  action_item: true,
};

/** Map a notification type onto the preference switch that controls it. */
const PREF_FOR_TYPE = {
  assigned: 'assigned',
  mentioned: 'mentioned',
  comment: 'comment',
  status: 'status',
  due_soon: 'due',
  overdue: 'due',
  action_item: 'action_item',
  project: 'assigned',
};

function prefsFor(userId) {
  const row = db.prepare('SELECT notify_prefs FROM users WHERE id = ?').get(userId);
  return { ...DEFAULT_PREFS, ...jsonCol(row?.notify_prefs, {}) };
}

/**
 * Create a notification for one user.
 * - never notifies the person who caused the change
 * - respects the recipient's per-type preference
 * - `dedupeKey` makes repeated alerts (e.g. nightly overdue sweeps) idempotent
 */
export function notify({
  userId,
  actorId = null,
  type,
  title,
  body = '',
  link = '',
  severity = 'info',
  dedupeKey = null,
}) {
  if (!userId) return null;
  if (actorId && Number(userId) === Number(actorId)) return null;

  const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(userId);
  if (!user || !user.is_active) return null;

  const prefKey = PREF_FOR_TYPE[type];
  if (prefKey && prefsFor(userId)[prefKey] === false) return null;

  try {
    const info = db
      .prepare(
        `INSERT INTO notifications (user_id, actor_id, type, title, body, link, severity, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, actorId, type, title, body, link, severity, dedupeKey);
    return info.lastInsertRowid;
  } catch (err) {
    // Unique index on (user_id, dedupe_key) — the alert already went out.
    if (String(err.message).includes('UNIQUE')) return null;
    throw err;
  }
}

export function notifyMany(userIds, payload) {
  const seen = new Set();
  for (const id of userIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    notify({ ...payload, userId: id });
  }
}

/** Everyone who should hear about a change to a task. */
export function taskAudience(taskId, { includeAssignee = true, includeReporter = true } = {}) {
  const task = db.prepare('SELECT assignee_id, reporter_id FROM tasks WHERE id = ?').get(taskId);
  if (!task) return [];
  const watchers = db.prepare('SELECT user_id FROM task_watchers WHERE task_id = ?').all(taskId).map((r) => r.user_id);
  const ids = [...watchers];
  if (includeAssignee) ids.push(task.assignee_id);
  if (includeReporter) ids.push(task.reporter_id);
  return [...new Set(ids.filter(Boolean))];
}

export function addWatcher(taskId, userId) {
  if (!userId) return;
  db.prepare('INSERT OR IGNORE INTO task_watchers (task_id, user_id) VALUES (?, ?)').run(taskId, userId);
}

/** Find @mentions in free text and resolve them to user ids. */
export function resolveMentions(text) {
  if (!text) return [];
  const handles = [...text.matchAll(/@([a-zA-Z0-9._-]{2,40})/g)].map((m) => m[1].toLowerCase());
  if (!handles.length) return [];
  const users = db.prepare('SELECT id, name, email FROM users WHERE is_active = 1').all();
  const matched = [];
  for (const handle of handles) {
    const hit = users.find(
      (u) =>
        u.email.split('@')[0].toLowerCase() === handle ||
        u.name.toLowerCase().replace(/\s+/g, '') === handle.replace(/[._-]/g, '') ||
        u.name.split(' ')[0].toLowerCase() === handle,
    );
    if (hit) matched.push(hit.id);
  }
  return [...new Set(matched)];
}
