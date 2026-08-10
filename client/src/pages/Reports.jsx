import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { useFetch } from '../hooks.js';
import { Icon } from '../components/icons.jsx';
import {
  Avatar, BarChart, Card, EmptyState, Loading, PRIORITY_META, STATUS_META,
  StatusPill, formatDate,
} from '../components/ui.jsx';

const RANGES = [
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last year' },
  { value: 0, label: 'All time' },
];

const daysAgo = (n) => {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date.toISOString().slice(0, 10);
};

/** Weekly created-vs-completed columns. */
function ThroughputChart({ rows }) {
  if (!rows.length) return <div className="muted small">No activity in this window.</div>;
  const recent = rows.slice(-14);
  const max = Math.max(1, ...recent.map((row) => Math.max(row.created, row.completed)));

  return (
    <>
      <div className="spark">
        {recent.map((row) => (
          <div className="spark-col" key={row.week} title={`${row.week}: ${row.created} created, ${row.completed} completed`}>
            <div className="spark-bar" style={{ height: `${(row.created / max) * 100}%`, background: 'var(--accent)', opacity: 0.35 }} />
            <div className="spark-bar" style={{ height: `${(row.completed / max) * 100}%`, background: 'var(--green)' }} />
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 14, marginTop: 12 }}>
        <span className="legend-row">
          <span className="swatch" style={{ background: 'var(--accent)', opacity: 0.35 }} />
          Created
        </span>
        <span className="legend-row">
          <span className="swatch" style={{ background: 'var(--green)' }} />
          Completed
        </span>
        <span className="spacer" />
        <span className="tiny dim">{recent.length} week{recent.length === 1 ? '' : 's'}</span>
      </div>
    </>
  );
}

export default function Reports() {
  const { projects, toast } = useApp();
  const navigate = useNavigate();

  const [projectId, setProjectId] = useState('');
  const [rangeDays, setRangeDays] = useState(90);

  const { data, loading } = useFetch('/reports/summary', {
    project_id: projectId || undefined,
    from: rangeDays ? daysAgo(rangeDays) : undefined,
  });

  const download = async () => {
    try {
      const res = await api.raw('/reports/export', { project_id: projectId || undefined });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'infytrack-tasks.csv';
      link.click();
      URL.revokeObjectURL(url);
      toast('Export downloaded.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (loading) return <div className="page"><Loading /></div>;
  if (!data || data.empty) {
    return (
      <div className="page">
        <EmptyState icon="chart" title="Nothing to report yet">
          Reports appear once there are tasks to measure.
        </EmptyState>
      </div>
    );
  }

  const { byStatus, byPriority, workload, throughput, cycleTime, aging, meetings, actionItemFunnel, overdueList } = data;

  const totalTasks = byStatus.reduce((sum, row) => sum + row.count, 0);
  const doneCount = byStatus.find((row) => row.status === 'done')?.count || 0;
  const funnelOpen = actionItemFunnel.find((row) => row.status === 'open')?.count || 0;
  const funnelConverted = actionItemFunnel.find((row) => row.status === 'converted')?.count || 0;
  const funnelDropped = actionItemFunnel.find((row) => row.status === 'dropped')?.count || 0;
  const funnelTotal = funnelOpen + funnelConverted + funnelDropped;
  const meetingTotal = meetings.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Reports</h1>
          <div className="sub">How the work is flowing, who is carrying what, and what is slipping.</div>
        </div>
        <select className="select sm" style={{ width: 180 }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All my projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        <select className="select sm" style={{ width: 150 }} value={rangeDays} onChange={(e) => setRangeDays(Number(e.target.value))}>
          {RANGES.map((range) => (
            <option key={range.value} value={range.value}>{range.label}</option>
          ))}
        </select>
        <button className="btn" onClick={download}>
          <Icon name="download" size={14} />
          Export CSV
        </button>
        <button className="btn" onClick={() => window.print()}>
          <Icon name="file" size={14} />
          Print
        </button>
      </div>

      <div className="grid c4" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="label"><Icon name="list" size={13} />Total tasks</div>
          <div className="value">{totalTasks}</div>
          <div className="foot">{doneCount} done · {totalTasks - doneCount} remaining</div>
        </div>
        <div className="stat">
          <div className="label"><Icon name="clock" size={13} />Average cycle time</div>
          <div className="value">{cycleTime.avg_days ?? '—'}{cycleTime.avg_days ? 'd' : ''}</div>
          <div className="foot">
            {cycleTime.sample ? `across ${cycleTime.sample} completed · longest ${cycleTime.max_days}d` : 'nothing completed yet'}
          </div>
        </div>
        <div className={`stat ${overdueList.length ? 'alert' : 'good'}`}>
          <div className="label"><Icon name="alert" size={13} />Overdue right now</div>
          <div className="value">{overdueList.length}</div>
          <div className="foot">{overdueList.length ? 'listed below' : 'everything on schedule'}</div>
        </div>
        <div className="stat">
          <div className="label"><Icon name="chat" size={13} />Discussions logged</div>
          <div className="value">{meetingTotal}</div>
          <div className="foot">
            {funnelTotal
              ? `${funnelConverted} of ${funnelTotal} action items tracked`
              : 'no action items recorded'}
          </div>
        </div>
      </div>

      <div className="grid c2" style={{ marginBottom: 14 }}>
        <Card title="Throughput" subtitle="Tasks created against tasks completed, by week.">
          <ThroughputChart rows={throughput} />
        </Card>

        <Card title="Action item funnel" subtitle="What happens to the things people agree to in discussions.">
          {funnelTotal === 0 ? (
            <div className="muted small">No action items were captured in this window.</div>
          ) : (
            <>
              <BarChart
                data={[
                  { label: 'Became tasks', value: funnelConverted, color: 'var(--green)' },
                  { label: 'Still open', value: funnelOpen, color: 'var(--amber)' },
                  { label: 'Dropped', value: funnelDropped, color: 'var(--text-3)' },
                ]}
              />
              <div className="divider" />
              <div className="small muted">
                {Math.round((funnelConverted / funnelTotal) * 100)}% of what was agreed became tracked work.
                {funnelOpen > 0 && (
                  <>
                    {' '}
                    <a href="/action-items" onClick={(e) => { e.preventDefault(); navigate('/action-items'); }}>
                      {funnelOpen} still need a decision.
                    </a>
                  </>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      <Card
        title="Who is carrying what"
        subtitle="Open work per person, plus what they finished in this window."
        bodyClass="tight"
        className="grow"
      >
        {workload.length === 0 ? (
          <div style={{ padding: 16 }} className="muted small">Nothing is assigned yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th style={{ width: 200 }}>Open load</th>
                  <th className="num" style={{ width: 80 }}>Open</th>
                  <th className="num" style={{ width: 100 }}>In progress</th>
                  <th className="num" style={{ width: 90 }}>Blocked</th>
                  <th className="num" style={{ width: 90 }}>Overdue</th>
                  <th className="num" style={{ width: 100 }}>Completed</th>
                  <th className="num" style={{ width: 100 }}>Est. hours</th>
                </tr>
              </thead>
              <tbody>
                {workload.map((person) => {
                  const busiest = Math.max(...workload.map((p) => p.open));
                  return (
                    <tr key={person.id}>
                      <td>
                        <span className="row" style={{ gap: 8 }}>
                          <Avatar user={person} size={24} />
                          <span className="strong">{person.name}</span>
                        </span>
                      </td>
                      <td>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{
                              width: `${busiest ? (person.open / busiest) * 100 : 0}%`,
                              background: person.overdue > 0 ? 'var(--red)' : 'var(--accent)',
                            }}
                          />
                        </div>
                      </td>
                      <td className="num strong">{person.open}</td>
                      <td className="num">{person.in_progress}</td>
                      <td className="num" style={{ color: person.blocked ? 'var(--amber)' : undefined }}>{person.blocked}</td>
                      <td className="num" style={{ color: person.overdue ? 'var(--red)' : undefined, fontWeight: person.overdue ? 600 : 400 }}>
                        {person.overdue}
                      </td>
                      <td className="num" style={{ color: 'var(--green)' }}>{person.completed}</td>
                      <td className="num muted">{person.open_hours || 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid c3" style={{ marginTop: 14 }}>
        <Card title="By status">
          <BarChart
            data={byStatus.map((row) => ({
              label: STATUS_META[row.status]?.label || row.status,
              value: row.count,
              color: STATUS_META[row.status]?.color,
            }))}
          />
        </Card>

        <Card title="Open work by priority">
          {byPriority.length ? (
            <BarChart
              data={byPriority.map((row) => ({
                label: PRIORITY_META[row.priority]?.label || row.priority,
                value: row.count,
                color: PRIORITY_META[row.priority]?.color,
              }))}
            />
          ) : (
            <div className="muted small">Nothing open.</div>
          )}
        </Card>

        <Card title="How long open work has been sitting" subtitle="Age since it was created.">
          <BarChart
            data={[
              { label: 'Under a week', value: aging.week_1 || 0, color: 'var(--green)' },
              { label: '1–2 weeks', value: aging.week_2 || 0, color: 'var(--blue)' },
              { label: '2–4 weeks', value: aging.month_1 || 0, color: 'var(--amber)' },
              { label: 'Over a month', value: aging.older || 0, color: 'var(--red)' },
            ]}
          />
        </Card>
      </div>

      {overdueList.length > 0 && (
        <Card
          title={`Overdue tasks (${overdueList.length})`}
          subtitle="Oldest first. Each one needs a new date, a nudge, or closing."
          bodyClass="tight"
          className="grow"
          style={{ marginTop: 14 }}
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Key</th>
                  <th>Title</th>
                  <th style={{ width: 170 }}>Assignee</th>
                  <th style={{ width: 120 }}>Status</th>
                  <th style={{ width: 110 }}>Was due</th>
                  <th className="num" style={{ width: 100 }}>Days late</th>
                </tr>
              </thead>
              <tbody>
                {overdueList.map((task) => (
                  <tr key={task.id} className="clickable" onClick={() => navigate(`/tasks/${task.id}`)}>
                    <td><span className="key-tag">{task.key}</span></td>
                    <td className="truncate" style={{ maxWidth: 420 }}>{task.title}</td>
                    <td>
                      {task.assignee_name ? (
                        <span className="row" style={{ gap: 6 }}>
                          <Avatar user={{ name: task.assignee_name, avatar_color: task.assignee_color }} size={22} />
                          <span className="small">{task.assignee_name}</span>
                        </span>
                      ) : (
                        <span className="tiny" style={{ color: 'var(--amber)' }}>Unassigned</span>
                      )}
                    </td>
                    <td><StatusPill status={task.status} /></td>
                    <td className="small">{formatDate(task.due_date)}</td>
                    <td className="num strong" style={{ color: 'var(--red)' }}>{task.days_late}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
