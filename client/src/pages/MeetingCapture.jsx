import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { Icon } from '../components/icons.jsx';
import {
  Callout, Card, EmptyState, Field, Loading, PRIORITY_META, SOURCE_META, Spinner, todayIso,
} from '../components/ui.jsx';

const EXAMPLE = `Sprint planning — Google Meet

Discussion:
- Login page is slow, about 4 seconds on staging
- Customers want a ticket status filter

Action items:
- Vikram to profile the login endpoint by Friday
- Sneha will build the status filter UI
- Rahul please write regression tests before 25/12, urgent
- Someone needs to document the service ports`;

function localDateTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

/** One extracted action item, fully editable before it is saved. */
function ActionRow({ item, people, onChange, onRemove }) {
  return (
    <div className={`action-row ${item.dropped ? 'dropped' : ''}`}>
      <input
        type="checkbox"
        checked={!item.dropped}
        onChange={(e) => onChange({ ...item, dropped: !e.target.checked })}
        title={item.dropped ? 'Include this item' : 'Ignore this item'}
        style={{ accentColor: 'var(--accent)' }}
      />

      <div style={{ minWidth: 0 }}>
        <input
          className="input sm"
          value={item.text}
          onChange={(e) => onChange({ ...item, text: e.target.value })}
        />
        <div className={`confidence ${item.confidence < 0.7 ? 'low' : ''}`} title={`Confidence ${Math.round(item.confidence * 100)}%`}>
          <span style={{ width: `${item.confidence * 100}%` }} />
        </div>
      </div>

      <select
        className="select sm cell-owner"
        value={item.owner_id || ''}
        onChange={(e) => onChange({ ...item, owner_id: e.target.value ? Number(e.target.value) : null })}
      >
        <option value="">Who owns it?</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>{person.name}</option>
        ))}
      </select>

      <input
        className="input sm cell-due"
        type="date"
        value={item.due_date || ''}
        onChange={(e) => onChange({ ...item, due_date: e.target.value || null })}
        title={item.due_matched ? `Read from “${item.due_matched}”` : 'No date found in the notes'}
      />

      <select
        className="select sm cell-prio"
        value={item.priority}
        onChange={(e) => onChange({ ...item, priority: e.target.value })}
      >
        {Object.entries(PRIORITY_META).map(([value, meta]) => (
          <option key={value} value={value}>{meta.label}</option>
        ))}
      </select>

      <button className="icon-btn sm" onClick={onRemove} title="Remove this row">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

