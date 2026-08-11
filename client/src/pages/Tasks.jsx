import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { useDebounced } from '../hooks.js';
import { Icon } from '../components/icons.jsx';
import TaskModal from '../components/TaskModal.jsx';
import {
  Avatar, EmptyState, Loading, Pagination, PRIORITY_META, PriorityTag, ProgressBar,
  STATUS_META, SearchInput, StatusPill, TYPE_META, dueMeta, formatDate, relativeTime,
} from '../components/ui.jsx';

const SORTS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'created', label: 'Newest' },
  { value: 'key', label: 'Task key' },
];

export default function Tasks() {
  const { projects, people, toast, user, canWriteSomewhere } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [filters, setFilters] = useState(() => ({
    project_id: params.get('project') || '',
    status: params.get('status') || '',
    priority: params.get('priority') || '',
    type: params.get('type') || '',
    assignee_id: params.get('mine') === '1' ? 'me' : params.get('assignee') || '',
    open: params.get('open') === '1',
    overdue: params.get('overdue') === '1',
    sort: params.get('sort') || 'updated',
  }));
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 280);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  const [data, setData] = useState({ tasks: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [creating, setCreating] = useState(params.get('new') === '1');

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setFilters((f) => ({ ...f, [key]: value }));
    setSelected(new Set());
    setPage(1);
  };

  // Any filter or search change invalidates the current page.
  useEffect(() => setPage(1), [debouncedQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get('/tasks', {
        project_id: filters.project_id || undefined,
        status: filters.status || undefined,
        priority: filters.priority || undefined,
        type: filters.type || undefined,
        assignee_id: filters.assignee_id || undefined,
        open: filters.open ? 'true' : undefined,
        overdue: filters.overdue ? 'true' : undefined,
        sort: filters.sort,
        q: debouncedQuery || undefined,
        page,
        limit,
      });
      setData(result);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, debouncedQuery, page, limit, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the URL in step so a filtered list can be shared or bookmarked.
  useEffect(() => {
    const next = {};
    if (filters.project_id) next.project = filters.project_id;
    if (filters.status) next.status = filters.status;
    if (filters.priority) next.priority = filters.priority;
    if (filters.assignee_id === 'me') next.mine = '1';
    else if (filters.assignee_id) next.assignee = filters.assignee_id;
    if (filters.open) next.open = '1';
    if (filters.overdue) next.overdue = '1';
    if (filters.sort !== 'updated') next.sort = filters.sort;
    setParams(next, { replace: true });
  }, [filters, setParams]);

  const tasks = data.tasks || [];
  const activeFilters = useMemo(
    () =>
      [filters.project_id, filters.status, filters.priority, filters.type, filters.assignee_id, filters.open, filters.overdue]
        .filter(Boolean).length,
    [filters],
  );

  const toggle = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkUpdate = async (patch) => {
    try {
      const result = await api.post('/tasks/bulk', { ids: [...selected], patch });
      toast(
        `Updated ${result.updated} task(s).${result.skipped?.length ? ` Skipped ${result.skipped.join(', ')} — no permission.` : ''}`,
        result.skipped?.length ? 'warn' : 'success',
      );
      setSelected(new Set());
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const clearFilters = () =>
    setFilters({ project_id: '', status: '', priority: '', type: '', assignee_id: '', open: false, overdue: false, sort: 'updated' });

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Tasks</h1>
          <div className="sub">
            Every piece of tracked work. Filter it down, then update several at once.
          </div>
        </div>
        <a
          className="btn"
          href={`/api/reports/export${filters.project_id ? `?project_id=${filters.project_id}` : ''}`}
          onClick={(event) => {
            // The export endpoint needs the bearer token, so fetch and save it.
            event.preventDefault();
            api
              .raw('/reports/export', { project_id: filters.project_id || undefined })
              .then((res) => res.blob())
              .then((blob) => {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'infytrack-tasks.csv';
                link.click();
                URL.revokeObjectURL(url);
              })
              .catch((err) => toast(err.message, 'error'));
          }}
        >
          <Icon name="download" size={14} />
          Export CSV
        </a>
        {canWriteSomewhere && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} />
            New task
          </button>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body" style={{ padding: 12 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <SearchInput value={query} onChange={setQuery} placeholder="Search title, description or key…" style={{ width: 260 }} />

            <select className="select sm" style={{ width: 170 }} value={filters.project_id} onChange={set('project_id')}>
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>

            <select className="select sm" style={{ width: 145 }} value={filters.status} onChange={set('status')}>
              <option value="">Any status</option>
              {Object.entries(STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>{meta.label}</option>
              ))}
            </select>

            <select className="select sm" style={{ width: 135 }} value={filters.priority} onChange={set('priority')}>
              <option value="">Any priority</option>
              {Object.entries(PRIORITY_META).map(([value, meta]) => (
                <option key={value} value={value}>{meta.label}</option>
              ))}
            </select>

            <select className="select sm" style={{ width: 160 }} value={filters.assignee_id} onChange={set('assignee_id')}>
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              <option value="none">Unassigned</option>
              {people.filter((p) => p.is_active).map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </select>

            <select className="select sm" style={{ width: 160 }} value={filters.sort} onChange={set('sort')}>
              {SORTS.map((sort) => (
                <option key={sort.value} value={sort.value}>{sort.label}</option>
              ))}
            </select>

            <label className="checkbox small">
              <input type="checkbox" checked={filters.open} onChange={set('open')} />
              Open only
            </label>
            <label className="checkbox small">
              <input type="checkbox" checked={filters.overdue} onChange={set('overdue')} />
              Overdue
            </label>

            {activeFilters > 0 && (
              <button className="btn sm ghost" onClick={clearFilters}>
                <Icon name="x" size={13} />
                Clear
              </button>
            )}

            <span className="spacer" />
            <span className="small muted nowrap">{data.total} result{data.total === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--accent)' }}>
          <div className="card-body row wrap" style={{ padding: 10, gap: 8 }}>
            <span className="strong small">{selected.size} selected</span>
            <span className="divider" style={{ width: 1, height: 20, margin: '0 4px' }} />

            <select className="select sm" style={{ width: 150 }} defaultValue="" onChange={(e) => e.target.value && bulkUpdate({ status: e.target.value })}>
              <option value="">Set status…</option>
              {Object.entries(STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>{meta.label}</option>
              ))}
            </select>

            <select className="select sm" style={{ width: 150 }} defaultValue="" onChange={(e) => e.target.value && bulkUpdate({ priority: e.target.value })}>
              <option value="">Set priority…</option>
              {Object.entries(PRIORITY_META).map(([value, meta]) => (
                <option key={value} value={value}>{meta.label}</option>
              ))}
            </select>

            <select className="select sm" style={{ width: 165 }} defaultValue="" onChange={(e) => e.target.value && bulkUpdate({ assignee_id: Number(e.target.value) })}>
              <option value="">Assign to…</option>
              {people.filter((p) => p.is_active).map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </select>

            <button className="btn sm" onClick={() => bulkUpdate({ assignee_id: user.id })}>
              Assign to me
            </button>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <Loading />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon="list"
            title="Nothing matches these filters"
            action={
              activeFilters ? (
                <button className="btn" onClick={clearFilters}>Clear filters</button>
              ) : (
                canWriteSomewhere && <button className="btn primary" onClick={() => setCreating(true)}>Create a task</button>
              )
            }
          >
            {activeFilters
              ? 'Try widening the filters above.'
              : 'Tasks can be created directly, or promoted from the action items of a discussion.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={selected.size === tasks.length && tasks.length > 0}
                      onChange={(e) => setSelected(e.target.checked ? new Set(tasks.map((t) => t.id)) : new Set())}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                  </th>
                  <th style={{ width: 96 }}>Key</th>
                  <th>Title</th>
                  <th style={{ width: 128 }}>Status</th>
                  <th style={{ width: 92 }}>Priority</th>
                  <th style={{ width: 168 }}>Assignee</th>
                  <th style={{ width: 122 }}>Due</th>
                  <th style={{ width: 82 }}>Progress</th>
                  <th style={{ width: 96 }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const due = dueMeta(task.due_date, task.status);
                  return (
                    <tr key={task.id} className="clickable" onClick={() => navigate(`/tasks/${task.id}`)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(task.id)}
                          onChange={() => toggle(task.id)}
                          style={{ accentColor: 'var(--accent)' }}
                        />
                      </td>
                      <td>
                        <span className="row" style={{ gap: 5 }}>
                          <span className="dot" style={{ background: task.project_color }} title={task.project_name} />
                          <span className="key-tag">{task.key}</span>
                        </span>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <Icon
                            name={TYPE_META[task.type]?.icon || 'check'}
                            size={13}
                            style={{ color: task.type === 'bug' ? 'var(--red)' : task.type === 'action' ? 'var(--accent)' : 'var(--text-3)', flexShrink: 0 }}
                          />
                          <span className="truncate" style={{ maxWidth: 460, fontWeight: 500 }}>{task.title}</span>
                          {task.labels?.map((label) => (
                            <span className="badge sq outline tiny" key={label}>{label}</span>
                          ))}
                        </div>
                      </td>
                      <td><StatusPill status={task.status} /></td>
                      <td><PriorityTag priority={task.priority} /></td>
                      <td>
                        {task.assignee_id ? (
                          <span className="row" style={{ gap: 6 }}>
                            <Avatar user={{ name: task.assignee_name, avatar_color: task.assignee_color }} size={22} />
                            <span className="truncate small">{task.assignee_name}</span>
                          </span>
                        ) : (
                          <span className="tiny dim">Unassigned</span>
                        )}
                      </td>
                      <td>
                        {due ? (
                          <span
                            className="small nowrap"
                            style={{
                              color: due.tone === 'red' ? 'var(--red)' : due.tone === 'amber' ? 'var(--amber)' : 'var(--text-2)',
                              fontWeight: due.tone ? 600 : 400,
                            }}
                          >
                            {due.overdue ? due.label : formatDate(task.due_date)}
                          </span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td>
                        <ProgressBar value={task.progress} tone={task.progress === 100 ? 'green' : ''} />
                      </td>
                      <td className="tiny dim nowrap">{relativeTime(task.updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && tasks.length > 0 && (
          <Pagination page={page} limit={limit} total={data.total} onPageChange={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} />
        )}
      </div>

      {creating && (
        <TaskModal
          defaults={{ project_id: filters.project_id || undefined }}
          onClose={() => {
            setCreating(false);
            params.delete('new');
            setParams(params, { replace: true });
          }}
          onCreated={load}
        />
      )}
    </div>
  );
}
