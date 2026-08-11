import express from 'express';
import { db } from '../db.js';
import { logActivity, logChanges } from '../activity.js';
import { can, requireCap, visibleProjectIds } from '../permissions.js';
import { parsePagination } from '../paginate.js';

const router = express.Router();

const ENVIRONMENTS = ['dev', 'staging', 'uat', 'prod'];
const STATUSES = ['up', 'down', 'unknown', 'retired'];

const SERVICE_SELECT = `
  SELECT s.*, p.key AS project_key, p.name AS project_name, p.color AS project_color,
         u.name AS owner_name, u.avatar_color AS owner_color
    FROM services s
    LEFT JOIN projects p ON p.id = s.project_id
    LEFT JOIN users u ON u.id = s.owner_id`;

const serviceProjectId = (req) => {
  if (req.body?.project_id) return Number(req.body.project_id);
  const row = db.prepare('SELECT project_id FROM services WHERE id = ?').get(req.params.id);
  return row ? row.project_id : null;
};

/** Build the browsable URL when nobody typed one in. */
const derivedUrl = (row) =>
  row.url || (row.port ? `${row.protocol}://${row.host}:${row.port}` : `${row.protocol}://${row.host}`);

router.get('/', (req, res) => {
  const ids = visibleProjectIds(req.user);
  if (!ids.length) {
    const { page, limit } = parsePagination(req.query);
    return res.json({ services: [], conflicts: [], total: 0, page, limit });
  }

  const where = [`s.project_id IN (${ids.map(() => '?').join(',')})`];
  const params = [...ids];
  if (req.query.project_id) {
    where.push('s.project_id = ?');
    params.push(req.query.project_id);
  }
  if (req.query.environment) {
    where.push('s.environment = ?');
    params.push(req.query.environment);
  }
  if (req.query.q) {
    where.push('(s.name LIKE ? OR s.host LIKE ? OR s.notes LIKE ? OR CAST(s.port AS TEXT) LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like, like, like);
  }

  const { limit, offset, page } = parsePagination(req.query);
  const clause = `WHERE ${where.join(' AND ')}`;
  const services = db
    .prepare(
      `${SERVICE_SELECT} ${clause}
        ORDER BY CASE s.environment ${ENVIRONMENTS.map((e, i) => `WHEN '${e}' THEN ${i}`).join(' ')} END,
                 s.name COLLATE NOCASE
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)
    .map((s) => ({ ...s, effective_url: derivedUrl(s) }));
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM services s ${clause}`).get(...params);

  // Two live services on the same host:port is the classic "why is my app not
  // starting" bug, so surface it across ALL of a project's services (not just
  // the current page) rather than making someone notice it.
  const conflicts = db
    .prepare(
      `SELECT host, port, environment, COUNT(*) AS count, GROUP_CONCAT(name, ', ') AS services
         FROM services
        WHERE port IS NOT NULL AND status != 'retired' AND project_id IN (${ids.map(() => '?').join(',')})
        GROUP BY host, port, environment HAVING COUNT(*) > 1`,
    )
    .all(...ids);

  res.json({ services, conflicts, total, page, limit });
});

router.get('/:id', (req, res) => {
  const service = db.prepare(`${SERVICE_SELECT} WHERE s.id = ?`).get(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  if (!can(req.user, 'service.view', service.project_id)) return res.status(403).json({ error: 'No access to this project' });
  res.json({ service: { ...service, effective_url: derivedUrl(service) } });
});

router.post('/', requireCap('service.create', (req) => Number(req.body?.project_id) || null), (req, res) => {
  const {
    project_id, name, environment = 'dev', host = 'localhost', port = null, protocol = 'http',
    url = '', repo_url = '', owner_id = null, status = 'unknown', notes = '',
  } = req.body || {};

  if (!project_id) return res.status(400).json({ error: 'Pick a project for this service' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Service name is required' });
  if (!ENVIRONMENTS.includes(environment)) return res.status(400).json({ error: 'Unknown environment' });
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });
  if (port !== null && port !== '' && (Number(port) < 1 || Number(port) > 65535)) {
    return res.status(400).json({ error: 'Port must be between 1 and 65535' });
  }

  const info = db
    .prepare(
      `INSERT INTO services (project_id, name, environment, host, port, protocol, url, repo_url, owner_id, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(project_id, String(name).trim(), environment, host, port === '' ? null : port,
         protocol, url, repo_url, owner_id, status, notes);

  const id = Number(info.lastInsertRowid);
  logActivity({
    projectId: project_id, entityType: 'service', entityId: id, entityLabel: String(name).trim(),
    actorId: req.user.id, action: 'created',
    summary: `registered ${String(name).trim()} on ${host}${port ? `:${port}` : ''} (${environment})`,
  });

  const created = db.prepare(`${SERVICE_SELECT} WHERE s.id = ?`).get(id);
  res.status(201).json({ service: { ...created, effective_url: derivedUrl(created) } });
});

router.patch('/:id', requireCap('service.edit', serviceProjectId), (req, res) => {
  const id = Number(req.params.id);
  const before = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!before) return res.status(404).json({ error: 'Service not found' });

  const { name, environment, host, port, protocol, url, repo_url, owner_id, status, notes } = req.body || {};
  if (environment && !ENVIRONMENTS.includes(environment)) return res.status(400).json({ error: 'Unknown environment' });
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });

  db.prepare(
    `UPDATE services SET
        name = COALESCE(?, name), environment = COALESCE(?, environment), host = COALESCE(?, host),
        port = COALESCE(?, port), protocol = COALESCE(?, protocol), url = COALESCE(?, url),
        repo_url = COALESCE(?, repo_url), owner_id = COALESCE(?, owner_id),
        status = COALESCE(?, status), notes = COALESCE(?, notes), updated_at = datetime('now')
      WHERE id = ?`,
  ).run(name ?? null, environment ?? null, host ?? null, port === '' ? null : port ?? null, protocol ?? null,
        url ?? null, repo_url ?? null, owner_id ?? null, status ?? null, notes ?? null, id);

  const after = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  logChanges({
    before, after, fields: ['name', 'environment', 'host', 'port', 'status', 'owner_id', 'notes'],
    entityType: 'service', entityId: id, entityLabel: after.name,
    projectId: after.project_id, actorId: req.user.id,
  });

  const row = db.prepare(`${SERVICE_SELECT} WHERE s.id = ?`).get(id);
  res.json({ service: { ...row, effective_url: derivedUrl(row) } });
});

router.delete('/:id', requireCap('service.delete', serviceProjectId), (req, res) => {
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  db.prepare('DELETE FROM services WHERE id = ?').run(service.id);
  logActivity({
    projectId: service.project_id, entityType: 'service', entityId: service.id, entityLabel: service.name,
    actorId: req.user.id, action: 'deleted', summary: `removed ${service.name} from the registry`,
  });
  res.json({ ok: true });
});

export default router;