export default function MeetingCapture() {
  const { projects, people, toast, completeJourneyStep, loadWorkspace, orgSettings } = useApp();
  const navigate = useNavigate();

  const writable = projects.filter((p) => p.my_role !== 'viewer' && p.status !== 'archived');

  const [form, setForm] = useState({
    project_id: writable[0]?.id || '',
    title: '',
    source: 'gmeet',
    occurred_at: localDateTime(),
    duration_min: '',
    location: '',
    summary: '',
    decisions: '',
    raw_notes: '',
  });
  const [attendees, setAttendees] = useState([]);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsed, setParsed] = useState(false);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const activePeople = people.filter((p) => p.is_active);

  const findActionItems = async () => {
    if (!form.raw_notes.trim()) {
      toast('Paste the notes first — the parser reads them to find commitments.', 'warn');
      return;
    }
    setParsing(true);
    try {
      const result = await api.post('/meetings/parse', {
        notes: form.raw_notes,
        project_id: form.project_id || undefined,
        occurred_at: form.occurred_at,
      });
      setItems(result.items.map((item, index) => ({ ...item, key: index, dropped: false })));
      setStats(result.stats);
      setParsed(true);
      // Anyone named in the notes was almost certainly in the discussion.
      const named = [...new Set(result.items.map((i) => i.owner_id).filter(Boolean))];
      setAttendees((current) => [...new Set([...current, ...named])]);
      if (!result.items.length) toast('No clear action items found. Add them by hand below.', 'warn');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setParsing(false);
    }
  };

  const addBlankItem = () =>
    setItems((current) => [
      ...current,
      { key: Date.now(), text: '', owner_id: null, due_date: null, priority: 'medium', confidence: 1, dropped: false },
    ]);

  const save = async () => {
    if (!form.title.trim()) return toast('Give the discussion a title.', 'error');
    if (!form.project_id) return toast('Pick a project.', 'error');

    const keep = items.filter((item) => !item.dropped && item.text.trim());
    setSaving(true);
    try {
      const { meeting } = await api.post('/meetings', {
        ...form,
        project_id: Number(form.project_id),
        duration_min: form.duration_min ? Number(form.duration_min) : 0,
        occurred_at: form.occurred_at.replace('T', ' '),
        attendees,
        action_items: keep.map((item) => ({
          text: item.text.trim(),
          owner_id: item.owner_id,
          due_date: item.due_date,
          priority: item.priority,
        })),
      });
      completeJourneyStep('meeting');
      loadWorkspace();
      toast(`Saved with ${keep.length} action item(s).`, 'success');
      navigate(`/meetings/${meeting.id}`);
    } catch (err) {
      toast(err.message, 'error');
      setSaving(false);
    }
  };

  const kept = items.filter((item) => !item.dropped && item.text.trim()).length;
  const unowned = items.filter((item) => !item.dropped && item.text.trim() && !item.owner_id).length;

  if (!writable.length) {
    return (
      <div className="page">
        <EmptyState icon="folder" title="You need a project first">
          Discussions are filed under a project. Ask an administrator to add you to one.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Log a discussion</h1>
          <div className="sub">
            Paste the raw notes exactly as they were written — a WhatsApp export works as-is.
            {orgSettings.app_name} pulls out the commitments so none of them get lost.
          </div>
        </div>
        <button className="btn" onClick={() => navigate('/meetings')} disabled={saving}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? <Spinner /> : <><Icon name="check" size={14} /> Save discussion</>}
        </button>
      </div>

      <div className="grid sidebar-split">
        <div className="col" style={{ gap: 14 }}>
          <Card title="What was discussed" subtitle="Step 1 — paste it in, formatting does not matter.">
            <div className="col" style={{ gap: 12 }}>
              <textarea
                className="textarea notes"
                value={form.raw_notes}
                onChange={set('raw_notes')}
                placeholder={EXAMPLE}
                spellCheck={false}
              />
              <div className="row wrap" style={{ gap: 8 }}>
                <button className="btn primary" onClick={findActionItems} disabled={parsing}>
                  {parsing ? <Spinner /> : <><Icon name="wand" size={14} /> Find action items</>}
                </button>
                <button className="btn" onClick={() => setForm((f) => ({ ...f, raw_notes: EXAMPLE }))}>
                  Use an example
                </button>
                <span className="spacer" />
                {stats && (
                  <span className="tiny dim">
                    Scanned {stats.lines_scanned} lines · found {stats.candidates} · {stats.with_owner} with an owner
                    · {stats.with_due_date} with a date
                  </span>
                )}
              </div>
            </div>
          </Card>

          <Card
            title="Action items"
            subtitle={
              parsed
                ? 'Step 2 — check each row. Uncheck anything that is not really an action.'
                : 'These appear once you run the finder, or you can add them by hand.'
            }
            actions={
              <button className="btn sm" onClick={addBlankItem}>
                <Icon name="plus" size={13} />
                Add row
              </button>
            }
            bodyClass="tight"
          >
            {items.length === 0 ? (
              <EmptyState icon="target" title="No action items yet">
                Paste your notes above and press <strong>Find action items</strong>, or add rows manually.
              </EmptyState>
            ) : (
              <>
                <div className="action-row head">
                  <span />
                  <span>Action</span>
                  <span className="cell-owner">Owner</span>
                  <span className="cell-due">Due</span>
                  <span className="cell-prio">Priority</span>
                  <span />
                </div>
                {items.map((item, index) => (
                  <ActionRow
                    key={item.key}
                    item={item}
                    people={activePeople}
                    onChange={(next) => setItems((current) => current.map((row, i) => (i === index ? next : row)))}
                    onRemove={() => setItems((current) => current.filter((_, i) => i !== index))}
                  />
                ))}
                <div style={{ padding: 12 }}>
                  {unowned > 0 ? (
                    <Callout tone="warn" icon="alert">
                      {unowned} item{unowned === 1 ? ' has' : 's have'} no owner. Unowned items are the ones that get
                      forgotten — assign them now, or the project lead will be nudged about them in a week.
                    </Callout>
                  ) : (
                    <div className="small muted">
                      {kept} action item{kept === 1 ? '' : 's'} will be saved. Owners get notified straight away.
                    </div>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <Card title="Where and when">
            <div className="col" style={{ gap: 12 }}>
              <Field label="Title" required>
                <input className="input" value={form.title} onChange={set('title')} placeholder="Sprint 12 planning" />
              </Field>

              <Field label="Project" required>
                <select className="select" value={form.project_id} onChange={set('project_id')}>
                  {writable.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </Field>

              <Field label="How did you talk?">
                <div className="row wrap" style={{ gap: 6 }}>
                  {Object.entries(SOURCE_META).map(([value, meta]) => (
                    <button
                      key={value}
                      className={`btn sm ${form.source === value ? 'primary' : ''}`}
                      onClick={() => setForm((f) => ({ ...f, source: value }))}
                    >
                      <Icon name={meta.icon} size={13} />
                      {meta.label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="When">
                <input className="input" type="datetime-local" value={form.occurred_at} onChange={set('occurred_at')} />
              </Field>

              <div className="grid c2" style={{ gap: 10 }}>
                <Field label="Length (min)">
                  <input className="input sm" type="number" min="0" value={form.duration_min} onChange={set('duration_min')} placeholder="30" />
                </Field>
                <Field label="Where">
                  <input className="input sm" value={form.location} onChange={set('location')} placeholder="Meet link, room…" />
                </Field>
              </div>
            </div>
          </Card>

          <Card title="Who was there" subtitle="Attendees get a notification when you save.">
            <div className="col" style={{ gap: 6, maxHeight: 240, overflowY: 'auto' }}>
              {activePeople.map((person) => (
                <label className="checkbox" key={person.id}>
                  <input
                    type="checkbox"
                    checked={attendees.includes(person.id)}
                    onChange={(e) =>
                      setAttendees((current) =>
                        e.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id),
                      )
                    }
                  />
                  {person.name}
                  <span className="tiny dim">{person.title}</span>
                </label>
              ))}
            </div>
          </Card>

          <Card title="Summary and decisions" subtitle="Optional, but future-you will be grateful.">
            <div className="col" style={{ gap: 12 }}>
              <Field label="One-line summary">
                <textarea className="textarea" rows={2} value={form.summary} onChange={set('summary')} placeholder="What was the outcome?" />
              </Field>
              <Field label="Decisions made" hint="Things that are now settled, so they do not get re-litigated.">
                <textarea className="textarea" rows={3} value={form.decisions} onChange={set('decisions')} />
              </Field>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
