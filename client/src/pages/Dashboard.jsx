import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { useFetch } from '../hooks.js';
import { Icon } from '../components/icons.jsx';
import {
  Avatar, BarChart, Card, EmptyState, Loading, PriorityTag, ProgressBar,
  STATUS_META, StatusPill, dueMeta, formatDate, relativeTime,
} from '../components/ui.jsx';

/** The guided first-run journey. Each step links to where the work happens. */
const JOURNEY = [
  { key: 'meeting', label: 'Log your first discussion', hint: 'Paste notes from a call or a WhatsApp thread.', to: '/meetings/new', icon: 'chat' },
  { key: 'convert', label: 'Turn action items into tasks', hint: 'So every commitment has an owner and a date.', to: '/action-items', icon: 'target' },
  { key: 'board', label: 'Move a task on the board', hint: 'Drag between columns to update progress.', to: '/board', icon: 'board' },
  { key: 'doc', label: 'Write down something you keep re-explaining', hint: 'Ports, environments, setup steps.', to: '/docs', icon: 'book' },
  { key: 'people', label: 'Invite the rest of the team', hint: 'Give each person the right level of access.', to: '/people', icon: 'users' },
];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function Stat({ label, value, foot, tone = '', icon, onClick }) {
  return (
    <div className={`stat ${tone} ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <div className="label">
        {icon && <Icon name={icon} size={13} />}
        {label}
      </div>
      <div className="value">{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

function JourneyCard() {
  const { user, completeJourneyStep } = useApp();
  const navigate = useNavigate();
  const journey = user?.journey || {};
  const remaining = JOURNEY.filter((step) => !journey[step.key]);

  if (!remaining.length) return null;

  return (
    <Card
      title="Getting started"
      subtitle={`${JOURNEY.length - remaining.length} of ${JOURNEY.length} done — this card disappears when you finish.`}
    >
      {JOURNEY.map((step) => {
        const done = Boolean(journey[step.key]);
        return (
          <div className={`journey-step ${done ? 'done' : ''}`} key={step.key}>
            <span className="journey-tick">{done ? <Icon name="check" size={11} /> : ''}</span>
            <div className="grow">
              <div className="journey-title strong small">{step.label}</div>
              <div className="tiny dim">{step.hint}</div>
            </div>
            {!done && (
              <div className="row" style={{ gap: 4 }}>
                <button className="btn sm" onClick={() => navigate(step.to)}>
                  <Icon name={step.icon} size={13} />
                  Go
                </button>
                <button
                  className="btn sm ghost"
                  title="Mark as done without visiting"
                  onClick={() => completeJourneyStep(step.key)}
                >
                  <Icon name="check" size={13} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

export default function Dashboard() {
  const { user, projects, canWriteSomewhere } = useApp();
  const navigate = useNavigate();
  const { data, loading } = useFetch('/reports/dashboard');

  if (loading) return <div className="page"><Loading /></div>;
  if (!data) return <div className="page"><EmptyState icon="alert" title="Could not load your dashboard" /></div>;

  const { my, myTasks, myActionItems, team, statusBreakdown, upcoming, recentActivity } = data;
  const openTotal = team.open || 0;
  const completion = team.total ? Math.round((team.done / team.total) * 100) : 0;

  const statusData = Object.keys(STATUS_META)
    .filter((status) => status !== 'cancelled')
    .map((status) => ({
      label: STATUS_META[status].label,
      value: statusBreakdown.find((row) => row.status === status)?.count || 0,
      color: STATUS_META[status].color,
    }))
    .filter((row) => row.value > 0);

  if (!projects.length) {
    return (
      <div className="page">
        <EmptyState
          icon="folder"
          title="You are not on any project yet"
          action={
            <button className="btn primary" onClick={() => navigate('/projects')}>
              Go to projects
            </button>
          }
        >
          Ask an administrator to add you to a project, or create one yourself if you have permission.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>
            {greeting()}, {user.name.split(' ')[0]}
          </h1>
          <div className="sub">
            {my.assigned === 0
              ? 'Nothing is assigned to you right now.'
              : `You have ${my.assigned} open ${my.assigned === 1 ? 'task' : 'tasks'}${
                  my.overdue ? `, ${my.overdue} overdue` : ''
                }.`}
          </div>
        </div>
        {canWriteSomewhere && (
          <button className="btn primary" onClick={() => navigate('/meetings/new')}>
            <Icon name="plus" size={14} />
            Log a discussion
          </button>
        )}
      </div>

      <div className="grid c5" style={{ marginBottom: 16 }}>
        <Stat
          label="Assigned to me" icon="user" value={my.assigned}
          foot={`${my.in_progress} in progress`}
          onClick={() => navigate('/tasks?mine=1')}
        />
        <Stat
          label="Due today" icon="clock" value={my.due_today}
          tone={my.due_today > 0 ? 'alert' : ''}
          foot="across all projects"
          onClick={() => navigate('/tasks?mine=1&sort=due')}
        />
        <Stat
          label="My overdue" icon="alert" value={my.overdue}
          tone={my.overdue > 0 ? 'alert' : ''}
          foot={my.overdue ? 'needs a new date or a push' : 'all on time'}
          onClick={() => navigate('/tasks?mine=1&overdue=1')}
        />
        <Stat
          label="Done this week" icon="check" value={my.done_this_week}
          tone={my.done_this_week > 0 ? 'good' : ''}
          foot="last 7 days"
        />
        <Stat
          label="Open action items" icon="target" value={team.open_action_items}
          tone={team.open_action_items > 0 ? 'alert' : ''}
          foot="not yet tasks"
          onClick={() => navigate('/action-items')}
        />
      </div>

      <div className="grid sidebar-split">
        <div className="col" style={{ gap: 14 }}>
          <Card
            title="My work"
            subtitle="Sorted by deadline, then priority."
            bodyClass="tight"
            actions={
              <Link to="/tasks?mine=1" className="btn sm">
                See all
              </Link>
            }
          >
            {myTasks.length === 0 ? (
              <EmptyState icon="check" title="Your queue is clear">
                Nothing is assigned to you. Pick something up from the board when you are ready.
              </EmptyState>
            ) : (
              myTasks.map((task) => {
                const due = dueMeta(task.due_date, task.status);
                return (
                  <div className="list-item" key={task.id} onClick={() => navigate(`/tasks/${task.id}`)}>
                    <span className="dot" style={{ background: task.project_color }} title={task.project_key} />
                    <span className="key-tag">{task.key}</span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontWeight: 520 }}>{task.title}</div>
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <StatusPill status={task.status} />
                        <PriorityTag priority={task.priority} compact />
                        {due && (
                          <span className={`tiny ${due.tone === 'red' ? 'strong' : ''}`}
                                style={{ color: due.tone === 'red' ? 'var(--red)' : due.tone === 'amber' ? 'var(--amber)' : 'var(--text-3)' }}>
                            {due.label}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ width: 54 }} className="hide-sm">
                      <ProgressBar value={task.progress} tone={task.progress === 100 ? 'green' : ''} />
                    </div>
                  </div>
                );
              })
            )}
          </Card>

          {myActionItems.length > 0 && (
            <Card
              title="Action items you picked up"
              subtitle="Agreed in a discussion, not yet a tracked task."
              bodyClass="tight"
              actions={<Link to="/action-items" className="btn sm">Manage</Link>}
            >
              {myActionItems.map((item) => {
                const due = dueMeta(item.due_date, 'todo');
                return (
                  <div className="list-item" key={item.id} onClick={() => navigate(`/meetings/${item.meeting_id}`)}>
                    <Icon name="target" size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="truncate">{item.text}</div>
                      <div className="tiny dim" style={{ marginTop: 2 }}>
                        From “{item.meeting_title}” · {formatDate(item.occurred_at)}
                      </div>
                    </div>
                    {due && (
                      <span className="tiny nowrap" style={{ color: due.tone === 'red' ? 'var(--red)' : 'var(--text-3)' }}>
                        {due.label}
                      </span>
                    )}
                  </div>
                );
              })}
            </Card>
          )}

          <div className="grid c2">
            <Card title="Where the work sits" subtitle={`${openTotal} open of ${team.total} total`}>
              {statusData.length ? (
                <>
                  <BarChart data={statusData} />
                  <div className="divider" />
                  <div className="row between small muted">
                    <span>Overall completion</span>
                    <span className="strong">{completion}%</span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <ProgressBar value={completion} tone={completion >= 70 ? 'green' : ''} />
                  </div>
                </>
              ) : (
                <div className="muted small">No tasks yet.</div>
              )}
            </Card>

            <Card title="Team health">
              <div className="col" style={{ gap: 11 }}>
                {[
                  { label: 'Overdue tasks', value: team.overdue, tone: team.overdue ? 'var(--red)' : 'var(--green)', to: '/tasks?overdue=1' },
                  { label: 'Blocked', value: team.blocked, tone: team.blocked ? 'var(--amber)' : 'var(--text-2)', to: '/tasks?status=blocked' },
                  { label: 'Unassigned', value: team.unassigned, tone: team.unassigned ? 'var(--amber)' : 'var(--text-2)', to: '/tasks?assignee=none' },
                  { label: 'Action items waiting', value: team.open_action_items, tone: team.open_action_items ? 'var(--accent)' : 'var(--text-2)', to: '/action-items' },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="row between"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(row.to)}
                  >
                    <span className="small muted">{row.label}</span>
                    <span className="strong" style={{ color: row.tone, fontSize: 16 }}>{row.value}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <JourneyCard />

          <Card title="Next 7 days" bodyClass="tight" subtitle={upcoming.length ? undefined : 'Nothing due soon.'}>
            {upcoming.slice(0, 8).map((task) => {
              const due = dueMeta(task.due_date, task.status);
              return (
                <div className="list-item" key={task.id} onClick={() => navigate(`/tasks/${task.id}`)}>
                  <Avatar user={{ name: task.assignee_name || '?', avatar_color: task.assignee_color }} size={22} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="truncate small">{task.title}</div>
                    <div className="tiny dim">{task.project_key} · {task.assignee_name || 'Unassigned'}</div>
                  </div>
                  <span
                    className="tiny nowrap strong"
                    style={{ color: due?.tone === 'red' ? 'var(--red)' : due?.tone === 'amber' ? 'var(--amber)' : 'var(--text-3)' }}
                  >
                    {due?.label}
                  </span>
                </div>
              );
            })}
          </Card>

          <Card
            title="Recent activity"
            bodyClass="tight"
            actions={<Link to="/activity" className="btn sm ghost"><Icon name="arrowRight" size={13} /></Link>}
          >
            <div style={{ padding: '14px 16px' }}>
              <div className="timeline">
                {recentActivity.slice(0, 10).map((entry) => (
                  <div className="timeline-item" key={entry.id}>
                    <div>
                      <span className="strong">{entry.actor_name || 'Someone'}</span>{' '}
                      <span className="muted">{entry.summary}</span>
                    </div>
                    <div className="tiny dim" style={{ marginTop: 2 }}>
                      {entry.project_key && <span className="key-tag" style={{ marginRight: 6 }}>{entry.project_key}</span>}
                      {relativeTime(entry.created_at)}
                    </div>
                  </div>
                ))}
                {recentActivity.length === 0 && <div className="muted small">Nothing has happened yet.</div>}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
