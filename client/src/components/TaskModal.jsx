import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { Field, Modal, Spinner, Callout, PRIORITY_META, STATUS_META, TYPE_META, todayIso } from './ui.jsx';

/**
 * Create a task. Kept deliberately short — title and project are the only
 * required fields, everything else has a sensible default.
 */
export default function TaskModal({ onClose, onCreated, defaults = {} }) {
  const { projects, people, toast } = useApp();
  const writableProjects = projects.filter((p) => p.my_role !== 'viewer' && p.status !== 'archived');

  const [form, setForm] = useState({
    project_id: defaults.project_id || writableProjects[0]?.id || '',
    title: '',
    description: '',
    type: 'task',
    status: defaults.status || 'todo',
    priority: 'medium',
    assignee_id: defaults.assignee_id || '',
    due_date: '',
    estimate_h: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const members = people.filter((p) => p.is_active);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) return setError('Give the task a title.');
    if (!form.project_id) return setError('Pick a project.');

    setBusy(true);
    setError('');
    try {
      const payload = {
        ...form,
        project_id: Number(form.project_id),
        assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
        estimate_h: form.estimate_h ? Number(form.estimate_h) : 0,
        due_date: form.due_date || null,
      };
      const { task } = await api.post('/tasks', payload);
      toast(`${task.key} created.`, 'success');
      onCreated?.(task);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New task"
      subtitle="Only the title and project are required."
      onClose={onClose}
      width="wide"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : 'Create task'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="col" style={{ gap: 14 }}>
        <Field label="Title" required>
          <input
            className="input"
            value={form.title}
            onChange={set('title')}
            placeholder="What needs to happen?"
            autoFocus
          />
        </Field>

        <Field label="Details" hint="Context, links, acceptance criteria — anything the assignee will need.">
          <textarea className="textarea" value={form.description} onChange={set('description')} rows={4} />
        </Field>

        <div className="grid c2">
          <Field label="Project" required>
            <select className="select" value={form.project_id} onChange={set('project_id')}>
              {writableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assign to" hint="Leave empty to decide later.">
            <select className="select" value={form.assignee_id} onChange={set('assignee_id')}>
              <option value="">Unassigned</option>
              {members.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid c4">
          <Field label="Type">
            <select className="select" value={form.type} onChange={set('type')}>
              {Object.entries(TYPE_META).map(([value, meta]) => (
                <option key={value} value={value}>{meta.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className="select" value={form.status} onChange={set('status')}>
              {Object.entries(STATUS_META)
                .filter(([value]) => value !== 'cancelled')
                .map(([value, meta]) => (
                  <option key={value} value={value}>{meta.label}</option>
                ))}
            </select>
          </Field>
          <Field label="Priority">
            <select className="select" value={form.priority} onChange={set('priority')}>
              {Object.entries(PRIORITY_META).map(([value, meta]) => (
                <option key={value} value={value}>{meta.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input className="input" type="date" value={form.due_date} min={todayIso()} onChange={set('due_date')} />
          </Field>
        </div>

        {error && <Callout tone="danger" icon="alert">{error}</Callout>}
      </form>
    </Modal>
  );
}
