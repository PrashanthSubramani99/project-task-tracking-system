import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { useFetch } from '../hooks.js';
import { Icon } from '../components/icons.jsx';
import {
  Avatar, Callout, Card, ConfirmDialog, EmptyState, Field, Loading, Markdown,
  Menu, MenuItem, PRIORITY_META, PriorityTag, ProgressBar, STATUS_META, StatusPill,
  TYPE_META, dueMeta, formatDate, relativeTime,
} from '../components/ui.jsx';

/** An inline field that saves as soon as the value changes. */
function InlineSelect({ value, options, onChange, disabled, width = 150 }) {
  const [saving, setSaving] = useState(false);
  return (
    <span className="row" style={{ gap: 6 }}>
      <select
        className="select sm"
        style={{ width }}
        value={value ?? ''}
        disabled={disabled || saving}
        onChange={async (event) => {
          setSaving(true);
          try {
            await onChange(event.target.value);
          } finally {
            setSaving(false);
          }
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {saving && <span className="spinner" />}
    </span>
  );
}

function ActivityFeed({ activity }) {
  if (!activity.length) return <div className="muted small">No changes recorded yet.</div>;
  return (
    <div className="timeline">
      {activity.map((entry) => (
        <div className={`timeline-item ${entry.action === 'created' ? 'accent' : ''}`} key={entry.id}>
          <div>
            <span className="strong">{entry.actor_name || 'Someone'}</span> <span className="muted">{entry.summary}</span>
          </div>
          <div className="tiny dim" style={{ marginTop: 2 }}>{relativeTime(entry.created_at)}</div>
        </div>
      ))}
    </div>
  );
}

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { people, toast, can, user } = useApp();
  const { data, loading, reload } = useFetch(`/tasks/${id}`);

  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState('comments');

  if (loading) return <div className="page"><Loading /></div>;
  if (!data?.task) {
    return (
      <div className="page">
        <EmptyState icon="alert" title="Task not found" action={<Link className="btn" to="/tasks">Back to tasks</Link>} />
      </div>
    );
  }

  const { task, comments, subtasks, watchers, links, activity, isWatching } = data;
  const editable = can('task.edit', task.project_id);
  const due = dueMeta(task.due_date, task.status);

  const patch = async (body) => {
    try {
      await api.patch(`/tasks/${task.id}`, body);
      reload({ quiet: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const postComment = async (event) => {
    event.preventDefault();
    if (!comment.trim()) return;
    setPosting(true);
    try {
      await api.post(`/tasks/${task.id}/comments`, { body: comment });
      setComment('');
      reload({ quiet: true });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async () => {
    await patch({ title: draft.title, description: draft.description });
    setEditing(false);
  };

  return (
    <div className="page">
      <div className="row small muted" style={{ marginBottom: 12, gap: 6 }}>
        <Link to="/tasks">Tasks</Link>
        <Icon name="chevronRight" size={12} />
        <Link to={`/projects/${task.project_id}`}>{task.project_name}</Link>
        <Icon name="chevronRight" size={12} />
        <span className="key-tag">{task.key}</span>
      </div>

      <div className="page-head">
        <div className="grow">
          {editing ? (
            <input
              className="input"
              style={{ fontSize: 20, fontWeight: 620 }}
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              autoFocus
            />
          ) : (
            <h1>{task.title}</h1>
          )}
          <div className="row wrap sub" style={{ gap: 8, marginTop: 6 }}>
            <span className="row" style={{ gap: 4 }}>
              <Icon name={TYPE_META[task.type]?.icon || 'check'} size={13} />
              {TYPE_META[task.type]?.label || task.type}
            </span>
            <span className="dim">·</span>
            <span>Reported by {task.reporter_name || 'unknown'}</span>
            <span className="dim">·</span>
            <span>Created {formatDate(task.created_at)}</span>
            {task.meeting_id && (
              <>
                <span className="dim">·</span>
                <Link to={`/meetings/${task.meeting_id}`} className="row" style={{ gap: 4 }}>
                  <Icon name="chat" size={12} />
                  From “{task.meeting_title}”
                </Link>
              </>
            )}
          </div>
        </div>

        <button
          className="btn"
          onClick={async () => {
            await api.post(`/tasks/${task.id}/watch`);
            reload({ quiet: true });
          }}
          title={isWatching ? 'Stop getting notified about this task' : 'Get notified about changes'}
        >
          <Icon name={isWatching ? 'eyeOff' : 'eye'} size={14} />
          {isWatching ? 'Watching' : 'Watch'}
        </button>

        {editable && !editing && (
          <button className="btn" onClick={() => { setDraft({ title: task.title, description: task.description }); setEditing(true); }}>
            <Icon name="edit" size={14} />
            Edit
          </button>
        )}
        {editing && (
          <>
            <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn primary" onClick={saveEdit}>Save</button>
          </>
        )}

        <Menu
          trigger={<button className="icon-btn"><Icon name="dots" size={16} /></button>}
        >
          <MenuItem
            icon="copy"
            onClick={() => {
              navigator.clipboard?.writeText(`${window.location.origin}/tasks/${task.id}`);
              toast('Link copied.', 'success');
            }}
          >
            Copy link
          </MenuItem>
          {can('task.delete', task.project_id) && (
            <>
              <div className="menu-sep" />
              <MenuItem icon="trash" danger onClick={() => setConfirmDelete(true)}>Delete task</MenuItem>
            </>
          )}
        </Menu>
      </div>

      {task.status === 'blocked' && (
        <div style={{ marginBottom: 14 }}>
          <Callout tone="danger" icon="alert" title="This task is blocked">
            {task.blocked_reason || 'No reason was recorded. Add one so the rest of the team knows what is needed.'}
          </Callout>
        </div>
      )}
      {due?.overdue && (
        <div style={{ marginBottom: 14 }}>
          <Callout tone="warn" icon="clock">
            This task was due {formatDate(task.due_date)} — {due.label}. Move the date or push it to done.
          </Callout>
        </div>
      )}

      <div className="grid sidebar-split">
        <div className="col" style={{ gap: 14 }}>
          <Card title="Details">
            {editing ? (
              <textarea
                className="textarea"
                rows={9}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Markdown works here."
              />
            ) : task.description ? (
              <Markdown>{task.description}</Markdown>
            ) : (
              <div className="muted small">
                No description yet.{editable && ' Use Edit above to add context so nobody has to ask.'}
              </div>
            )}
          </Card>

          {subtasks.length > 0 && (
            <Card title="Subtasks" subtitle={`${subtasks.filter((s) => s.status === 'done').length} of ${subtasks.length} done`} bodyClass="tight">
              {subtasks.map((subtask) => (
                <div className="list-item" key={subtask.id} onClick={() => navigate(`/tasks/${subtask.id}`)}>
                  <span className="key-tag">{subtask.key}</span>
                  <span className="grow truncate">{subtask.title}</span>
                  <StatusPill status={subtask.status} />
                </div>
              ))}
            </Card>
          )}

          <Card bodyClass="tight">
            <div className="tabs" style={{ margin: 0, padding: '0 12px' }}>
              <button className={`tab ${tab === 'comments' ? 'active' : ''}`} onClick={() => setTab('comments')}>
                <Icon name="chat" size={14} />
                Comments
                <span className="badge sq">{comments.length}</span>
              </button>
              <button className={`tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>
                <Icon name="activity" size={14} />
                History
                <span className="badge sq">{activity.length}</span>
              </button>
            </div>

            <div style={{ padding: 16 }}>
              {tab === 'comments' ? (
                <>
                  {comments.length === 0 && (
                    <div className="muted small" style={{ marginBottom: 14 }}>
                      No comments yet. Mention someone with @name to pull them in.
                    </div>
                  )}
                  <div className="col" style={{ gap: 14, marginBottom: comments.length ? 18 : 0 }}>
                    {comments.map((entry) => (
                      <div className="row" style={{ alignItems: 'flex-start', gap: 10 }} key={entry.id}>
                        <Avatar user={{ name: entry.author_name || '?', avatar_color: entry.author_color }} size={28} />
                        <div className="grow">
                          <div className="row" style={{ gap: 7 }}>
                            <span className="strong small">{entry.author_name || 'Removed user'}</span>
                            <span className="tiny dim">{relativeTime(entry.created_at)}</span>
                            <span className="spacer" />
                            {(entry.author_id === user.id || can('comment.delete.any', task.project_id)) && (
                              <button
                                className="icon-btn sm"
                                title="Delete comment"
                                onClick={async () => {
                                  await api.del(`/tasks/${task.id}/comments/${entry.id}`);
                                  reload({ quiet: true });
                                }}
                              >
                                <Icon name="trash" size={12} />
                              </button>
                            )}
                          </div>
                          <div style={{ marginTop: 3, whiteSpace: 'pre-wrap' }}>{entry.body}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {can('comment.create', task.project_id) && (
                    <form onSubmit={postComment} className="col" style={{ gap: 8 }}>
                      <textarea
                        className="textarea"
                        rows={3}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Add an update… use @name to notify someone."
                      />
                      <div className="row">
                        <span className="tiny dim grow">Watchers and the assignee are notified automatically.</span>
                        <button className="btn primary sm" disabled={posting || !comment.trim()}>
                          <Icon name="send" size={13} />
                          Comment
                        </button>
                      </div>
                    </form>
                  )}
                </>
              ) : (
                <ActivityFeed activity={activity} />
              )}
            </div>
          </Card>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <Card title="Properties">
            <div className="col" style={{ gap: 12 }}>
              <Field label="Status">
                <InlineSelect
                  value={task.status}
                  disabled={!can('task.transition', task.project_id)}
                  width="100%"
                  options={Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))}
                  onChange={(value) => patch({ status: value })}
                />
              </Field>

              <Field label="Assignee">
                <InlineSelect
                  value={task.assignee_id || ''}
                  disabled={!can('task.assign', task.project_id)}
                  width="100%"
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...people.filter((p) => p.is_active).map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  onChange={(value) => patch({ assignee_id: value ? Number(value) : null })}
                />
              </Field>

              <Field label="Priority">
                <InlineSelect
                  value={task.priority}
                  disabled={!editable}
                  width="100%"
                  options={Object.entries(PRIORITY_META).map(([value, meta]) => ({ value, label: meta.label }))}
                  onChange={(value) => patch({ priority: value })}
                />
              </Field>

              <Field label="Due date">
                <input
                  className="input sm"
                  type="date"
                  disabled={!editable}
                  value={task.due_date || ''}
                  onChange={(e) => patch({ due_date: e.target.value || null })}
                />
              </Field>

              <Field label={`Progress — ${task.progress}%`}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  disabled={!editable}
                  value={task.progress}
                  onChange={(e) => patch({ progress: Number(e.target.value) })}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
                <ProgressBar value={task.progress} tone={task.progress === 100 ? 'green' : ''} />
              </Field>

              <div className="grid c2" style={{ gap: 10 }}>
                <Field label="Estimate (h)">
                  <input
                    className="input sm"
                    type="number" min="0" step="0.5"
                    disabled={!editable}
                    defaultValue={task.estimate_h}
                    onBlur={(e) => Number(e.target.value) !== task.estimate_h && patch({ estimate_h: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Spent (h)">
                  <input
                    className="input sm"
                    type="number" min="0" step="0.5"
                    disabled={!editable}
                    defaultValue={task.spent_h}
                    onBlur={(e) => Number(e.target.value) !== task.spent_h && patch({ spent_h: Number(e.target.value) })}
                  />
                </Field>
              </div>

              {task.status === 'blocked' && editable && (
                <Field label="Why is it blocked?">
                  <textarea
                    className="textarea"
                    rows={2}
                    defaultValue={task.blocked_reason}
                    onBlur={(e) => e.target.value !== task.blocked_reason && patch({ blocked_reason: e.target.value })}
                    placeholder="Waiting on…"
                  />
                </Field>
              )}
            </div>
          </Card>

          <Card title={`Watchers (${watchers.length})`}>
            {watchers.length ? (
              <div className="col" style={{ gap: 8 }}>
                {watchers.map((watcher) => (
                  <div className="row" key={watcher.id} style={{ gap: 8 }}>
                    <Avatar user={watcher} size={24} />
                    <span className="small">{watcher.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted small">Nobody is watching this task.</div>
            )}
          </Card>

          {links.length > 0 && (
            <Card title="Links" bodyClass="tight">
              {links.map((link) => (
                <a className="list-item" key={link.id} href={link.url} target="_blank" rel="noreferrer">
                  <Icon name="link" size={14} />
                  <span className="grow truncate small">{link.label}</span>
                </a>
              ))}
            </Card>
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${task.key}?`}
          message="The task, its comments and its history will be removed. This cannot be undone."
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await api.del(`/tasks/${task.id}`);
            toast(`${task.key} deleted.`, 'success');
            navigate('/tasks');
          }}
        />
      )}
    </div>
  );
}
