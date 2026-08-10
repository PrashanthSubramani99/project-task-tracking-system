import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { useFetch } from '../hooks.js';
import { Icon } from '../components/icons.jsx';
import {
  Avatar, Badge, Callout, Card, ConfirmDialog, EmptyState, Field, Loading, Modal,
  SearchInput, Spinner, relativeTime,
} from '../components/ui.jsx';

const ORG_ROLES = [
  {
    value: 'admin',
    label: 'Administrator',
    summary: 'Everything, everywhere — including people and every project.',
    tone: 'red',
  },
  {
    value: 'manager',
    label: 'Manager',
    summary: 'Can create projects and add people, plus full access to their own projects.',
    tone: 'purple',
  },
  {
    value: 'member',
    label: 'Team member',
    summary: 'Works on the projects they belong to: tasks, notes, docs, services.',
    tone: 'blue',
  },
  {
    value: 'viewer',
    label: 'Viewer',
    summary: 'Read-only everywhere. Useful for stakeholders and clients.',
    tone: '',
  },
];

const roleMeta = (role) => ORG_ROLES.find((r) => r.value === role) || ORG_ROLES[2];

function PersonModal({ person, onClose, onSaved }) {
  const { toast, user } = useApp();
  const isNew = !person;

  const [form, setForm] = useState({
    name: person?.name || '',
    email: person?.email || '',
    password: '',
    role: person?.role || 'member',
    title: person?.title || '',
    phone: person?.phone || '',
  });
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const save = async () => {
    if (!form.name.trim() || !form.email.trim()) return toast('Name and email are required.', 'error');
    if (isNew && form.password.length < 8) return toast('Set a starting password of at least 8 characters.', 'error');

    setBusy(true);
    try {
      const payload = { ...form };
      if (!isNew && !payload.password) delete payload.password;
      const result = isNew ? await api.post('/users', payload) : await api.patch(`/users/${person.id}`, payload);
      toast(isNew ? `${result.user.name} added to the team.` : 'Profile updated.', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Add someone to the team' : `Edit ${person.name}`}
      subtitle={isNew ? 'They can sign in straight away with the password you set.' : undefined}
      width="wide"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : isNew ? 'Add person' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="grid c2">
        <Field label="Full name" required>
          <input className="input" value={form.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="Email" required>
          <input className="input" type="email" value={form.email} onChange={set('email')} />
        </Field>
      </div>

      <div className="grid c2">
        <Field label="Job title">
          <input className="input" value={form.title} onChange={set('title')} placeholder="Backend Developer" />
        </Field>
        <Field label="Phone">
          <input className="input" value={form.phone} onChange={set('phone')} />
        </Field>
      </div>

      <Field
        label={isNew ? 'Starting password' : 'Reset password'}
        hint={isNew ? 'At least 8 characters. Ask them to change it after signing in.' : 'Leave blank to keep the current one.'}
        required={isNew}
      >
        <input className="input" type="text" value={form.password} onChange={set('password')} placeholder={isNew ? '' : '••••••••'} />
      </Field>

      <Field label="Access level">
        <div className="col" style={{ gap: 6 }}>
          {ORG_ROLES.map((role) => {
            const blocked = role.value === 'admin' && user.role !== 'admin';
            return (
              <label
                key={role.value}
                className="row"
                style={{
                  gap: 10, padding: '9px 11px', borderRadius: 'var(--radius-sm)', cursor: blocked ? 'not-allowed' : 'pointer',
                  border: `1px solid ${form.role === role.value ? 'var(--accent)' : 'var(--border)'}`,
                  background: form.role === role.value ? 'var(--accent-soft)' : 'transparent',
                  opacity: blocked ? 0.5 : 1, alignItems: 'flex-start',
                }}
              >
                <input
                  type="radio"
                  name="role"
                  checked={form.role === role.value}
                  disabled={blocked}
                  onChange={() => setForm((f) => ({ ...f, role: role.value }))}
                  style={{ accentColor: 'var(--accent)', marginTop: 2 }}
                />
                <div>
                  <div className="strong small">{role.label}</div>
                  <div className="tiny muted">{role.summary}</div>
                </div>
              </label>
            );
          })}
        </div>
      </Field>
    </Modal>
  );
}

export default function People() {
  const { user, toast, loadWorkspace } = useApp();
  const { data, loading, reload } = useFetch('/users', { include_inactive: 'true' });

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deactivating, setDeactivating] = useState(null);

  const canManage = ['admin', 'manager'].includes(user.role);
  const users = (data?.users || []).filter(
    (person) =>
      !query ||
      person.name.toLowerCase().includes(query.toLowerCase()) ||
      person.email.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>People</h1>
          <div className="sub">Who is on the team and what each of them is allowed to do.</div>
        </div>
        {canManage && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} />
            Add person
          </button>
        )}
      </div>

      {canManage && (
        <div style={{ marginBottom: 14 }}>
          <Callout icon="shield" title="How access works">
            The role here sets what someone can do across the whole workspace. Inside each project you can narrow it
            further — a team member can still be a read-only viewer on a project they are not working on.
          </Callout>
        </div>
      )}

      <div className="row wrap" style={{ marginBottom: 14, gap: 8 }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search by name or email…" style={{ width: 260 }} />
        <span className="spacer" />
        <span className="small muted">{users.filter((u) => u.is_active).length} active</span>
      </div>

      <Card bodyClass="tight">
        {loading ? (
          <Loading />
        ) : users.length === 0 ? (
          <EmptyState icon="users" title="Nobody matches that search" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th style={{ width: 240 }}>Email</th>
                  <th style={{ width: 160 }}>Access level</th>
                  <th style={{ width: 130 }}>Last seen</th>
                  <th style={{ width: 96 }} />
                </tr>
              </thead>
              <tbody>
                {users.map((person) => {
                  const meta = roleMeta(person.role);
                  return (
                    <tr key={person.id} style={person.is_active ? undefined : { opacity: 0.5 }}>
                      <td>
                        <span className="row" style={{ gap: 9 }}>
                          <Avatar user={person} size={30} />
                          <span>
                            <span className="row" style={{ gap: 6 }}>
                              <span className="strong">{person.name}</span>
                              {person.id === user.id && <Badge tone="accent" square>You</Badge>}
                              {!person.is_active && <Badge square>Deactivated</Badge>}
                            </span>
                            <span className="tiny dim">{person.title || '—'}</span>
                          </span>
                        </span>
                      </td>
                      <td className="small muted">{person.email}</td>
                      <td>
                        <Badge tone={meta.tone} square title={meta.summary}>{meta.label}</Badge>
                      </td>
                      <td className="tiny dim">{person.last_seen_at ? relativeTime(person.last_seen_at) : 'never'}</td>
                      <td>
                        {canManage && (
                          <div className="row" style={{ gap: 2 }}>
                            <button className="icon-btn sm" title="Edit" onClick={() => setEditing(person)}>
                              <Icon name="edit" size={13} />
                            </button>
                            {user.role === 'admin' && person.id !== user.id && person.is_active && (
                              <button className="icon-btn sm" title="Deactivate" onClick={() => setDeactivating(person)}>
                                <Icon name="logout" size={13} />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid c4" style={{ marginTop: 14 }}>
        {ORG_ROLES.map((role) => (
          <Card key={role.value}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <Badge tone={role.tone} square>{role.label}</Badge>
              <span className="spacer" />
              <span className="tiny dim">
                {(data?.users || []).filter((u) => u.role === role.value && u.is_active).length}
              </span>
            </div>
            <div className="tiny muted">{role.summary}</div>
          </Card>
        ))}
      </div>

      {(creating || editing) && (
        <PersonModal
          person={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { reload({ quiet: true }); loadWorkspace(); }}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          title={`Deactivate ${deactivating.name}?`}
          message="They will not be able to sign in. Their comments, tasks and history stay exactly as they are."
          confirmLabel="Deactivate"
          onClose={() => setDeactivating(null)}
          onConfirm={async () => {
            try {
              await api.del(`/users/${deactivating.id}`);
              toast(`${deactivating.name} deactivated.`, 'success');
              reload({ quiet: true });
            } catch (err) {
              toast(err.message, 'error');
            }
          }}
        />
      )}
    </div>
  );
}
