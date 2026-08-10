# InfyTrack

A task tracker built around the way a small team actually works: you talk on
Google Meet, on a WhatsApp call, or across a desk — and then the things people
agreed to do quietly disappear into a chat thread.

InfyTrack closes that gap. You paste the raw notes, it pulls out the action
items with an owner and a date, and one click turns them into tracked tasks
that show up on a board, in reports, and in people's notifications.

```
Discussion  →  Action items  →  Tasks  →  Board / Reports
 (paste)       (owner + date)   (tracked)  (progress + alerts)
```

---

## Running it

Requires **Node 22 or 24**. Nothing else — the database is a file, and no
compiler is needed: `better-sqlite3` ships prebuilt binaries for those two
versions on Windows, macOS and Linux.

Node 20 is not supported. It works, but no prebuilt binary exists for it, so
installing would try to compile SQLite from source and fail unless you have a
full C++ toolchain.

```bash
npm run setup     # installs server and client dependencies
npm run seed      # optional: realistic demo data
npm run dev       # API on :4000, app on :5173  <- open this one
```

Sign in with any seeded account, password `password123`:

| Email | Access level |
| --- | --- |
| `prashanth@example.com` | Administrator |
| `anita@example.com` | Manager |
| `vikram@example.com` | Team member |
| `divya@example.com` | Viewer (read only) |

**Starting empty instead:** skip `npm run seed`. The first visit shows a setup
screen that creates your administrator account and first project.

### Production-style single process

```bash
npm run build     # builds the client
npm start         # one server on :4000 serving the API and the app
```

Useful environment variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4000` | API / app port |
| `DB_FILE` | `server/data/infytrack.db` | SQLite file location |
| `JWT_SECRET` | dev fallback | **Set this in production** |
| `TOKEN_TTL` | `30d` | How long a sign-in lasts |
| `SWEEP_INTERVAL_MIN` | `30` | How often deadline alerts are checked |

Other commands: `npm test` (30 tests), `npm run reset` (wipe and re-seed).

---

## What it does

### Discussions → action items

Log a discussion from a Google Meet, a WhatsApp thread, a phone call or an
in-person meetup. Paste the notes in whatever shape they arrived — a bullet
list, a rambling paragraph, or a raw WhatsApp export with the
`[10/08/2026, 21:14] Anita:` prefixes still attached.

Press **Find action items** and the parser reads the notes for commitments:

- **Owner** — from `@handles`, from a name in the sentence, or from the speaker
  when somebody volunteered ("I will send the link tomorrow").
- **Due date** — from "by Friday", "tomorrow", "end of week", "before 15/04",
  "in 3 days", "next week", or an explicit date.
- **Priority** — "urgent", "asap" and "blocker" mean urgent; "nice to have"
  means low.
- **Confidence** — each row is scored, and low-confidence rows are flagged so
  you glance at them before saving.

Everything comes back as editable rows. Nothing is saved until you say so, so a
false positive costs one click to remove. Chat noise ("ok", "thanks", 👍,
`<Media omitted>`) is dropped, and repeated lines are de-duplicated.

The raw notes are always kept alongside the summary, so nothing is lost in the
tidying up.

### Nothing gets missed

The **Action items** screen lists every commitment across every project that
has not yet become tracked work. It calls out the two failure modes explicitly:
items past their date, and items with nobody on the hook. Select any number of
them and convert them into tasks in one go — each task keeps a link back to the
discussion it came from.

A background sweep raises alerts on a schedule:

- due within two days, and every day a task stays overdue
- a task a week late is escalated to the project lead
- an action item past its date, or still unowned a week after the discussion

Alerts are deduplicated per day, so an overdue task nudges you once a day
rather than every half hour.

### Tasks and the board

Jira-shaped without the weight: per-project keys (`PORTAL-14`), seven statuses,
four priorities, subtasks, labels, estimates, comments with `@mentions`,
watchers, and links.

- **Board** — drag between columns; the move is optimistic, and everyone
  watching is told.
- **List** — filter by project, status, priority, assignee, "open only",
  "overdue", and free text; then bulk-assign or bulk-transition the selection.
- **Task detail** — every property is editable inline, with a full history of
  what changed, who changed it, and what the value was before.

### Documentation and the port registry

Two separate things, deliberately:

- **Documentation** — markdown pages for runbooks, specs, decisions, how-tos
  and onboarding, with templates to get past the blank page.
- **Ports & services** — a structured registry of every app, database and
  cache, per environment, with host, port, owner and status. It detects when
  two live services claim the same `host:port` in the same environment and
  warns you at the top of the page, because that is the bug that eats an
  afternoon.

### Dashboard and reports

The dashboard answers "what do I owe today" first, then "how is the team
doing". Reports cover throughput (created vs completed by week), cycle time,
workload per person, how long open work has been sitting, an action-item funnel
showing what fraction of agreements became real work, and a list of everything
overdue. CSV export and a print stylesheet are both there.

### Permissions

Two layers, because a small team still needs a client who can look but not
touch:

**Workspace role** — Administrator, Manager, Team member, Viewer.
**Project role** — Lead, Member, Viewer, set per project.

An admin is a lead everywhere without being added to anything. A non-member
cannot see a project at all. A workspace-level viewer stays read-only no matter
how generous a project role they are given. The UI hides controls a user cannot
use, and the API enforces the same matrix independently — the client is a
convenience, not the gate.

Deactivating someone blocks sign-in but keeps their comments, tasks and history
intact.

### Activity and notifications

Every change writes an activity row with the field, the old value and the new
value. The log is filterable by project, person and entity type, and the same
trail appears inline on each task, discussion and document.

Notifications reach the assignee, the watchers and anyone `@mentioned`, and
every type can be switched off individually in Settings.

### User journey

New accounts get a five-step checklist on the dashboard — log a discussion,
convert action items, move a card, write a doc, invite the team. Steps tick
themselves off as you actually do them, and the card disappears when it is
finished.

---

## How it is built

```
server/
  src/
    index.js         Express app; also serves the built client
    schema.sql       Full database schema
    db.js            SQLite connection and helpers
    auth.js          JWT, password hashing, request authentication
    permissions.js   Capability matrix, project roles, visibility
    parser.js        Action-item extraction from raw notes
    activity.js      Change logging and field diffing
    notify.js        Notification fan-out, preferences, mentions
    scheduler.js     Deadline and orphaned-action-item sweep
    seed.js          Demo data
    routes/          auth, users, projects, tasks, meetings, docs,
                     services, notifications, activity, reports
  test/              Parser and permission tests
