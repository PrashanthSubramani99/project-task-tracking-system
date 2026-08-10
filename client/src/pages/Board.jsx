import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { useLocalState } from '../hooks.js';
import { Icon } from '../components/icons.jsx';
import TaskModal from '../components/TaskModal.jsx';
import {
  Avatar, EmptyState, Loading, PriorityTag, STATUS_META, SearchInput, dueMeta,
} from '../components/ui.jsx';

function TaskCard({ task, onOpen, onDragStart, dragging, draggable = true }) {
  const due = dueMeta(task.due_date, task.status);
  return (
    <article
      className={`task-card ${dragging ? 'dragging' : ''}`}
      draggable={draggable}
      style={draggable ? undefined : { cursor: 'pointer' }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(task.id));
        onDragStart(task);
      }}
      onClick={() => onOpen(task)}
    >
      <div className="row" style={{ gap: 6 }}>
        <span className="key-tag">{task.key}</span>
        <PriorityTag priority={task.priority} compact />
        {task.type === 'action' && (
          <span title="Came from a discussion" style={{ color: 'var(--accent)', display: 'inline-flex' }}>
            <Icon name="target" size={12} />
          </span>
        )}
        {task.type === 'bug' && (
          <span title="Bug" style={{ color: 'var(--red)', display: 'inline-flex' }}>
            <Icon name="bug" size={12} />
          </span>
        )}
        <span className="spacer" />
        {task.comment_count > 0 && (
          <span className="tiny dim row" style={{ gap: 3 }}>
            <Icon name="chat" size={11} />
            {task.comment_count}
          </span>
        )}
      </div>

      <div className="title">{task.title}</div>

      <div className="meta">
        {task.assignee_id ? (
          <Avatar user={{ name: task.assignee_name, avatar_color: task.assignee_color }} size={20} />
        ) : (
          <span className="tiny dim row" style={{ gap: 3 }}>
            <Icon name="user" size={11} /> Unassigned
          </span>
        )}
        {due && (
          <span
            className="tiny nowrap"
            style={{
              color: due.tone === 'red' ? 'var(--red)' : due.tone === 'amber' ? 'var(--amber)' : 'var(--text-3)',
              fontWeight: due.tone ? 600 : 400,
            }}
          >
            {due.label}
          </span>
        )}
        <span className="spacer" />
        {task.subtask_count > 0 && (
          <span className="tiny dim">{task.subtask_done}/{task.subtask_count}</span>
        )}
        <span className="dot" style={{ background: task.project_color }} title={task.project_name} />
      </div>
    </article>
  );
}

export default function Board() {
  const { projects, people, toast, can, completeJourneyStep, canWriteSomewhere } = useApp();
  const navigate = useNavigate();

  const [projectId, setProjectId] = useLocalState('board.project', '');
  const [assignee, setAssignee] = useLocalState('board.assignee', '');
  const [priority, setPriority] = useLocalState('board.priority', '');
  const [query, setQuery] = useState('');
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragTask, setDragTask] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [creating, setCreating] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/tasks/board', {
        project_id: projectId || undefined,
        assignee_id: assignee || undefined,
        priority: priority || undefined,
        q: query || undefined,
      });
      setColumns(data.columns || []);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [projectId, assignee, priority, query, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const drop = async (status) => {
    setDragOver(null);
    const task = dragTask;
    setDragTask(null);
    if (!task || task.status === status) return;

    if (!can('task.transition', task.project_id)) {
      toast('You do not have permission to move tasks in this project.', 'error');
      return;
    }

    // Optimistic move so the board feels instant, rolled back on failure.
    const snapshot = columns;
    setColumns((current) =>
      current.map((column) => {
        if (column.status === task.status) return { ...column, tasks: column.tasks.filter((t) => t.id !== task.id) };
        if (column.status === status) return { ...column, tasks: [{ ...task, status }, ...column.tasks] };
        return column;
      }),
    );

    try {
      await api.post(`/tasks/${task.id}/move`, { status });
      completeJourneyStep('board');
      toast(`${task.key} moved to ${STATUS_META[status].label}.`, 'success');
      load();
    } catch (err) {
      setColumns(snapshot);
      toast(err.message, 'error');
    }
  };

  const total = columns.reduce((sum, column) => sum + column.tasks.length, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Board</h1>
          <div className="sub">Drag a card to another column to update its status. Everyone watching gets told.</div>
        </div>
        {canWriteSomewhere && (
          <button className="btn primary" onClick={() => setCreating({})}>
            <Icon name="plus" size={14} />
            New task
          </button>
        )}
      </div>

      <div className="row wrap" style={{ marginBottom: 14, gap: 8 }}>
        <select className="select sm" style={{ width: 190 }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>

        <select className="select sm" style={{ width: 165 }} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Everyone</option>
          <option value="me">Just mine</option>
          {people.filter((p) => p.is_active).map((person) => (
            <option key={person.id} value={person.id}>{person.name}</option>
          ))}
        </select>

        <select className="select sm" style={{ width: 140 }} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Any priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <SearchInput value={query} onChange={setQuery} placeholder="Search title or key…" style={{ width: 230 }} />

        <span className="spacer" />
        <span className="small muted">{total} {total === 1 ? 'task' : 'tasks'}</span>
      </div>

      {loading ? (
        <Loading />
      ) : total === 0 ? (
        <div className="card">
          <EmptyState
            icon="board"
            title="No tasks match this view"
            action={canWriteSomewhere && <button className="btn primary" onClick={() => setCreating({})}>Create the first task</button>}
          >
            Clear the filters above, or create a task. Action items from your discussions can also be converted
            into tasks in one click.
          </EmptyState>
        </div>
      ) : (
        <div className="board">
          {columns.map((column) => (
            <section
              key={column.status}
              className={`board-col ${dragOver === column.status ? 'drag-over' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                if (dragOver !== column.status) setDragOver(column.status);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                drop(column.status);
              }}
            >
              <header className="board-col-head">
                <span className="dot" style={{ background: STATUS_META[column.status].color }} />
                {column.label}
                <span className="badge sq">{column.tasks.length}</span>
                <span className="spacer" />
                {canWriteSomewhere && (
                  <button
                    className="icon-btn sm"
                    title={`Add a task in ${column.label}`}
                    onClick={() => setCreating({ status: column.status, project_id: projectId || undefined })}
                  >
                    <Icon name="plus" size={14} />
                  </button>
                )}
              </header>

              <div className="board-col-body">
                {column.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    dragging={dragTask?.id === task.id}
                    draggable={can('task.transition', task.project_id)}
                    onDragStart={setDragTask}
                    onOpen={() => navigate(`/tasks/${task.id}`)}
                  />
                ))}
                {column.tasks.length === 0 && (
                  <div className="tiny dim center" style={{ padding: '18px 8px' }}>
                    Drop a card here
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {creating && (
        <TaskModal
          defaults={creating}
          onClose={() => setCreating(null)}
          onCreated={load}
        />
      )}
    </div>
  );
}
