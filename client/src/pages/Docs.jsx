import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { useDebounced, useFetch } from '../hooks.js';
import { Icon } from '../components/icons.jsx';
import {
  Badge, Callout, Card, ConfirmDialog, DOC_CATEGORY_META, EmptyState, Field, Loading,
  Markdown, Modal, SearchInput, Spinner, relativeTime,
} from '../components/ui.jsx';

const TEMPLATES = {
  runbook: `# What this covers

Short description of the system or process.

## Before you start

- Access you need
- Where to run it from

## Steps

1. First step
2. Second step

## If it goes wrong

| Symptom | Likely cause | Fix |
| --- | --- | --- |
|  |  |  |`,
  how_to: `# Goal

What you will have at the end.

## Steps

1.
2.
3.

## Notes
`,
  decision: `# Decision

What we decided.

## Context

What made this come up.

## Options considered

- Option A —
- Option B —

## Consequences

What this commits us to.`,
  onboarding: `# Day one

1. Accounts and access
2. Local setup
3. Read these first

## Who to ask
`,
  spec: `# Overview

## Requirements

## Out of scope

## Open questions
`,
  other: '',
};

function DocEditor({ doc, onClose, onSaved }) {
  const { projects, toast } = useApp();
  const writable = projects.filter((p) => p.my_role !== 'viewer');

  const [form, setForm] = useState({
    project_id: doc?.project_id || writable[0]?.id || '',
    title: doc?.title || '',
    category: doc?.category || 'runbook',
    body: doc?.body || TEMPLATES.runbook,
    tags: (doc?.tags || []).join(', '),
    pinned: Boolean(doc?.pinned),
  });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const save = async () => {
    if (!form.title.trim()) return toast('Give the document a title.', 'error');
    setBusy(true);
    try {
      const payload = {
        ...form,
        project_id: Number(form.project_id),
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        pinned: form.pinned,
      };
      const result = doc ? await api.patch(`/docs/${doc.id}`, payload) : await api.post('/docs', payload);
      toast(doc ? 'Document updated.' : 'Document created.', 'success');
      onSaved(result.doc);
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={doc ? 'Edit document' : 'New document'}
      subtitle="Markdown is supported — headings, lists, tables and code."
      width="xwide"
      onClose={onClose}
      footer={
        <>
          <label className="checkbox grow">
            <input type="checkbox" checked={form.pinned} onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))} />
            Pin to the top
          </label>
          <button className="btn" onClick={() => setPreview((v) => !v)}>
            <Icon name="eye" size={14} />
            {preview ? 'Write' : 'Preview'}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid c3" style={{ gap: 12 }}>
        <Field label="Title" required>
          <input className="input" value={form.title} onChange={set('title')} placeholder="Environment and port map" autoFocus />
        </Field>
        <Field label="Project">
          <select className="select" value={form.project_id} onChange={set('project_id')}>
            {writable.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select
            className="select"
            value={form.category}
            onChange={(event) => {
              const category = event.target.value;
              setForm((f) => ({
                ...f,
                category,
                // Only swap in a template when the author has not written yet.
                body: !f.body.trim() || Object.values(TEMPLATES).includes(f.body) ? TEMPLATES[category] : f.body,
              }));
            }}
          >
            {Object.entries(DOC_CATEGORY_META).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Tags" hint="Comma separated, e.g. ports, staging, deploy">
        <input className="input" value={form.tags} onChange={set('tags')} />
      </Field>

      <Field label="Content">
        {preview ? (
          <div className="card" style={{ padding: 16, minHeight: 320, maxHeight: 420, overflowY: 'auto' }}>
            <Markdown>{form.body}</Markdown>
          </div>
        ) : (
          <textarea className="textarea" style={{ minHeight: 320, fontFamily: 'var(--mono)', fontSize: 13 }}
                    value={form.body} onChange={set('body')} spellCheck={false} />
        )}
      </Field>
    </Modal>
  );
}

export default function Docs() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { projects, toast, can, completeJourneyStep } = useApp();

  const [projectId, setProjectId] = useState('');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 280);
  const [selectedId, setSelectedId] = useState(id ? Number(id) : null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, loading, reload } = useFetch('/docs', {
    project_id: projectId || undefined,
    category: category || undefined,
    q: debounced || undefined,
  });

  const docs = data?.docs || [];
  const selected = docs.find((doc) => doc.id === selectedId) || null;

  useEffect(() => {
    if (!selectedId && docs.length) setSelectedId(docs[0].id);
  }, [docs, selectedId]);

  const canWrite = projects.some((p) => p.my_role && p.my_role !== 'viewer') || can('doc.create');

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Documentation</h1>
          <div className="sub">
            The things you keep re-explaining: setup steps, environments, decisions, how-tos.
          </div>
        </div>
        {canWrite && (
          <button
            className="btn primary"
            onClick={() => { setCreating(true); completeJourneyStep('doc'); }}
          >
            <Icon name="plus" size={14} />
            New document
          </button>
        )}
      </div>

      <div className="row wrap" style={{ marginBottom: 14, gap: 8 }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search titles and contents…" style={{ width: 260 }} />
        <select className="select sm" style={{ width: 180 }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        <select className="select sm" style={{ width: 170 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Any category</option>
          {Object.entries(DOC_CATEGORY_META).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <span className="spacer" />
        <span className="small muted">{docs.length} document{docs.length === 1 ? '' : 's'}</span>
      </div>

      {loading ? (
        <Loading />
      ) : docs.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="book"
            title="Nothing written down yet"
            action={canWrite && <button className="btn primary" onClick={() => setCreating(true)}>Write the first one</button>}
          >
            Start with whatever you explain most often — how to run the app locally, which port each service uses,
            or why you settled on something.
          </EmptyState>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: '292px minmax(0, 1fr)', alignItems: 'start' }}>
          <Card bodyClass="tight" className="hide-sm">
            <div style={{ maxHeight: 'calc(100vh - 230px)', overflowY: 'auto' }}>
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className="list-item"
                  style={{
                    background: doc.id === selectedId ? 'var(--accent-soft)' : undefined,
                    borderLeft: doc.id === selectedId ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                  onClick={() => { setSelectedId(doc.id); navigate(`/docs/${doc.id}`, { replace: true }); }}
                >
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 5 }}>
                      {Boolean(doc.pinned) && <Icon name="pin" size={11} style={{ color: 'var(--amber)' }} />}
                      <span className="truncate small strong">{doc.title}</span>
                    </div>
                    <div className="tiny dim truncate" style={{ marginTop: 2 }}>
                      {DOC_CATEGORY_META[doc.category]} · {doc.project_key} · {relativeTime(doc.updated_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div>
            {selected ? (
              <Card>
                <div className="row wrap" style={{ marginBottom: 14, gap: 8 }}>
                  <div className="grow">
                    <h2>{selected.title}</h2>
                    <div className="row wrap tiny dim" style={{ gap: 8, marginTop: 5 }}>
                      <Badge tone="outline" square>{DOC_CATEGORY_META[selected.category]}</Badge>
                      <span className="key-tag">{selected.project_key}</span>
                      <span>Updated by {selected.updated_by_name} · {relativeTime(selected.updated_at)}</span>
                      {selected.tags?.map((tag) => (
                        <Badge key={tag} square>{tag}</Badge>
                      ))}
                    </div>
                  </div>
                  {can('doc.edit', selected.project_id) && (
                    <button className="btn sm" onClick={() => setEditing(selected)}>
                      <Icon name="edit" size={13} />
                      Edit
                    </button>
                  )}
                  {can('doc.delete', selected.project_id) && (
                    <button className="btn sm danger" onClick={() => setConfirmDelete(true)}>
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>

                {selected.category === 'runbook' && (
                  <div style={{ marginBottom: 14 }}>
                    <Callout icon="info">
                      Ports and hosts live in <a href="/services">Ports &amp; services</a> — that page is the source
                      of truth. Use this document for the reasoning around them.
                    </Callout>
                  </div>
                )}

                <Markdown>{selected.body || '_This document is empty._'}</Markdown>
              </Card>
            ) : (
              <Card><EmptyState icon="book" title="Pick a document on the left" /></Card>
            )}
          </div>
        </div>
      )}

      {(creating || editing) && (
        <DocEditor
          doc={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(doc) => { reload({ quiet: true }); setSelectedId(doc.id); }}
        />
      )}

      {confirmDelete && selected && (
        <ConfirmDialog
          title={`Delete “${selected.title}”?`}
          message="The document will be removed for everyone."
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await api.del(`/docs/${selected.id}`);
            toast('Document deleted.', 'success');
            setSelectedId(null);
            reload({ quiet: true });
          }}
        />
      )}
    </div>
  );
}