client/
  src/
    store.jsx        Auth, workspace data, notifications, toasts
    api.js           Fetch wrapper with bearer auth
    hooks.js         useFetch, useDebounced, useLocalState
    styles.css       Design tokens and the whole stylesheet
    components/      Layout, UI primitives, icons, task modal
    pages/           One file per screen
```

**Stack:** Express + better-sqlite3 on the server; React 18 + Vite + React
Router on the client. No CSS framework, no component library, no ORM, no icon
package — the dependency list is short on purpose so this stays easy to run and
easy to change.

**Data:** one SQLite file. Back it up by copying it. Foreign keys are on and
WAL mode is enabled.

### API sketch

All endpoints live under `/api` and need `Authorization: Bearer <token>` except
`/api/auth/*` and `/api/health`.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/login`, `POST /auth/setup`, `GET /auth/me`, `PATCH /auth/me` |
| Tasks | `GET /tasks`, `GET /tasks/board`, `GET /tasks/:id`, `POST /tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/move`, `POST /tasks/bulk`, comments, watchers, links |
| Discussions | `GET /meetings`, `POST /meetings`, `POST /meetings/parse`, `GET /meetings/action-items`, `POST /meetings/:id/convert` |
| Knowledge | `/docs`, `/services` |
| Insight | `/reports/dashboard`, `/reports/summary`, `/reports/export`, `/activity` |
| Admin | `/users`, `/projects`, `/projects/:id/members`, `POST /admin/sweep` |

`POST /meetings/parse` is a dry run — it returns extracted action items and
writes nothing, which is what lets the capture screen preview them.

---

## If the install fails

Almost every install problem is the same one: `better-sqlite3` is a native
module, and if npm cannot find a prebuilt binary for your exact Node version
and platform, it falls back to compiling from source with `node-gyp`. On
Windows that needs Visual Studio with the "Desktop development with C++"
workload, which most people do not have.

You will recognise it by these lines:

```
prebuild-install warn install No prebuilt binaries found (target=... platform=win32)
gyp ERR! find VS  You need to install the latest version of Visual Studio
```

**The fix is a supported Node version, not a compiler.** Check with `node -v`
and switch to Node 22 or 24:

```bash
nvm install 22 && nvm use 22        # nvm-windows: nvm install 22 && nvm use 22
```

Then clear the half-finished install and try again:

```bash
rm -rf server/node_modules server/package-lock.json    # Windows: rmdir /s /q server\node_modules
npm run setup
```

On Windows, if `npm` reports `EPERM: operation not permitted, rmdir`, something
is holding those files — close any editor, terminal or antivirus scan pointed
at the folder, then delete `server\node_modules` and retry.

Installing a C++ toolchain also works, but it is a much bigger detour than
changing Node version.

## Notes and limits

- **Notifications are in-app.** Email, WhatsApp and push are not wired up. The
  `notify()` function in `server/src/notify.js` is the single place every alert
  passes through, so adding a channel means adding one call there.
- **The parser is heuristic, not a language model.** It is tuned to be roughly
  right and always reviewable rather than clever and silent. It handles English
  notes; the phrase lists in `parser.js` are plain arrays if you want to extend
  them.
- **SQLite suits a small team well** — a handful of people and tens of
  thousands of tasks is comfortable. A larger deployment would want Postgres;
  the queries are plain SQL and the schema ports directly.
- **Notification polling is a 45-second interval**, not a websocket. Fine at
  this size, and one fewer moving part.
- **Set `JWT_SECRET`** before putting this anywhere real. The default is a
  development placeholder, and tokens signed with it are forgeable.
