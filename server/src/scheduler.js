import { db } from './db.js';
import { notify } from './notify.js';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Deadline sweep. Runs on an interval and on boot.
 *
 * Every alert carries a dedupe key that includes the date, so a task that is
 * overdue for a week produces one alert per day rather than one per tick.
 */
export function runDeadlineSweep() {
  const stamp = today();
  let created = 0;

  const dueSoon = db
    .prepare(
      `SELECT t.id, t.key, t.title, t.due_date, t.priority, t.assignee_id, p.name AS project_name
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.status NOT IN ('done','cancelled')
          AND t.assignee_id IS NOT NULL
          AND t.due_date IS NOT NULL
          AND t.due_date BETWEEN date('now') AND date('now', '+2 days')`,
    )
    .all();

  for (const task of dueSoon) {
    const when = task.due_date === stamp ? 'today' : `on ${task.due_date}`;
    const id = notify({
      userId: task.assignee_id,
      type: 'due_soon',
      title: `${task.key} is due ${when}`,
      body: `“${task.title}” in ${task.project_name}.`,
      link: `/tasks/${task.id}`,
      severity: task.priority === 'urgent' ? 'critical' : 'warning',
      dedupeKey: `due_soon:${task.id}:${stamp}`,
    });
    if (id) created += 1;
  }

  const overdue = db
    .prepare(
      `SELECT t.id, t.key, t.title, t.due_date, t.assignee_id, p.name AS project_name,
              p.lead_id, CAST(julianday('now') - julianday(t.due_date) AS INTEGER) AS days_late
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.status NOT IN ('done','cancelled')
          AND t.due_date IS NOT NULL AND t.due_date < date('now')`,
    )
    .all();

  for (const task of overdue) {
    if (task.assignee_id) {
      const id = notify({
        userId: task.assignee_id,
        type: 'overdue',
        title: `${task.key} is ${task.days_late} day(s) overdue`,
        body: `“${task.title}” was due ${task.due_date}.`,
        link: `/tasks/${task.id}`,
        severity: 'critical',
        dedupeKey: `overdue:${task.id}:${stamp}`,
      });
      if (id) created += 1;
    }
    // Escalate to the project lead once a task is a week late.
    if (task.days_late >= 7 && task.lead_id && task.lead_id !== task.assignee_id) {
      const id = notify({
        userId: task.lead_id,
        type: 'overdue',
        title: `${task.key} is ${task.days_late} days overdue`,
        body: `“${task.title}” in ${task.project_name} needs attention.`,
        link: `/tasks/${task.id}`,
        severity: 'critical',
        dedupeKey: `overdue_lead:${task.id}:${stamp}`,
      });
      if (id) created += 1;
    }
  }

  // Action items that were never turned into tasks and are past their date —
  // exactly the "we missed an action item" case this app exists to prevent.
  const staleActions = db
    .prepare(
      `SELECT ai.id, ai.text, ai.owner_id, ai.due_date, m.id AS meeting_id, m.title AS meeting_title
         FROM action_items ai JOIN meetings m ON m.id = ai.meeting_id
        WHERE ai.status = 'open' AND ai.owner_id IS NOT NULL
          AND ai.due_date IS NOT NULL AND ai.due_date < date('now')`,
    )
    .all();

  for (const item of staleActions) {
    const id = notify({
      userId: item.owner_id,
      type: 'overdue',
      title: 'An action item is past its date',
      body: `${item.text} — from “${item.meeting_title}”, due ${item.due_date}.`,
      link: `/meetings/${item.meeting_id}`,
      severity: 'warning',
      dedupeKey: `action_overdue:${item.id}:${stamp}`,
    });
    if (id) created += 1;
  }

  // Action items nobody owns, a week after the discussion.
  const orphaned = db
    .prepare(
      `SELECT ai.id, ai.text, m.id AS meeting_id, m.title AS meeting_title, m.project_id, p.lead_id
         FROM action_items ai
         JOIN meetings m ON m.id = ai.meeting_id
         JOIN projects p ON p.id = m.project_id
        WHERE ai.status = 'open' AND ai.owner_id IS NULL
          AND m.occurred_at < datetime('now', '-7 days')`,
    )
    .all();

  for (const item of orphaned) {
    if (!item.lead_id) continue;
    const id = notify({
      userId: item.lead_id,
      type: 'action_item',
      title: 'An action item still has no owner',
      body: `${item.text} — from “${item.meeting_title}”.`,
      link: `/meetings/${item.meeting_id}`,
      severity: 'warning',
      dedupeKey: `orphan_action:${item.id}:${stamp}`,
    });
    if (id) created += 1;
  }

  return { created, scanned: dueSoon.length + overdue.length + staleActions.length + orphaned.length };
}

export function startScheduler({ intervalMinutes = 30 } = {}) {
  const tick = () => {
    try {
      const result = runDeadlineSweep();
      if (result.created) console.log(`[scheduler] raised ${result.created} deadline alert(s)`);
    } catch (err) {
      console.error('[scheduler] sweep failed:', err.message);
    }
  };
  // Give the process a moment to finish booting before the first sweep.
  setTimeout(tick, 5_000);
  const timer = setInterval(tick, intervalMinutes * 60_000);
  timer.unref?.();
  return timer;
}
