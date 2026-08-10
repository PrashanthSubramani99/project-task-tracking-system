-- InfyTrack schema
-- Meetings -> Action items -> Tasks, plus docs, service/port registry,
-- activity trail, notifications and org/project permissions.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- users ----

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  email          TEXT    NOT NULL UNIQUE,
  password_hash  TEXT    NOT NULL,
  -- org role: admin | manager | member | viewer
  role           TEXT    NOT NULL DEFAULT 'member',
  title          TEXT    NOT NULL DEFAULT '',
  phone          TEXT    NOT NULL DEFAULT '',
  avatar_color   TEXT    NOT NULL DEFAULT '#6366f1',
  is_active      INTEGER NOT NULL DEFAULT 1,
  -- onboarding / user-journey progress, JSON object of completed step keys
  journey        TEXT    NOT NULL DEFAULT '{}',
  notify_prefs   TEXT    NOT NULL DEFAULT '{"assigned":true,"mentioned":true,"comment":true,"status":true,"due":true,"action_item":true}',
  last_seen_at   TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ------------------------------------------------------------- projects ----

CREATE TABLE IF NOT EXISTS projects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT    NOT NULL UNIQUE,          -- short prefix, e.g. "APP" -> APP-14
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  color        TEXT    NOT NULL DEFAULT '#6366f1',
  status       TEXT    NOT NULL DEFAULT 'active', -- active | on_hold | archived
  lead_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_date   TEXT,
  target_date  TEXT,
  seq          INTEGER NOT NULL DEFAULT 0,        -- last issued task number
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  -- project role: lead | member | viewer
  role        TEXT    NOT NULL DEFAULT 'member',
  added_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pm_user ON project_members(user_id);

-- ------------------------------------------------------------- meetings ----

CREATE TABLE IF NOT EXISTS meetings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  -- how the discussion happened: gmeet | whatsapp | call | in_person | other
  source       TEXT    NOT NULL DEFAULT 'gmeet',
  occurred_at  TEXT    NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 0,
  location     TEXT    NOT NULL DEFAULT '',
  summary      TEXT    NOT NULL DEFAULT '',
  raw_notes    TEXT    NOT NULL DEFAULT '',       -- pasted notes / WhatsApp dump
  decisions    TEXT    NOT NULL DEFAULT '',
  status       TEXT    NOT NULL DEFAULT 'draft',  -- draft | published
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meetings_project ON meetings(project_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS meeting_attendees (
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, user_id)
);

-- Raw action items captured from a discussion. They stay visible until they
-- are either converted into a task or explicitly dropped, so nothing is lost.
CREATE TABLE IF NOT EXISTS action_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text        TEXT    NOT NULL,
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date    TEXT,
  priority    TEXT    NOT NULL DEFAULT 'medium',
  -- open | converted | dropped
  status      TEXT    NOT NULL DEFAULT 'open',
  task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_meeting ON action_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_ai_status  ON action_items(status);

-- ---------------------------------------------------------------- tasks ----

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key           TEXT    NOT NULL UNIQUE,            -- APP-14
  number        INTEGER NOT NULL,
  title         TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  -- task | bug | improvement | action | doc
  type          TEXT    NOT NULL DEFAULT 'task',
  -- backlog | todo | in_progress | in_review | blocked | done | cancelled
  status        TEXT    NOT NULL DEFAULT 'todo',
  -- urgent | high | medium | low
  priority      TEXT    NOT NULL DEFAULT 'medium',
  assignee_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reporter_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date      TEXT,
  start_date    TEXT,
  estimate_h    REAL    NOT NULL DEFAULT 0,
  spent_h       REAL    NOT NULL DEFAULT 0,
  progress      INTEGER NOT NULL DEFAULT 0,          -- 0..100
  parent_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  meeting_id    INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
  labels        TEXT    NOT NULL DEFAULT '[]',       -- JSON array of strings
  position      REAL    NOT NULL DEFAULT 0,          -- board ordering within column
  blocked_reason TEXT   NOT NULL DEFAULT '',
  completed_at  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_project  ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_meeting  ON tasks(meeting_id);

CREATE TABLE IF NOT EXISTS task_watchers (
  task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at);

CREATE TABLE IF NOT EXISTS task_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label      TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------- docs ----

CREATE TABLE IF NOT EXISTS docs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  -- runbook | spec | how_to | decision | onboarding | other
  category    TEXT    NOT NULL DEFAULT 'other',
  body        TEXT    NOT NULL DEFAULT '',          -- markdown
  tags        TEXT    NOT NULL DEFAULT '[]',
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_docs_project ON docs(project_id, updated_at DESC);

-- Service / port registry: "which app runs on which port, where"
CREATE TABLE IF NOT EXISTS services (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  environment  TEXT    NOT NULL DEFAULT 'dev',      -- dev | staging | uat | prod
  host         TEXT    NOT NULL DEFAULT 'localhost',
  port         INTEGER,
  protocol     TEXT    NOT NULL DEFAULT 'http',
  url          TEXT    NOT NULL DEFAULT '',
  repo_url     TEXT    NOT NULL DEFAULT '',
  owner_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status       TEXT    NOT NULL DEFAULT 'up',       -- up | down | unknown | retired
  notes        TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_services_project ON services(project_id, environment);

-- ------------------------------------------------- activity + notify ----

CREATE TABLE IF NOT EXISTS activities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  entity_type  TEXT    NOT NULL,                    -- task | meeting | doc | service | project | user | action_item
  entity_id    INTEGER NOT NULL,
  entity_label TEXT    NOT NULL DEFAULT '',         -- e.g. "APP-14" for quick display
  actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT    NOT NULL,                    -- created | updated | commented | deleted | ...
  field        TEXT    NOT NULL DEFAULT '',
  old_value    TEXT    NOT NULL DEFAULT '',
  new_value    TEXT    NOT NULL DEFAULT '',
  summary      TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_act_entity  ON activities(entity_type, entity_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_act_project ON activities(project_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_act_actor   ON activities(actor_id, id DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- assigned | mentioned | comment | status | due_soon | overdue | action_item | project
  type        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL DEFAULT '',
  link        TEXT    NOT NULL DEFAULT '',
  severity    TEXT    NOT NULL DEFAULT 'info',      -- info | warning | critical
  dedupe_key  TEXT,
  read_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_dedupe ON notifications(user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
