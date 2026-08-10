/**
 * Demo data. Run with `npm run seed` (adds to an empty database) or
 * `npm run reset` (wipes first). Everything here is fictional.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db, initSchema, DB_FILE } from './db.js';
import { hashPassword } from './auth.js';
import { logActivity } from './activity.js';
import { notify } from './notify.js';
import { runDeadlineSweep } from './scheduler.js';

if (process.argv.includes('--reset')) {
  // The connection is already open on the old file, so drop it, delete, and
  // re-exec this script against a clean database.
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${DB_FILE}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  console.log('Removed the existing database.');
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

initSchema();

const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
if (count > 0) {
  console.log(`Database already has ${count} user(s). Use "npm run reset" to start over.`);
  process.exit(0);
}

const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const dateTime = (n, time = '10:00') => `${daysFromNow(n)} ${time}:00`;

// ------------------------------------------------------------------ users ---

const people = [
  ['Prashanth S',   'prashanth@example.com', 'admin',   'Engineering Lead',   '#6366f1'],
  ['Anita Rao',     'anita@example.com',     'manager', 'Product Manager',    '#ec4899'],
  ['Vikram Iyer',   'vikram@example.com',    'member',  'Backend Developer',  '#0ea5e9'],
  ['Sneha Menon',   'sneha@example.com',     'member',  'Frontend Developer', '#10b981'],
  ['Rahul Nair',    'rahul@example.com',     'member',  'QA Engineer',        '#f59e0b'],
  ['Divya Krishnan','divya@example.com',     'viewer',  'Business Analyst',   '#8b5cf6'],
];

const insertUser = db.prepare(
  `INSERT INTO users (name, email, password_hash, role, title, avatar_color) VALUES (?, ?, ?, ?, ?, ?)`,
);
const password = hashPassword('password123');
const users = {};
for (const [name, email, role, title, color] of people) {
  const info = insertUser.run(name, email, password, role, title, color);
  users[name.split(' ')[0].toLowerCase()] = { id: Number(info.lastInsertRowid), name, email };
}

// --------------------------------------------------------------- projects ---

const insertProject = db.prepare(
  `INSERT INTO projects (key, name, description, color, lead_id, start_date, target_date, created_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
const addMember = db.prepare('INSERT OR REPLACE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)');

const portalId = Number(
  insertProject.run(
    'PORTAL', 'Customer Portal',
    'Self-service portal for customers to raise and track service requests.',
    '#6366f1', users.prashanth.id, daysFromNow(-45), daysFromNow(40), users.prashanth.id,
  ).lastInsertRowid,
);
const opsId = Number(
  insertProject.run(
    'OPS', 'Internal Ops Tools',
    'Internal dashboards, deployment scripts and the shared staging environment.',
    '#0ea5e9', users.anita.id, daysFromNow(-90), daysFromNow(75), users.prashanth.id,
  ).lastInsertRowid,
);

addMember.run(portalId, users.prashanth.id, 'lead');
addMember.run(portalId, users.anita.id, 'member');
addMember.run(portalId, users.vikram.id, 'member');
addMember.run(portalId, users.sneha.id, 'member');
addMember.run(portalId, users.rahul.id, 'member');
addMember.run(portalId, users.divya.id, 'viewer');

addMember.run(opsId, users.anita.id, 'lead');
addMember.run(opsId, users.prashanth.id, 'member');
addMember.run(opsId, users.vikram.id, 'member');
addMember.run(opsId, users.rahul.id, 'member');

// --------------------------------------------------------------- meetings ---

const insertMeeting = db.prepare(
  `INSERT INTO meetings (project_id, title, source, occurred_at, duration_min, location, summary, raw_notes, decisions, status, created_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`,
);
const addAttendee = db.prepare('INSERT OR IGNORE INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)');
const insertAction = db.prepare(
  `INSERT INTO action_items (meeting_id, text, owner_id, due_date, priority, status, position)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);

const kickoffNotes = `Sprint 12 planning — Google Meet

Attendees: Prashanth, Anita, Vikram, Sneha, Rahul

Discussion:
- Login page is slow on first load, around 4 seconds on staging
- Customers are asking for a ticket status filter
- Staging keeps going down because two services fight over port 8080

Decisions:
- We ship the status filter this sprint, the redesign waits for next sprint
- Staging gets fixed ports, documented in the app

Action items:
- Vikram to profile the login endpoint and bring numbers by Friday
- Sneha will build the ticket status filter UI
- Rahul to write regression tests for the login flow before 25/12
- Anita to confirm the filter wording with two customers next week
- Someone needs to document all the service ports, urgent`;

const kickoffId = Number(
  insertMeeting.run(
    portalId, 'Sprint 12 planning', 'gmeet', dateTime(-9, '10:00'), 45, 'Google Meet',
    'Planned sprint 12. Agreed to ship the ticket status filter and fix the staging port clash.',
    kickoffNotes,
    'Ticket status filter ships this sprint. Portal redesign moves to sprint 13. Staging ports become fixed and documented.',
    users.prashanth.id,
  ).lastInsertRowid,
);
for (const key of ['prashanth', 'anita', 'vikram', 'sneha', 'rahul']) addAttendee.run(kickoffId, users[key].id);

const whatsappNotes = `[${daysFromNow(-3).split('-').reverse().join('/')}, 21:14] Anita: Guys quick one about tomorrow's demo
[${daysFromNow(-3).split('-').reverse().join('/')}, 21:15] Anita: client wants to see the export feature also
[${daysFromNow(-3).split('-').reverse().join('/')}, 21:16] Vikram: export is not done yet
[${daysFromNow(-3).split('-').reverse().join('/')}, 21:17] Vikram: I will finish the CSV export by tomorrow morning
[${daysFromNow(-3).split('-').reverse().join('/')}, 21:18] Sneha: ok I will add the download button on the reports page
[${daysFromNow(-3).split('-').reverse().join('/')}, 21:20] Anita: Rahul please test it once before the call
[${daysFromNow(-3).split('-').reverse().join('/')}, 21:21] Rahul: sure will do
[${daysFromNow(-3).split('-').reverse().join('/')}, 21:22] Anita: also someone share the staging URL with the client, urgent
[${daysFromNow(-3).split('-').reverse().join('/')}, 21:25] Prashanth: 👍
[${daysFromNow(-3).split('-').reverse().join('/')}, 21:26] Prashanth: I will send the staging link tomorrow`;

const demoId = Number(
  insertMeeting.run(
    portalId, 'Pre-demo sync (WhatsApp group)', 'whatsapp', dateTime(-3, '21:14'), 0, 'WhatsApp group',
    'Last-minute alignment before the client demo. Export feature was added to scope.',
    whatsappNotes,
    'Export lands before the demo. Rahul signs off on it first.',
    users.anita.id,
  ).lastInsertRowid,
);
for (const key of ['prashanth', 'anita', 'vikram', 'sneha', 'rahul']) addAttendee.run(demoId, users[key].id);

const opsNotes = `Ops catch-up — office, 30 mins

- Deployment script fails silently when the disk is full. Vikram to add a check.
- We still don't know which port the reporting service uses in UAT. Prashanth to document all ports by end of week.
- Rahul will set up a weekly smoke test run every Monday.
- Discuss backup retention next month.`;

const opsMeetingId = Number(
  insertMeeting.run(
    opsId, 'Ops catch-up', 'in_person', dateTime(-6, '15:30'), 30, 'Office, meeting room 2',
    'Reviewed deployment reliability and the missing port documentation.',
    opsNotes,
    'Port registry becomes the single source of truth for every environment.',
    users.anita.id,
  ).lastInsertRowid,
);
for (const key of ['prashanth', 'anita', 'vikram', 'rahul']) addAttendee.run(opsMeetingId, users[key].id);

// Action items: a mix of converted, still open, and deliberately overdue so
// the alerting and the "nothing dropped" screens have something to show.
const actionRows = [
  [kickoffId, 'Profile the login endpoint and bring numbers', users.vikram.id, daysFromNow(-4), 'high', 'converted', 0],
  [kickoffId, 'Build the ticket status filter UI', users.sneha.id, daysFromNow(3), 'high', 'converted', 1],
  [kickoffId, 'Write regression tests for the login flow', users.rahul.id, daysFromNow(-1), 'medium', 'converted', 2],
  [kickoffId, 'Confirm the filter wording with two customers', users.anita.id, daysFromNow(2), 'medium', 'open', 3],
  [kickoffId, 'Document all the service ports', null, daysFromNow(-2), 'urgent', 'open', 4],
  [demoId, 'Finish the CSV export', users.vikram.id, daysFromNow(-2), 'urgent', 'converted', 0],
  [demoId, 'Add the download button on the reports page', users.sneha.id, daysFromNow(-2), 'high', 'open', 1],
  [demoId, 'Test the export before the client call', users.rahul.id, daysFromNow(-2), 'high', 'open', 2],
  [demoId, 'Share the staging URL with the client', users.prashanth.id, daysFromNow(-2), 'urgent', 'open', 3],
  [opsMeetingId, 'Add a disk space check to the deployment script', users.vikram.id, daysFromNow(5), 'medium', 'converted', 0],
  [opsMeetingId, 'Document all ports for every environment', users.prashanth.id, daysFromNow(1), 'high', 'open', 1],
  [opsMeetingId, 'Set up a weekly smoke test run', users.rahul.id, daysFromNow(9), 'low', 'open', 2],
];
const actionIds = actionRows.map((row) => Number(insertAction.run(...row).lastInsertRowid));

// ------------------------------------------------------------------ tasks ---

const insertTask = db.prepare(
  `INSERT INTO tasks
     (project_id, key, number, title, description, type, status, priority, assignee_id, reporter_id,
      due_date, estimate_h, spent_h, progress, meeting_id, labels, position, completed_at, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const addWatcher = db.prepare('INSERT OR IGNORE INTO task_watchers (task_id, user_id) VALUES (?, ?)');

const seq = { [portalId]: 0, [opsId]: 0 };
const projectKey = { [portalId]: 'PORTAL', [opsId]: 'OPS' };

function makeTask(projectId, t) {
  const number = ++seq[projectId];
  const key = `${projectKey[projectId]}-${number}`;
  const id = Number(
    insertTask.run(
      projectId, key, number, t.title, t.description || '', t.type || 'task', t.status || 'todo',
      t.priority || 'medium', t.assignee_id || null, t.reporter_id || users.prashanth.id,
      t.due_date || null, t.estimate_h || 0, t.spent_h || 0,
      t.progress ?? ({ done: 100, in_progress: 50, in_review: 80 }[t.status] ?? 0),
      t.meeting_id || null, JSON.stringify(t.labels || []), number,
      t.status === 'done' ? `${daysFromNow(t.completed_offset ?? -1)} 16:00:00` : null,
      `${daysFromNow(t.created_offset ?? -10)} 09:00:00`,
    ).lastInsertRowid,
  );
  addWatcher.run(id, t.reporter_id || users.prashanth.id);
  if (t.assignee_id) addWatcher.run(id, t.assignee_id);
  logActivity({
    projectId, entityType: 'task', entityId: id, entityLabel: key,
    actorId: t.reporter_id || users.prashanth.id, action: 'created',
    summary: `created ${key} — ${t.title}`,
  });
  return { id, key };
}

const portalTasks = [
  { title: 'Profile the login endpoint and bring numbers', type: 'action', status: 'done', priority: 'high',
    assignee_id: users.vikram.id, due_date: daysFromNow(-4), estimate_h: 6, spent_h: 5, meeting_id: kickoffId,
    labels: ['from-meeting', 'performance'], created_offset: -9, completed_offset: -5,
    description: 'From “Sprint 12 planning”. Login takes ~4s on staging first load.' },
  { title: 'Build the ticket status filter UI', type: 'action', status: 'in_progress', priority: 'high',
    assignee_id: users.sneha.id, due_date: daysFromNow(3), estimate_h: 12, spent_h: 7, meeting_id: kickoffId,
    labels: ['from-meeting', 'frontend'], created_offset: -9 },
  { title: 'Write regression tests for the login flow', type: 'action', status: 'in_review', priority: 'medium',
    assignee_id: users.rahul.id, due_date: daysFromNow(-1), estimate_h: 8, spent_h: 8, meeting_id: kickoffId,
    labels: ['from-meeting', 'qa'], created_offset: -9 },
  { title: 'Finish the CSV export', type: 'action', status: 'in_progress', priority: 'urgent',
    assignee_id: users.vikram.id, due_date: daysFromNow(-2), estimate_h: 10, spent_h: 9, meeting_id: demoId,
    labels: ['from-meeting', 'reports'], created_offset: -3 },
  { title: 'Add a database index on tickets.created_at', type: 'improvement', status: 'done', priority: 'medium',
    assignee_id: users.vikram.id, estimate_h: 2, spent_h: 1.5, labels: ['performance'],
    created_offset: -20, completed_offset: -14 },
  { title: 'Ticket list pagination breaks past page 10', type: 'bug', status: 'blocked', priority: 'high',
    assignee_id: users.sneha.id, due_date: daysFromNow(4), estimate_h: 4, spent_h: 1,
    labels: ['frontend', 'bug'], created_offset: -12,
    description: 'Blocked: waiting on the API to return a stable total count.' },
  { title: 'Email notification on ticket status change', status: 'todo', priority: 'medium',
    assignee_id: users.vikram.id, due_date: daysFromNow(11), estimate_h: 8, created_offset: -7 },
  { title: 'Portal redesign — discovery', status: 'backlog', priority: 'low',
    assignee_id: users.anita.id, estimate_h: 16, labels: ['design'], created_offset: -30 },
  { title: 'Attachment upload fails for files over 5 MB', type: 'bug', status: 'todo', priority: 'urgent',
    assignee_id: users.rahul.id, due_date: daysFromNow(1), estimate_h: 5, labels: ['bug'], created_offset: -5 },
  { title: 'Write the customer-facing release note for sprint 12', type: 'doc', status: 'todo', priority: 'low',
    assignee_id: null, due_date: daysFromNow(8), estimate_h: 3, created_offset: -2 },
  { title: 'Session expires without warning after 30 minutes', type: 'bug', status: 'todo', priority: 'medium',
    assignee_id: users.sneha.id, due_date: daysFromNow(-3), estimate_h: 4, labels: ['bug', 'frontend'],
    created_offset: -18 },
  { title: 'Set up error tracking for the portal frontend', status: 'done', priority: 'medium',
    assignee_id: users.sneha.id, estimate_h: 4, spent_h: 3, created_offset: -25, completed_offset: -20 },
];

const opsTasks = [
  { title: 'Add a disk space check to the deployment script', type: 'action', status: 'todo', priority: 'medium',
    assignee_id: users.vikram.id, due_date: daysFromNow(5), estimate_h: 3, meeting_id: opsMeetingId,
    labels: ['from-meeting', 'devops'], reporter_id: users.anita.id, created_offset: -6 },
  { title: 'Fix the port clash between the API and the reporting service on staging', status: 'in_progress',
    priority: 'urgent', assignee_id: users.prashanth.id, due_date: daysFromNow(0), estimate_h: 4, spent_h: 2,
    labels: ['devops', 'staging'], reporter_id: users.anita.id, created_offset: -8 },
  { title: 'Weekly smoke test job', status: 'backlog', priority: 'low', assignee_id: users.rahul.id,
    estimate_h: 6, reporter_id: users.anita.id, created_offset: -6 },
  { title: 'Rotate the staging database credentials', status: 'done', priority: 'high',
    assignee_id: users.prashanth.id, estimate_h: 2, spent_h: 2, reporter_id: users.anita.id,
    created_offset: -22, completed_offset: -19 },
  { title: 'Nightly backup job silently skipped on 3 nights', type: 'bug', status: 'in_review', priority: 'urgent',
    assignee_id: users.vikram.id, due_date: daysFromNow(2), estimate_h: 6, spent_h: 5,
    labels: ['bug', 'devops'], reporter_id: users.anita.id, created_offset: -11 },
];

const createdPortal = portalTasks.map((t) => makeTask(portalId, t));
const createdOps = opsTasks.map((t) => makeTask(opsId, t));

db.prepare('UPDATE projects SET seq = ? WHERE id = ?').run(seq[portalId], portalId);
db.prepare('UPDATE projects SET seq = ? WHERE id = ?').run(seq[opsId], opsId);

// Wire the converted action items to the tasks they became.
const linkAction = db.prepare('UPDATE action_items SET task_id = ? WHERE id = ?');
linkAction.run(createdPortal[0].id, actionIds[0]);
linkAction.run(createdPortal[1].id, actionIds[1]);
linkAction.run(createdPortal[2].id, actionIds[2]);
linkAction.run(createdPortal[3].id, actionIds[5]);
linkAction.run(createdOps[0].id, actionIds[9]);

// --------------------------------------------------------------- comments ---

const insertComment = db.prepare('INSERT INTO comments (task_id, author_id, body, created_at) VALUES (?, ?, ?, ?)');
insertComment.run(createdPortal[0].id, users.vikram.id,
  'Profiled it. 3.2s of the 4s is a missing index on the sessions table. Raising a follow-up.', `${daysFromNow(-6)} 11:20:00`);
insertComment.run(createdPortal[0].id, users.prashanth.id,
  'Good find. Let us fold that into the performance work rather than a new ticket.', `${daysFromNow(-6)} 12:05:00`);
insertComment.run(createdPortal[3].id, users.anita.id,
  '@vikram the client asked about this again on the call. Any update?', `${daysFromNow(-1)} 09:30:00`);
insertComment.run(createdPortal[5].id, users.sneha.id,
  'Blocked until the API returns a stable total count — cannot page reliably without it.', `${daysFromNow(-4)} 15:10:00`);
insertComment.run(createdOps[1].id, users.prashanth.id,
  'Assigning fixed ports: API 8080, reporting 8090. Adding both to the service registry.', `${daysFromNow(-2)} 10:00:00`);

// ------------------------------------------------------------------- docs ---

const insertDoc = db.prepare(
  `INSERT INTO docs (project_id, title, category, body, tags, pinned, created_by, updated_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

insertDoc.run(
  opsId, 'Environment and port map', 'runbook',
  `# Environment and port map

The service registry is the source of truth — this page explains the conventions behind it.

## Port ranges

| Range | Used for |
| --- | --- |
| 3000-3099 | Frontend apps |
| 8080-8099 | Backend APIs |
| 5432 | PostgreSQL |
| 6379 | Redis |

## Rules

1. Every service gets a fixed port per environment. No dynamic ports.
2. Register the port here **before** you deploy, not after.
3. If two services need the same port, the older registration wins.

## Staging access

Ask an administrator for VPN access first. Staging is not reachable from the public internet.`,
  JSON.stringify(['ports', 'environments', 'runbook']), 1, users.prashanth.id, users.prashanth.id,
);

insertDoc.run(
  portalId, 'How we run a requirement discussion', 'how_to',
  `# How we run a requirement discussion

We lose action items when they only live in a WhatsApp thread. This is the routine that stops that.

## During the discussion

Somebody is the note taker. Type freely — bullets are enough.

## Straight after

1. Open **Discussions → Log a discussion**.
2. Paste the raw notes (a WhatsApp export works as-is).
3. Hit **Find action items**. Check the owner and date on each suggested row.
4. Save, then convert the items that are ready into tasks.

## The rule

An action item without an owner and a date is not an action item. If nobody
picks it up in the discussion, it goes to the project lead by default.`,
  JSON.stringify(['process', 'meetings']), 1, users.anita.id, users.anita.id,
);

insertDoc.run(
  portalId, 'Portal API — authentication', 'spec',
  `# Portal API — authentication

Bearer tokens, 30 day expiry, issued at \`POST /api/auth/login\`.

- Send the token as \`Authorization: Bearer <token>\`.
- A 401 means the token expired; sign in again.
- A 403 means the account is deactivated or lacks permission for that project.`,
  JSON.stringify(['api', 'auth']), 0, users.vikram.id, users.vikram.id,
);

insertDoc.run(
  opsId, 'New joiner setup', 'onboarding',
  `# New joiner setup

1. Get your account from an administrator.
2. Install Node 20+ and SQLite.
3. Clone the repo, \`npm install\` in both \`server/\` and \`client/\`.
4. \`npm run seed\` in \`server/\` for demo data.
5. Read **Environment and port map** before you start anything locally.`,
  JSON.stringify(['onboarding']), 0, users.anita.id, users.anita.id,
);

// --------------------------------------------------------------- services ---

const insertService = db.prepare(
  `INSERT INTO services (project_id, name, environment, host, port, protocol, url, repo_url, owner_id, status, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const serviceRows = [
  [portalId, 'Portal frontend', 'dev', 'localhost', 3000, 'http', '', '', users.sneha.id, 'up', 'Vite dev server.'],
  [portalId, 'Portal frontend', 'staging', 'staging.internal', 3000, 'https', 'https://portal-staging.internal', '', users.sneha.id, 'up', ''],
  [portalId, 'Portal frontend', 'prod', 'portal.example.com', 443, 'https', 'https://portal.example.com', '', users.sneha.id, 'up', 'Behind the load balancer.'],
  [portalId, 'Portal API', 'dev', 'localhost', 8080, 'http', '', '', users.vikram.id, 'up', ''],
  [portalId, 'Portal API', 'staging', 'staging.internal', 8080, 'http', '', '', users.vikram.id, 'up', 'Fixed port as of sprint 12.'],
  [portalId, 'Portal API', 'prod', 'api.example.com', 443, 'https', 'https://api.example.com', '', users.vikram.id, 'up', ''],
  [opsId, 'Reporting service', 'dev', 'localhost', 8090, 'http', '', '', users.prashanth.id, 'up', 'Moved off 8080 to stop the clash.'],
  [opsId, 'Reporting service', 'staging', 'staging.internal', 8090, 'http', '', '', users.prashanth.id, 'up', ''],
  [opsId, 'Reporting service', 'uat', 'uat.internal', 8090, 'http', '', '', users.prashanth.id, 'unknown', 'Nobody has confirmed this one yet.'],
  [opsId, 'PostgreSQL', 'dev', 'localhost', 5432, 'tcp', '', '', users.vikram.id, 'up', 'Database name: portal_dev'],
  [opsId, 'PostgreSQL', 'staging', 'db.staging.internal', 5432, 'tcp', '', '', users.vikram.id, 'up', ''],
  [opsId, 'Redis cache', 'dev', 'localhost', 6379, 'tcp', '', '', users.vikram.id, 'down', 'Optional locally.'],
  [opsId, 'Legacy admin panel', 'prod', 'admin.example.com', 8081, 'https', '', '', users.anita.id, 'retired', 'Decommissioned, kept for reference.'],
];
for (const row of serviceRows) insertService.run(...row);

// -------------------------------------------------------------- activity ---

logActivity({
  projectId: portalId, entityType: 'meeting', entityId: kickoffId, entityLabel: 'Sprint 12 planning',
  actorId: users.prashanth.id, action: 'created', summary: 'logged a Google Meet discussion — Sprint 12 planning',
});
logActivity({
  projectId: portalId, entityType: 'meeting', entityId: demoId, entityLabel: 'Pre-demo sync (WhatsApp group)',
  actorId: users.anita.id, action: 'created', summary: 'logged a WhatsApp discussion — Pre-demo sync',
});
logActivity({
  projectId: opsId, entityType: 'meeting', entityId: opsMeetingId, entityLabel: 'Ops catch-up',
  actorId: users.anita.id, action: 'created', summary: 'logged an In person discussion — Ops catch-up',
});
logActivity({
  projectId: portalId, entityType: 'task', entityId: createdPortal[0].id, entityLabel: createdPortal[0].key,
  actorId: users.vikram.id, action: 'updated', field: 'status', oldValue: 'in_progress', newValue: 'done',
  summary: 'changed status from in_progress to done',
});
logActivity({
  projectId: opsId, entityType: 'service', entityId: 7, entityLabel: 'Reporting service',
  actorId: users.prashanth.id, action: 'created', summary: 'registered Reporting service on localhost:8090 (dev)',
});

// ---------------------------------------------------------- notifications ---

notify({
  userId: users.sneha.id, actorId: users.anita.id, type: 'comment',
  title: `New comment on ${createdPortal[3].key}`,
  body: 'Anita Rao: the client asked about this again on the call.',
  link: `/tasks/${createdPortal[3].id}`,
});
notify({
  userId: users.vikram.id, actorId: users.anita.id, type: 'mentioned',
  title: `Anita Rao mentioned you on ${createdPortal[3].key}`,
  body: '@vikram the client asked about this again on the call. Any update?',
  link: `/tasks/${createdPortal[3].id}`,
});

// Let the real sweep generate the overdue and due-soon alerts.
const sweep = runDeadlineSweep();

console.log(`Seeded ${people.length} users, 2 projects, 3 discussions, ${createdPortal.length + createdOps.length} tasks,`);
console.log(`4 documents, ${serviceRows.length} registered services and ${sweep.created} deadline alerts.`);
console.log('\nSign in with any of these (password: password123):');
for (const [name, email, role] of people) console.log(`  ${email.padEnd(26)} ${role.padEnd(8)} ${name}`);
