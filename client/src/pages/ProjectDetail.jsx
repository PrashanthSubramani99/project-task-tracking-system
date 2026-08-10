import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { useFetch } from '../hooks.js';
import { Icon } from '../components/icons.jsx';
import {
  Avatar, Badge, Card, ConfirmDialog, EmptyState, Field, Loading, ProgressBar,
  formatDate, relativeTime,
} from '../components/ui.jsx';

const PROJECT_ROLE_HELP = {
  lead: 'Full control: settings, members, and deleting the project.',
  member: 'Can create and change tasks, discussions, docs and services.',
  viewer: 'Read only. Cannot change anything in this project.',
};

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { people, toast, can, loadWorkspace } = useApp();
  const { data, loading, reload } = useFetch(`/projects/${id}`);
  const { data: activityData } = useFetch('/activity', { project_id: id, limit: 12 });

  const [addingMember, setAddingMember] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);

  if (loading) return <div className="page"><Loading /></div>;
  if (!data?.project) {
    return (
      <div className="page">
        <EmptyState icon="alert" title="Project not found" action={<Link className="btn" to="/projects">Back</Link>} />
      </div>
    );
  }

  const { project, members, myRole } = data;
  const canManage = can('project.members', project.id);
  const canEdit = can('project.edit', project.id);
  const nonMembers = people.filter((person) => person.is_active && !members.some((m) => m.id === person.id));

  const save = async () => {
    try {
      await api.patch(`/projects/${project.id}`, draft);
      toast('Project updated.', 'success');
      setEditing(false);
      reload({ quiet: true });
      loadWorkspace();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page">
      <div className="row small muted" style={{ marginBottom: 12, gap: 6 }}>
        <Link to="/projects">Projects</Link>
        <Icon name="chevronRight" size={12} />
        <span className="key-tag">{project.key}</span>
      </div>

      <div className="page-head">
        <span
          style={{
            width: 42, height: 42, borderRadius: 12, background: project.color, color: '#fff',
            display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0,
          }}
        >
          {project.key.slice(0, 2)}
        </span>
        <div className="grow">
          <h1>{project.name}</h1>
          <div className="sub">{project.description || 'No description yet.'}</div>
        </div>
        <button className="btn" onClick={() => navigate(`/board?project=${project.id}`)}>
          <Icon name="board" size={14} />
          Open board
        </button>
        {canEdit && !editing && (
          <button
            className="btn"
            onClick={() => {
              setDraft({
                name: project.name, description: project.description, status: project.status,
                lead_id: project.lead_id, start_date: project.start_date || '', target_date: project.target_date || '',
              });
              setEditing(true);
            }}
          >
            <Icon name="edit" size={14} />
            Settings
          </button>
        )}
      </div>

      <div className="grid c4" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="label">Total tasks</div>
          <div className="value">{project.stats.total}</div>
          <div className="foot">{project.stats.in_progress} in progress</div>
        </div>
        <div className="stat good">
          <div className="label">Completed</div>
          <div className="value">{project.stats.completion}%</div>
          <div className="foot">{project.stats.done} done</div>
        </div>
        <div className={`stat ${project.stats.overdue ? 'alert' : ''}`}>
          <div className="label">Overdue</div>
          <div className="value">{project.stats.overdue}</div>
          <div className="foot">{project.stats.blocked} blocked</div>
        </div>
        <div className={`stat ${project.stats.open_action_items ? 'alert' : ''}`}>
          <div className="label">Open action items</div>
          <div className="value">{project.stats.open_action_items}</div>
          <div className="foot">not yet tasks</div>
        </div>
      </div>

      {editing && (
        <Card title="Project settings" className="grow" style={{ marginBottom: 14 }}>
          <div className="grid c2" style={{ marginBottom: 12 }}>
            <Field label="Name">
              <input className="input" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </Field>
            <Field label="Status">
              <select className="select" value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
                <option value="active">Active</option>
                <option value="on_hold">On hold</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea className="textarea" rows={2} value={draft.description}
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          </Field>
          <div className="grid c3" style={{ marginTop: 12 }}>
            <Field label="Lead">
              <select className="select" value={draft.lead_id || ''} onChange={(e) => setDraft((d) => ({ ...d, lead_id: Number(e.target.value) }))}>
                {people.filter((p) => p.is_active).map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Start date">
              <input className="input" type="date" value={draft.start_date || ''}
                     onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value }))} />
            </Field>
            <Field label="Target date">
              <input className="input" type="date" value={draft.target_date || ''}
                     onChange={(e) => setDraft((d) => ({ ...d, target_date: e.target.value }))} />
            </Field>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            {can('project.delete', project.id) && (
              <button className="btn danger" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" size={14} />
                Delete project
              </button>
            )}
            <span className="spacer" />
            <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn primary" onClick={save}>Save changes</button>
          </div>
        </Card>
      )}

      <div className="grid sidebar-split">
        <Card
          title={`Team (${members.length})`}
          subtitle="Project roles decide what each person can change here."
          bodyClass="tight"
        >
          {members.map((member) => (
            <div className="list-item plain" key={member.id}>
              <Avatar user={member} size={30} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="strong small truncate">{member.name}</span>
                  {!member.is_active && <Badge square>Deactivated</Badge>}
                </div>
                <div className="tiny dim truncate">{member.title || member.email}</div>
              </div>

              {canManage ? (
                <select
                  className="select sm"
                  style={{ width: 110 }}
                  value={member.role}
                  title={PROJECT_ROLE_HELP[member.role]}
                  onChange={async (event) => {
                    try {
                      await api.patch(`/projects/${project.id}/members/${member.id}`, { role: event.target.value });
                      reload({ quiet: true });
                      loadWorkspace();
                    } catch (err) {
                      toast(err.message, 'error');
                    }
                  }}
                >
                  <option value="lead">Lead</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <Badge tone={member.role === 'lead' ? 'accent' : 'outline'} square>{member.role}</Badge>
              )}

              {canManage && (
                <button
                  className="icon-btn sm"
                  title="Remove from project"
                  onClick={async () => {
                    try {
                      await api.del(`/projects/${project.id}/members/${member.id}`);
                      toast(`${member.name} removed from the project.`, 'success');
                      reload({ quiet: true });
                      loadWorkspace();
                    } catch (err) {
                      toast(err.message, 'error');
                    }
                  }}
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          ))}

          {canManage && nonMembers.length > 0 && (
            <div className="row" style={{ gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}>
              <select className="select sm grow" value={addingMember} onChange={(e) => setAddingMember(e.target.value)}>
                <option value="">Add someone…</option>
                {nonMembers.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
              <button
                className="btn sm primary"
                disabled={!addingMember}
                onClick={async () => {
                  try {
                    await api.post(`/projects/${project.id}/members`, { user_id: Number(addingMember), role: 'member' });
                    setAddingMember('');
                    reload({ quiet: true });
                    loadWorkspace();
                    toast('Added to the project.', 'success');
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                }}
              >
                Add
              </button>
            </div>
          )}
        </Card>

        <div className="col" style={{ gap: 14 }}>
          <Card title="At a glance">
            <div className="col" style={{ gap: 10 }}>
              <div className="row between small">
                <span className="muted">Your role here</span>
                <Badge tone="accent" square>{myRole || 'no access'}</Badge>
              </div>
              <div className="row between small">
                <span className="muted">Lead</span>
                <span className="strong">{project.lead_name || '—'}</span>
              </div>
              <div className="row between small">
                <span className="muted">Started</span>
                <span>{formatDate(project.start_date)}</span>
              </div>
              <div className="row between small">
                <span className="muted">Target</span>
                <span>{formatDate(project.target_date)}</span>
              </div>
              <div className="divider" />
              <div className="row between small">
                <span className="muted">Progress</span>
                <span className="strong">{project.stats.completion}%</span>
              </div>
              <ProgressBar value={project.stats.completion} tone={project.stats.completion >= 70 ? 'green' : ''} />
            </div>
          </Card>

          <Card title="Jump to">
            <div className="col" style={{ gap: 6 }}>
              {[
                { to: `/board?project=${project.id}`, icon: 'board', label: 'Board' },
                { to: `/tasks?project=${project.id}`, icon: 'list', label: 'All tasks' },
                { to: `/meetings?project=${project.id}`, icon: 'chat', label: 'Discussions' },
                { to: `/docs`, icon: 'book', label: 'Documentation' },
                { to: `/services`, icon: 'server', label: 'Ports & services' },
                { to: `/reports`, icon: 'chart', label: 'Reports' },
              ].map((link) => (
                <button key={link.label} className="nav-item" onClick={() => navigate(link.to)}>
                  <Icon name={link.icon} size={15} />
                  {link.label}
                  <span className="spacer" />
                  <Icon name="chevronRight" size={13} />
                </button>
              ))}
            </div>
          </Card>

          <Card title="Recent activity">
            <div className="timeline">
              {(activityData?.activities || []).slice(0, 10).map((entry) => (
                <div className="timeline-item" key={entry.id}>
                  <div className="small">
                    <span className="strong">{entry.actor_name || 'Someone'}</span>{' '}
                    <span className="muted">{entry.summary}</span>
                  </div>
                  <div className="tiny dim">{relativeTime(entry.created_at)}</div>
                </div>
              ))}
              {!activityData?.activities?.length && <div className="muted small">Nothing yet.</div>}
            </div>
          </Card>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${project.name}?`}
          message="Every task, discussion, document and service in this project will be deleted. This cannot be undone."
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await api.del(`/projects/${project.id}`);
            await loadWorkspace();
            toast('Project deleted.', 'success');
            navigate('/projects');
          }}
        />
      )}
    </div>
  );
}
