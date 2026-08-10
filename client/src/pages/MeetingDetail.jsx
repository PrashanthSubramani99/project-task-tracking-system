import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { useFetch } from '../hooks.js';
import { Icon } from '../components/icons.jsx';
import {
  Avatar, Badge, Callout, Card, ConfirmDialog, EmptyState, Loading, Markdown, Menu, MenuItem,
  PRIORITY_META, SOURCE_META, StatusPill, dueMeta, formatDate, relativeTime,
} from '../components/ui.jsx';

function ActionItemRow({ item, people, canEdit, onPatch, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const due = dueMeta(item.due_date, item.status === 'converted' ? 'done' : 'todo');

  if (item.status === 'converted') {
    return (
      <div className="list-item plain">
        <Icon name="check" size={15} style={{ color: 'var(--green)', flexShrink: 0 }} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="truncate">{item.text}</div>
          <div className="tiny dim" style={{ marginTop: 2 }}>
            Tracked as <Link to={`/tasks/${item.task_id}`} className="key-tag">{item.task_key}</Link>
          </div>
        </div>
        {item.task_status && <StatusPill status={item.task_status} />}
      </div>
    );
  }

  return (
    <div className={`list-item plain ${item.status === 'dropped' ? 'dropped' : ''}`} style={item.status === 'dropped' ? { opacity: 0.5 } : undefined}>
      <Icon
        name={item.status === 'dropped' ? 'x' : 'target'}
        size={15}
        style={{ color: item.status === 'dropped' ? 'var(--text-3)' : 'var(--accent)', flexShrink: 0 }}
      />

      <div className="grow" style={{ minWidth: 0 }}>
        {editing ? (
          <div className="row" style={{ gap: 6 }}>
            <input className="input sm grow" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            <button
              className="btn sm primary"
              onClick={async () => {
                await onPatch({ text });
                setEditing(false);
              }}
            >
              Save
            </button>
            <button className="btn sm" onClick={() => { setText(item.text); setEditing(false); }}>Cancel</button>
          </div>
        ) : (
          <>
            <div style={{ textDecoration: item.status === 'dropped' ? 'line-through' : 'none' }}>{item.text}</div>
            <div className="row wrap tiny dim" style={{ gap: 8, marginTop: 3 }}>
              {item.owner_name ? (
                <span className="row" style={{ gap: 4 }}>
                  <Avatar user={{ name: item.owner_name, avatar_color: item.owner_color }} size={16} />
                  {item.owner_name}
                </span>
              ) : (
                <span style={{ color: 'var(--amber)', fontWeight: 600 }}>No owner</span>
              )}
              {due && (
                <span style={{ color: due.tone === 'red' ? 'var(--red)' : 'inherit', fontWeight: due.tone === 'red' ? 600 : 400 }}>
                  {due.label}
                </span>
              )}
              <Badge tone={PRIORITY_META[item.priority]?.tone} square>{PRIORITY_META[item.priority]?.label}</Badge>
            </div>
          </>
        )}
      </div>

      {canEdit && !editing && (
        <div className="row" style={{ gap: 4 }}>
          <select
            className="select sm"
            style={{ width: 130 }}
            value={item.owner_id || ''}
            onChange={(e) => onPatch({ owner_id: e.target.value ? Number(e.target.value) : null })}
            title="Assign an owner"
          >
            <option value="">No owner</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </select>
          <input
            className="input sm"
            type="date"
            style={{ width: 130 }}
            value={item.due_date || ''}
            onChange={(e) => onPatch({ due_date: e.target.value || null })}
          />
          <Menu trigger={<button className="icon-btn sm"><Icon name="dots" size={14} /></button>}>
            <MenuItem icon="edit" onClick={() => setEditing(true)}>Edit wording</MenuItem>
            {item.status === 'open' ? (
              <MenuItem icon="x" onClick={() => onPatch({ status: 'dropped' })}>Drop — not needed</MenuItem>
            ) : (
              <MenuItem icon="refresh" onClick={() => onPatch({ status: 'open' })}>Reopen</MenuItem>
            )}
            <div className="menu-sep" />
            <MenuItem icon="trash" danger onClick={onDelete}>Delete</MenuItem>
          </Menu>
        </div>
      )}
    </div>
  );
}

export default function MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { people, toast, can, completeJourneyStep, loadWorkspace } = useApp();
  const { data, loading, reload } = useFetch(`/meetings/${id}`);

  const [newItem, setNewItem] = useState('');
  const [converting, setConverting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  if (loading) return <div className="page"><Loading /></div>;
  if (!data?.meeting) {
    return (
      <div className="page">
        <EmptyState icon="alert" title="Discussion not found" action={<Link className="btn" to="/meetings">Back</Link>} />
      </div>
    );
  }

  const { meeting, attendees, actionItems, tasks, activity } = data;
  const meta = SOURCE_META[meeting.source] || SOURCE_META.other;
  const canEdit = can('action.manage', meeting.project_id);
  const canConvert = can('task.create', meeting.project_id);
  const openItems = actionItems.filter((item) => item.status === 'open');
  const activePeople = people.filter((p) => p.is_active);

  const patchItem = async (itemId, body) => {
    try {
      await api.patch(`/meetings/${meeting.id}/action-items/${itemId}`, body);
      reload({ quiet: true });
      loadWorkspace();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const addItem = async (event) => {
    event.preventDefault();
    if (!newItem.trim()) return;
    try {
      await api.post(`/meetings/${meeting.id}/action-items`, { text: newItem.trim() });
      setNewItem('');
      reload({ quiet: true });
      loadWorkspace();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const convertAll = async () => {
    setConverting(true);
    try {
      const result = await api.post(`/meetings/${meeting.id}/convert`, {});
      completeJourneyStep('convert');
      toast(`Created ${result.tasks.length} task(s): ${result.tasks.map((t) => t.key).join(', ')}`, 'success');
      reload({ quiet: true });
      loadWorkspace();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="page">
      <div className="row small muted" style={{ marginBottom: 12, gap: 6 }}>
        <Link to="/meetings">Discussions</Link>
        <Icon name="chevronRight" size={12} />
        <span>{meeting.project_name}</span>
      </div>

      <div className="page-head">
        <div className="grow">
          <h1>{meeting.title}</h1>
          <div className="row wrap sub" style={{ gap: 8, marginTop: 6 }}>
            <Badge tone="outline" square>
              <Icon name={meta.icon} size={11} />
              {meta.label}
            </Badge>
            <span>{formatDate(meeting.occurred_at, { withTime: true })}</span>
            {meeting.duration_min > 0 && (
              <>
                <span className="dim">·</span>
                <span>{meeting.duration_min} min</span>
              </>
            )}
            {meeting.location && (
              <>
                <span className="dim">·</span>
                <span>{meeting.location}</span>
              </>
            )}
            <span className="dim">·</span>
            <span>logged by {meeting.created_by_name}</span>
          </div>
        </div>

        {canConvert && openItems.length > 0 && (
          <button className="btn primary" onClick={convertAll} disabled={converting}>
            {converting ? <span className="spinner" /> : <Icon name="arrowRight" size={14} />}
            Convert {openItems.length} to tasks
          </button>
        )}
        {can('meeting.delete', meeting.project_id) && (
          <Menu trigger={<button className="icon-btn"><Icon name="dots" size={16} /></button>}>
            <MenuItem icon="trash" danger onClick={() => setConfirmDelete(true)}>Delete discussion</MenuItem>
          </Menu>
        )}
      </div>

      {openItems.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Callout tone={openItems.some((i) => !i.owner_id) ? 'warn' : ''} icon="target">
            {openItems.length} action item{openItems.length === 1 ? '' : 's'} still {openItems.length === 1 ? 'has' : 'have'} not
            been turned into tracked work
            {openItems.some((i) => !i.owner_id) && `, and ${openItems.filter((i) => !i.owner_id).length} of them have no owner`}.
            {canConvert && ' Converting them creates a task per item, assigned to its owner.'}
          </Callout>
        </div>
      )}

      <div className="grid sidebar-split">
        <div className="col" style={{ gap: 14 }}>
          <Card
            title="Action items"
            subtitle={`${actionItems.length} captured · ${openItems.length} open · ${
              actionItems.filter((i) => i.status === 'converted').length
            } now tracked`}
            bodyClass="tight"
          >
            {actionItems.length === 0 ? (
              <EmptyState icon="target" title="No action items were captured">
                Add one below so this discussion produces something trackable.
              </EmptyState>
            ) : (
              actionItems.map((item) => (
                <ActionItemRow
                  key={item.id}
                  item={item}
                  people={activePeople}
                  canEdit={canEdit}
                  onPatch={(body) => patchItem(item.id, body)}
                  onDelete={async () => {
                    await api.del(`/meetings/${meeting.id}/action-items/${item.id}`);
                    reload({ quiet: true });
                  }}
                />
              ))
            )}

            {canEdit && (
              <form onSubmit={addItem} className="row" style={{ gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}>
                <input
                  className="input grow"
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  placeholder="Add another action item that came up…"
                />
                <button className="btn primary" disabled={!newItem.trim()}>
                  <Icon name="plus" size={14} />
                  Add
                </button>
              </form>
            )}
          </Card>

          {meeting.summary && (
            <Card title="Summary">
              <Markdown>{meeting.summary}</Markdown>
            </Card>
          )}

          {meeting.decisions && (
            <Card title="Decisions" subtitle="Settled — do not re-open without a reason.">
              <Markdown>{meeting.decisions}</Markdown>
            </Card>
          )}

          <Card
            title="Raw notes"
            subtitle="Exactly as they were pasted, so nothing is lost in the summarising."
            actions={
              <button className="btn sm" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? 'Hide' : 'Show'}
              </button>
            }
          >
            {showRaw ? (
              <pre
                style={{
                  margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)',
                  fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-2)',
                }}
              >
                {meeting.raw_notes || 'No raw notes were saved.'}
              </pre>
            ) : (
              <div className="muted small">
                {(meeting.raw_notes || '').split('\n').length} lines saved.
              </div>
            )}
          </Card>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <Card title={`Attendees (${attendees.length})`}>
            {attendees.length ? (
              <div className="col" style={{ gap: 8 }}>
                {attendees.map((person) => (
                  <div className="row" key={person.id} style={{ gap: 8 }}>
                    <Avatar user={person} size={26} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="small strong truncate">{person.name}</div>
                      <div className="tiny dim truncate">{person.title}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted small">Nobody was recorded as attending.</div>
            )}
          </Card>

          {tasks.length > 0 && (
            <Card title={`Tasks from this discussion (${tasks.length})`} bodyClass="tight">
              {tasks.map((task) => (
                <div className="list-item" key={task.id} onClick={() => navigate(`/tasks/${task.id}`)}>
                  <span className="key-tag">{task.key}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="truncate small">{task.title}</div>
                    <div className="tiny dim">{task.assignee_name || 'Unassigned'}</div>
                  </div>
                  <StatusPill status={task.status} />
                </div>
              ))}
            </Card>
          )}

          <Card title="History">
            <div className="timeline">
              {activity.length === 0 && <div className="muted small">Nothing recorded yet.</div>}
              {activity.map((entry) => (
                <div className="timeline-item" key={entry.id}>
                  <div>
                    <span className="strong">{entry.actor_name || 'Someone'}</span>{' '}
                    <span className="muted">{entry.summary}</span>
                  </div>
                  <div className="tiny dim">{relativeTime(entry.created_at)}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this discussion?"
          message="The notes and every action item on it will be removed. Tasks already created from it will stay."
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await api.del(`/meetings/${meeting.id}`);
            toast('Discussion deleted.', 'success');
            navigate('/meetings');
          }}
        />
      )}
    </div>
  );
}
