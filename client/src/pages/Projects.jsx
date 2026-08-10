import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { Icon } from '../components/icons.jsx';
import {
  AvatarStack, Badge, Card, EmptyState, Field, Modal, ProgressBar, Spinner, formatDate,
} from '../components/ui.jsx';

const COLORS = ['#5b5bd6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

const STATUS_LABEL = { active: 'Active', on_hold: 'On hold', archived: 'Archived' };
const STATUS_TONE = { active: 'green', on_hold: 'amber', archived: '' };

function ProjectModal({ onClose, onCreated }) {
  const { people, user, toast, loadWorkspace } = useApp();
  const [form, setForm] = useState({
    name: '', key: '', description: '', color: COLORS[0],
    lead_id: user.id, start_date: '', target_date: '',
  });
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const save = async () => {
    if (!form.name.trim()) return toast('Give the project a name.', 'error');
    setBusy(true);
    try {
      const { project } = await api.post('/projects', {
        ...form,
        lead_id: Number(form.lead_id),
        start_date: form.start_date || null,
        target_date: form.target_date || null,
        members: members.map((id) => ({ user_id: id, role: 'member' })),
      });
      await loadWorkspace();
      toast(`${project.name} created.`, 'success');
      onCreated(project);
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const suggestedKey = form.key || form.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase() || 'PROJ';

  return (
    <Modal
      title="New project"
      subtitle="A project groups its own tasks, discussions, documents and services."
      width="wide"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : 'Create project'}
          </button>
        </>
      }
    >
      <div className="grid c2">
        <Field label="Name" required>
          <input className="input" value={form.name} onChange={set('name')} placeholder="Customer Portal" autoFocus />
        </Field>
        <Field label="Key" hint={`Task ids will read ${suggestedKey}-1, ${suggestedKey}-2 …`}>
          <input
            className="input mono"
            value={form.key}
            onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase() }))}
            placeholder={suggestedKey}
            maxLength={6}
          />
        </Field>
      </div>

      <Field label="What is it for?">
        <textarea className="textarea" rows={2} value={form.description} onChange={set('description')} />
      </Field>

      <div className="grid c2">
        <Field label="Project lead" hint="Leads can manage members and settings.">
          <select className="select" value={form.lead_id} onChange={set('lead_id')}>
            {people.filter((p) => p.is_active).map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Colour">
          <div className="row" style={{ gap: 6 }}>
            {COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setForm((f) => ({ ...f, color }))}
                style={{
                  width: 26, height: 26, borderRadius: 8, background: color, cursor: 'pointer',
                  border: form.color === color ? '2px solid var(--text)' : '2px solid transparent',
                }}
                aria-label={color}
              />
            ))}
          </div>
        </Field>
      </div>

      <div className="grid c2">
        <Field label="Start date">
          <input className="input" type="date" value={form.start_date} onChange={set('start_date')} />
        </Field>
        <Field label="Target date">
          <input className="input" type="date" value={form.target_date} onChange={set('target_date')} />
        </Field>
      </div>

      <Field label="Who else is on it?">
        <div className="col" style={{ gap: 6, maxHeight: 190, overflowY: 'auto' }}>
          {people.filter((p) => p.is_active && p.id !== Number(form.lead_id)).map((person) => (
            <label className="checkbox" key={person.id}>
              <input
                type="checkbox"
                checked={members.includes(person.id)}
                onChange={(e) =>
                  setMembers((current) =>
                    e.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id),
                  )
                }
              />
              {person.name}
              <span className="tiny dim">{person.title}</span>
            </label>
          ))}
        </div>
      </Field>
    </Modal>
  );
}

export default function Projects() {
  const { projects, can } = useApp();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Projects</h1>
          <div className="sub">Each project has its own board, discussions, docs and service registry.</div>
        </div>
        {can('project.create') && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} />
            New project
          </button>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="folder"
            title="No projects yet"
            action={can('project.create') && <button className="btn primary" onClick={() => setCreating(true)}>Create a project</button>}
          >
            {can('project.create')
              ? 'Create one to start tracking work.'
              : 'Ask an administrator or a manager to add you to a project.'}
          </EmptyState>
        </div>
      ) : (
        <div className="grid c3">
          {projects.map((project) => (
            <Card key={project.id} className="clickable">
              <div style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${project.id}`)}>
                <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                  <span
                    style={{
                      width: 30, height: 30, borderRadius: 9, background: project.color,
                      color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 11,
                    }}
                  >
                    {project.key.slice(0, 2)}
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="strong truncate">{project.name}</div>
                    <div className="tiny dim">{project.key}</div>
                  </div>
                  <Badge tone={STATUS_TONE[project.status]} square>{STATUS_LABEL[project.status]}</Badge>
                </div>

                <p className="small muted truncate" style={{ marginBottom: 12 }}>
                  {project.description || 'No description.'}
                </p>

                <div className="row between small" style={{ marginBottom: 5 }}>
                  <span className="muted">{project.stats.done} of {project.stats.total} done</span>
                  <span className="strong">{project.stats.completion}%</span>
                </div>
                <ProgressBar value={project.stats.completion} tone={project.stats.completion >= 70 ? 'green' : ''} />

                <div className="row wrap" style={{ gap: 7, marginTop: 12 }}>
                  {project.stats.overdue > 0 && (
                    <Badge tone="red" square>
                      <Icon name="alert" size={10} />
                      {project.stats.overdue} overdue
                    </Badge>
                  )}
                  {project.stats.blocked > 0 && (
                    <Badge tone="amber" square>{project.stats.blocked} blocked</Badge>
                  )}
                  {project.stats.open_action_items > 0 && (
                    <Badge tone="accent" square>
                      <Icon name="target" size={10} />
                      {project.stats.open_action_items} action items
                    </Badge>
                  )}
                  <span className="spacer" />
                  <span className="tiny dim">{project.member_count} member{project.member_count === 1 ? '' : 's'}</span>
                </div>

                {project.target_date && (
                  <div className="tiny dim" style={{ marginTop: 8 }}>
                    Target {formatDate(project.target_date)} · led by {project.lead_name || 'nobody'}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating && <ProjectModal onClose={() => setCreating(false)} onCreated={(p) => navigate(`/projects/${p.id}`)} />}
    </div>
  );
}
