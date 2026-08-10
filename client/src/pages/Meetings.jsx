import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { useDebounced, useFetch } from '../hooks.js';
import { Icon } from '../components/icons.jsx';
import {
  Badge, Card, EmptyState, Loading, SOURCE_META, SearchInput, formatDate, relativeTime,
} from '../components/ui.jsx';

export default function Meetings() {
  const { projects, canWriteSomewhere } = useApp();
  const navigate = useNavigate();

  const [projectId, setProjectId] = useState('');
  const [source, setSource] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 280);

  const { data, loading } = useFetch('/meetings', {
    project_id: projectId || undefined,
    source: source || undefined,
    has_open_actions: openOnly ? 'true' : undefined,
    q: debounced || undefined,
  });

  const meetings = data?.meetings || [];

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Discussions</h1>
          <div className="sub">
            Every call, chat and meetup, with the notes and what everyone agreed to do.
          </div>
        </div>
        {canWriteSomewhere && (
          <button className="btn primary" onClick={() => navigate('/meetings/new')}>
            <Icon name="plus" size={14} />
            Log a discussion
          </button>
        )}
      </div>

      <div className="row wrap" style={{ marginBottom: 14, gap: 8 }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search titles and notes…" style={{ width: 260 }} />

        <select className="select sm" style={{ width: 180 }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>

        <select className="select sm" style={{ width: 160 }} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Any channel</option>
          {Object.entries(SOURCE_META).map(([value, meta]) => (
            <option key={value} value={value}>{meta.label}</option>
          ))}
        </select>

        <label className="checkbox small">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Has open action items
        </label>

        <span className="spacer" />
        <span className="small muted">{meetings.length} logged</span>
      </div>

      {loading ? (
        <Loading />
      ) : meetings.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="chat"
            title="No discussions logged yet"
            action={
              canWriteSomewhere && (
                <button className="btn primary" onClick={() => navigate('/meetings/new')}>
                  Log your first discussion
                </button>
              )
            }
          >
            After your next call, paste the notes here. TeamTrack will pull out the action items and make sure
            each one has an owner and a date.
          </EmptyState>
        </div>
      ) : (
        <div className="grid c2">
          {meetings.map((meeting) => {
            const meta = SOURCE_META[meeting.source] || SOURCE_META.other;
            return (
              <Card key={meeting.id} className="clickable">
                <div style={{ cursor: 'pointer' }} onClick={() => navigate(`/meetings/${meeting.id}`)}>
                  <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                    <span className="dot" style={{ background: meeting.project_color }} />
                    <span className="key-tag">{meeting.project_key}</span>
                    <Badge tone="outline" square>
                      <Icon name={meta.icon} size={11} />
                      {meta.label}
                    </Badge>
                    <span className="spacer" />
                    <span className="tiny dim">{formatDate(meeting.occurred_at, { withTime: true })}</span>
                  </div>

                  <h3 style={{ marginBottom: 5 }}>{meeting.title}</h3>
                  <p className="small muted" style={{ marginBottom: 12 }}>
                    {meeting.summary || 'No summary was written for this one.'}
                  </p>

                  <div className="row wrap" style={{ gap: 8 }}>
                    {meeting.open_action_count > 0 ? (
                      <Badge tone="red" square>
                        <Icon name="target" size={11} />
                        {meeting.open_action_count} still open
                      </Badge>
                    ) : meeting.action_count > 0 ? (
                      <Badge tone="green" square>
                        <Icon name="check" size={11} />
                        All {meeting.action_count} handled
                      </Badge>
                    ) : (
                      <Badge tone="outline" square>No action items</Badge>
                    )}

                    <span className="tiny dim row" style={{ gap: 4 }}>
                      <Icon name="users" size={11} />
                      {meeting.attendee_count}
                    </span>

                    <span className="spacer" />
                    <span className="tiny dim">
                      by {meeting.created_by_name} · {relativeTime(meeting.created_at)}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
