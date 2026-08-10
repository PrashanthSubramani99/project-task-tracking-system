import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { useFetch } from '../hooks.js';
import { Icon } from '../components/icons.jsx';
import { Avatar, Badge, Card, EmptyState, Loading, relativeTime } from '../components/ui.jsx';

const ENTITY_ICON = {
  task: 'check',
  meeting: 'chat',
  doc: 'book',
  service: 'server',
  project: 'folder',
  user: 'user',
  action_item: 'target',
};

const ENTITY_LABEL = {
  task: 'Task',
  meeting: 'Discussion',
  doc: 'Document',
  service: 'Service',
  project: 'Project',
  user: 'Person',
};

const linkFor = (entry) => {
  switch (entry.entity_type) {
    case 'task': return `/tasks/${entry.entity_id}`;
    case 'meeting': return `/meetings/${entry.entity_id}`;
    case 'doc': return `/docs/${entry.entity_id}`;
    case 'project': return `/projects/${entry.entity_id}`;
    case 'service': return '/services';
    default: return null;
  }
};

/** Group consecutive entries by calendar day for a readable feed. */
function groupByDay(entries) {
  const groups = [];
  for (const entry of entries) {
    const day = String(entry.created_at).slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }
  return groups;
}

const dayLabel = (day) => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long',
  });
};

export default function ActivityLog() {
  const { projects, people } = useApp();
  const navigate = useNavigate();

  const [projectId, setProjectId] = useState('');
  const [actorId, setActorId] = useState('');
  const [entityType, setEntityType] = useState('');
  const [limit, setLimit] = useState(60);

  const { data, loading } = useFetch('/activity', {
    project_id: projectId || undefined,
    actor_id: actorId || undefined,
    entity_type: entityType || undefined,
    limit,
  });

  const activities = data?.activities || [];
  const groups = groupByDay(activities);

  return (
    <div className="page narrow">
      <div className="page-head">
        <div className="grow">
          <h1>Activity log</h1>
          <div className="sub">
            Every change, who made it, and what it was before. Nothing here can be edited.
          </div>
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 14, gap: 8 }}>
        <select className="select sm" style={{ width: 180 }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        <select className="select sm" style={{ width: 170 }} value={actorId} onChange={(e) => setActorId(e.target.value)}>
          <option value="">Anyone</option>
          <option value="me">Just me</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>{person.name}</option>
          ))}
        </select>
        <select className="select sm" style={{ width: 155 }} value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">Everything</option>
          {Object.entries(ENTITY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}s</option>
          ))}
        </select>
        <span className="spacer" />
        <span className="small muted">{data?.total ?? 0} entries</span>
      </div>

      {loading ? (
        <Loading />
      ) : activities.length === 0 ? (
        <Card>
          <EmptyState icon="activity" title="No activity matches these filters">
            Changes to tasks, discussions, documents and services all show up here.
          </EmptyState>
        </Card>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          {groups.map((group) => (
            <Card key={group.day} title={dayLabel(group.day)} bodyClass="tight">
              {group.entries.map((entry) => {
                const link = linkFor(entry);
                return (
                  <div
                    className={`list-item ${link ? '' : 'plain'}`}
                    key={entry.id}
                    onClick={() => link && navigate(link)}
                  >
                    <Avatar user={{ name: entry.actor_name || '?', avatar_color: entry.actor_color }} size={26} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div>
                        <span className="strong">{entry.actor_name || 'Someone'}</span>{' '}
                        <span className="muted">{entry.summary || entry.action}</span>
                      </div>
                      <div className="row wrap tiny dim" style={{ gap: 6, marginTop: 3 }}>
                        <span className="row" style={{ gap: 4 }}>
                          <Icon name={ENTITY_ICON[entry.entity_type] || 'dots'} size={11} />
                          {ENTITY_LABEL[entry.entity_type] || entry.entity_type}
                        </span>
                        {entry.entity_label && <span className="key-tag">{entry.entity_label}</span>}
                        {entry.project_key && <Badge tone="outline" square>{entry.project_key}</Badge>}
                        <span>{relativeTime(entry.created_at)}</span>
                      </div>
                    </div>
                    {entry.field && entry.action === 'updated' && (
                      <span className="change-chip hide-sm" title={`${entry.old_value} → ${entry.new_value}`}>
                        {entry.field}
                      </span>
                    )}
                  </div>
                );
              })}
            </Card>
          ))}

          {activities.length >= limit && (
            <button className="btn block" onClick={() => setLimit((current) => current + 60)}>
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
