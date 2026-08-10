import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { useFetch } from '../hooks.js';
import { Icon } from '../components/icons.jsx';
import {
  Avatar, Badge, Callout, Card, EmptyState, Loading, PRIORITY_META, SOURCE_META,
  Segmented, StatusPill, dueMeta, formatDate,
} from '../components/ui.jsx';

/**
 * The safety net: every commitment made in a discussion that has not yet
 * become tracked work, across every project the user can see.
 */
export default function ActionItems() {
  const { projects, people, toast, can, completeJourneyStep, loadWorkspace, canWriteSomewhere } = useApp();
  const navigate = useNavigate();

  const [scope, setScope] = useState('all');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('open');
  const [selected, setSelected] = useState(new Set());
  const [converting, setConverting] = useState(false);

  const { data, loading, reload } = useFetch('/meetings/action-items', {
    status,
    owner_id: scope === 'mine' ? 'me' : scope === 'unowned' ? 'none' : undefined,
    project_id: projectId || undefined,
  });

  const items = data?.items || [];
  const activePeople = people.filter((p) => p.is_active);

  const overdue = items.filter((item) => item.due_date && item.due_date < new Date().toISOString().slice(0, 10));
  const unowned = items.filter((item) => !item.owner_id);

  const patch = async (item, body) => {
    try {
      await api.patch(`/meetings/${item.meeting_id}/action-items/${item.id}`, body);
      reload({ quiet: true });
      loadWorkspace();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const toggle = (id) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Convert the selection, grouped by meeting because that is the API shape. */
  const convertSelected = async () => {
    const chosen = items.filter((item) => selected.has(item.id));
    if (!chosen.length) return;

    const byMeeting = chosen.reduce((groups, item) => {
      (groups[item.meeting_id] ||= []).push(item.id);
      return groups;
    }, {});

    setConverting(true);
    let created = 0;
    try {
      for (const [meetingId, ids] of Object.entries(byMeeting)) {
        const result = await api.post(`/meetings/${meetingId}/convert`, { item_ids: ids });
        created += result.tasks.length;
      }
      completeJourneyStep('convert');
      toast(`Created ${created} task(s).`, 'success');
      setSelected(new Set());
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
      <div className="page-head">
        <div className="grow">
          <h1>Action items</h1>
          <div className="sub">
            Everything someone agreed to do that is not yet a tracked task. This list is the reason things stop
            slipping through.
          </div>
        </div>
      </div>

      {status === 'open' && (overdue.length > 0 || unowned.length > 0) && (
        <div className="grid c2" style={{ marginBottom: 14 }}>
          {overdue.length > 0 && (
            <Callout tone="danger" icon="alert" title={`${overdue.length} past their date`}>
              These were promised for a date that has already gone by. Convert them, re-date them, or drop them.
            </Callout>
          )}
          {unowned.length > 0 && (
            <Callout tone="warn" icon="user" title={`${unowned.length} with nobody on the hook`}>
              An action item without an owner is the one that gets forgotten. Assign each of these to a person.
            </Callout>
          )}
        </div>
      )}

      <div className="row wrap" style={{ marginBottom: 14, gap: 8 }}>
        <Segmented
          value={scope}
          onChange={(value) => { setScope(value); setSelected(new Set()); }}
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'mine', label: 'Mine' },
            { value: 'unowned', label: 'No owner' },
          ]}
        />
        <Segmented
          value={status}
          onChange={(value) => { setStatus(value); setSelected(new Set()); }}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'converted', label: 'Converted' },
            { value: 'dropped', label: 'Dropped' },
          ]}
        />
        <select className="select sm" style={{ width: 180 }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>

        <span className="spacer" />

        {selected.size > 0 && (
          <button className="btn primary" onClick={convertSelected} disabled={converting}>
            {converting ? <span className="spinner" /> : <Icon name="arrowRight" size={14} />}
            Convert {selected.size} to tasks
          </button>
        )}
        <span className="small muted">{items.length} item{items.length === 1 ? '' : 's'}</span>
      </div>

      <Card bodyClass="tight">
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState
            icon={status === 'open' ? 'check' : 'inbox'}
            title={status === 'open' ? 'Nothing is waiting' : `No ${status} action items`}
            action={
              status === 'open' && canWriteSomewhere ? (
                <button className="btn primary" onClick={() => navigate('/meetings/new')}>
                  Log a discussion
                </button>
              ) : null
            }
          >
            {status === 'open'
              ? 'Every commitment from your discussions has been turned into a task or dropped. Nicely done.'
              : 'Change the filter above to see other action items.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {status === 'open' && (
                    <th style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        checked={selected.size === items.length && items.length > 0}
                        onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                        style={{ accentColor: 'var(--accent)' }}
                      />
                    </th>
                  )}
                  <th>Action</th>
                  <th style={{ width: 180 }}>Owner</th>
                  <th style={{ width: 150 }}>Due</th>
                  <th style={{ width: 100 }}>Priority</th>
                  <th style={{ width: 210 }}>From</th>
                  {status === 'open' && <th style={{ width: 90 }} />}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const due = dueMeta(item.due_date, 'todo');
                  const editable = can('action.manage', item.project_id);
                  return (
                    <tr key={item.id}>
                      {status === 'open' && (
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(item.id)}
                            onChange={() => toggle(item.id)}
                            style={{ accentColor: 'var(--accent)' }}
                          />
                        </td>
                      )}
                      <td>
                        <div className="row" style={{ gap: 7 }}>
                          <span className="dot" style={{ background: item.project_color }} title={item.project_name} />
                          <span style={{ fontWeight: 500 }}>{item.text}</span>
                        </div>
                        {item.task_key && (
                          <div className="tiny dim" style={{ marginTop: 3 }}>
                            Tracked as <span className="key-tag">{item.task_key}</span>{' '}
                            {item.task_status && <StatusPill status={item.task_status} />}
                          </div>
                        )}
                      </td>
                      <td>
                        {editable && status === 'open' ? (
                          <select
                            className="select sm"
                            value={item.owner_id || ''}
                            onChange={(e) => patch(item, { owner_id: e.target.value ? Number(e.target.value) : null })}
                          >
                            <option value="">Nobody yet</option>
                            {activePeople.map((person) => (
                              <option key={person.id} value={person.id}>{person.name}</option>
                            ))}
                          </select>
                        ) : item.owner_name ? (
                          <span className="row" style={{ gap: 6 }}>
                            <Avatar user={{ name: item.owner_name, avatar_color: item.owner_color }} size={22} />
                            <span className="small truncate">{item.owner_name}</span>
                          </span>
                        ) : (
                          <span className="tiny" style={{ color: 'var(--amber)', fontWeight: 600 }}>No owner</span>
                        )}
                      </td>
                      <td>
                        {editable && status === 'open' ? (
                          <input
                            className="input sm"
                            type="date"
                            value={item.due_date || ''}
                            onChange={(e) => patch(item, { due_date: e.target.value || null })}
                          />
                        ) : due ? (
                          <span className="small" style={{ color: due.tone === 'red' ? 'var(--red)' : 'var(--text-2)' }}>
                            {due.label}
                          </span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={PRIORITY_META[item.priority]?.tone} square>
                          {PRIORITY_META[item.priority]?.label}
                        </Badge>
                      </td>
                      <td>
                        <div
                          className="small"
                          style={{ cursor: 'pointer' }}
                          onClick={() => navigate(`/meetings/${item.meeting_id}`)}
                        >
                          <span className="row" style={{ gap: 5 }}>
                            <Icon name={SOURCE_META[item.source]?.icon || 'chat'} size={12} />
                            <span className="truncate" style={{ maxWidth: 150 }}>{item.meeting_title}</span>
                          </span>
                          <span className="tiny dim">{formatDate(item.occurred_at)}</span>
                        </div>
                      </td>
                      {status === 'open' && (
                        <td>
                          {editable && (
                            <div className="row" style={{ gap: 3 }}>
                              <button
                                className="icon-btn sm"
                                title="Drop — this is not needed after all"
                                onClick={() => patch(item, { status: 'dropped' })}
                              >
                                <Icon name="x" size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
