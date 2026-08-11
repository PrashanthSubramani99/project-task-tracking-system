import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { useDebounced, useFetch } from '../hooks.js';
import { Icon } from '../components/icons.jsx';
import {
  Avatar, Badge, Callout, Card, ConfirmDialog, EmptyState, Field, Loading, Modal,
  Pagination, SearchInput, Segmented, Spinner,
} from '../components/ui.jsx';

const ENVIRONMENTS = [
  { value: 'dev', label: 'Development', tone: 'blue' },
  { value: 'staging', label: 'Staging', tone: 'purple' },
  { value: 'uat', label: 'UAT', tone: 'amber' },
  { value: 'prod', label: 'Production', tone: 'red' },
];

const STATUS_TONE = { up: 'green', down: 'red', unknown: 'amber', retired: '' };
const STATUS_LABEL = { up: 'Running', down: 'Down', unknown: 'Not verified', retired: 'Retired' };

function ServiceEditor({ service, onClose, onSaved }) {
  const { projects, people, toast } = useApp();
  const writable = projects.filter((p) => p.my_role !== 'viewer');

  const [form, setForm] = useState({
    project_id: service?.project_id || writable[0]?.id || '',
    name: service?.name || '',
    environment: service?.environment || 'dev',
    host: service?.host || 'localhost',
    port: service?.port ?? '',
    protocol: service?.protocol || 'http',
    url: service?.url || '',
    repo_url: service?.repo_url || '',
    owner_id: service?.owner_id || '',
    status: service?.status || 'unknown',
    notes: service?.notes || '',
  });
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const save = async () => {
    if (!form.name.trim()) return toast('Give the service a name.', 'error');
    setBusy(true);
    try {
      const payload = {
        ...form,
        project_id: Number(form.project_id),
        port: form.port === '' ? null : Number(form.port),
        owner_id: form.owner_id ? Number(form.owner_id) : null,
      };
      const result = service ? await api.patch(`/services/${service.id}`, payload) : await api.post('/services', payload);
      toast(service ? 'Service updated.' : 'Service registered.', 'success');
      onSaved(result.service);
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={service ? 'Edit service' : 'Register a service'}
      subtitle="One row per service per environment — that is what makes port clashes visible."
      width="wide"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid c2">
        <Field label="Service name" required>
          <input className="input" value={form.name} onChange={set('name')} placeholder="Portal API" autoFocus />
        </Field>
        <Field label="Project">
          <select className="select" value={form.project_id} onChange={set('project_id')}>
            {writable.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid c4">
        <Field label="Environment">
          <select className="select" value={form.environment} onChange={set('environment')}>
            {ENVIRONMENTS.map((env) => (
              <option key={env.value} value={env.value}>{env.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Protocol">
          <select className="select" value={form.protocol} onChange={set('protocol')}>
            {['http', 'https', 'tcp', 'grpc', 'ws'].map((protocol) => (
              <option key={protocol} value={protocol}>{protocol}</option>
            ))}
          </select>
        </Field>
        <Field label="Host">
          <input className="input" value={form.host} onChange={set('host')} placeholder="localhost" />
        </Field>
        <Field label="Port">
          <input className="input" type="number" min="1" max="65535" value={form.port} onChange={set('port')} placeholder="8080" />
        </Field>
      </div>

      <div className="grid c2">
        <Field label="Full URL" hint="Only if it differs from protocol://host:port.">
          <input className="input" value={form.url} onChange={set('url')} placeholder="https://api.example.com" />
        </Field>
        <Field label="Repository">
          <input className="input" value={form.repo_url} onChange={set('repo_url')} placeholder="https://github.com/…" />
        </Field>
      </div>

      <div className="grid c2">
        <Field label="Who owns it">
          <select className="select" value={form.owner_id} onChange={set('owner_id')}>
            <option value="">Nobody assigned</option>
            {people.filter((p) => p.is_active).map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className="select" value={form.status} onChange={set('status')}>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Notes" hint="Credentials location, quirks, anything the next person will need.">
        <textarea className="textarea" rows={3} value={form.notes} onChange={set('notes')} />
      </Field>
    </Modal>
  );
}

export default function Services() {
  const { projects, toast, can } = useApp();

  const [projectId, setProjectId] = useState('');
  const [environment, setEnvironment] = useState('');
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 280);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  useEffect(() => setPage(1), [debounced, projectId, environment]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const { data, loading, reload } = useFetch('/services', {
    project_id: projectId || undefined,
    environment: environment || undefined,
    q: debounced || undefined,
    page,
    limit,
  });

  const services = data?.services || [];
  const conflicts = data?.conflicts || [];
  const total = data?.total ?? services.length;
  const canWrite = projects.some((p) => p.my_role && p.my_role !== 'viewer');

  const grouped = ENVIRONMENTS.map((env) => ({
    ...env,
    rows: services.filter((service) => service.environment === env.value),
  })).filter((group) => group.rows.length > 0);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Ports &amp; services</h1>
          <div className="sub">
            Which app runs where, on which port, and who to ask when it breaks.
          </div>
        </div>
        {canWrite && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} />
            Register a service
          </button>
        )}
      </div>

      {conflicts.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Callout tone="danger" icon="alert" title={`${conflicts.length} port clash${conflicts.length === 1 ? '' : 'es'}`}>
            {conflicts.map((clash) => (
              <div key={`${clash.host}:${clash.port}:${clash.environment}`}>
                <span className="mono strong">{clash.host}:{clash.port}</span> in {clash.environment} is claimed by{' '}
                {clash.services}. Two services on the same port will fight to start.
              </div>
            ))}
          </Callout>
        </div>
      )}

      <div className="row wrap" style={{ marginBottom: 14, gap: 8 }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search name, host or port…" style={{ width: 250 }} />
        <select className="select sm" style={{ width: 180 }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        <Segmented
          value={environment}
          onChange={setEnvironment}
          options={[{ value: '', label: 'All' }, ...ENVIRONMENTS.map((env) => ({ value: env.value, label: env.label }))]}
        />
        <span className="spacer" />
        <span className="small muted">{total} registered</span>
      </div>

      {loading ? (
        <Loading />
      ) : services.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="server"
            title="Nothing registered yet"
            action={canWrite && <button className="btn primary" onClick={() => setCreating(true)}>Register the first service</button>}
          >
            Write down every app, database and cache with its host and port, per environment. It ends the
            “which port was staging on again?” message for good.
          </EmptyState>
        </div>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          {grouped.map((group) => (
            <Card
              key={group.value}
              title={group.label}
              subtitle={`${group.rows.length} service${group.rows.length === 1 ? '' : 's'}`}
              bodyClass="tight"
            >
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th style={{ width: 250 }}>Address</th>
                      <th style={{ width: 130 }}>Status</th>
                      <th style={{ width: 165 }}>Owner</th>
                      <th>Notes</th>
                      <th style={{ width: 76 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((service) => (
                      <tr key={service.id} style={service.status === 'retired' ? { opacity: 0.55 } : undefined}>
                        <td>
                          <div className="row" style={{ gap: 6 }}>
                            <span className="dot" style={{ background: service.project_color }} title={service.project_name} />
                            <span className="strong">{service.name}</span>
                          </div>
                          <span className="tiny dim">{service.project_key}</span>
                        </td>
                        <td>
                          <a
                            className="mono small"
                            href={service.effective_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => ['tcp', 'grpc'].includes(service.protocol) && e.preventDefault()}
                          >
                            {service.host}{service.port ? `:${service.port}` : ''}
                          </a>
                          <div className="tiny dim">{service.protocol}</div>
                        </td>
                        <td>
                          <Badge tone={STATUS_TONE[service.status]} square>
                            {STATUS_LABEL[service.status]}
                          </Badge>
                        </td>
                        <td>
                          {service.owner_name ? (
                            <span className="row" style={{ gap: 6 }}>
                              <Avatar user={{ name: service.owner_name, avatar_color: service.owner_color }} size={22} />
                              <span className="small truncate">{service.owner_name}</span>
                            </span>
                          ) : (
                            <span className="tiny" style={{ color: 'var(--amber)' }}>Unowned</span>
                          )}
                        </td>
                        <td className="small muted">{service.notes || '—'}</td>
                        <td>
                          <div className="row" style={{ gap: 2 }}>
                            {can('service.edit', service.project_id) && (
                              <button className="icon-btn sm" onClick={() => setEditing(service)} title="Edit">
                                <Icon name="edit" size={13} />
                              </button>
                            )}
                            {can('service.delete', service.project_id) && (
                              <button className="icon-btn sm" onClick={() => setDeleting(service)} title="Remove">
                                <Icon name="trash" size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
          <Card bodyClass="tight">
            <Pagination page={page} limit={limit} total={total} onPageChange={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} />
          </Card>
        </div>
      )}

      {(creating || editing) && (
        <ServiceEditor
          service={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => reload({ quiet: true })}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Remove ${deleting.name}?`}
          message="It will disappear from the registry. Mark it as retired instead if you want to keep the record."
          confirmLabel="Remove"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.del(`/services/${deleting.id}`);
            toast('Service removed.', 'success');
            reload({ quiet: true });
          }}
        />
      )}
    </div>
  );
}
