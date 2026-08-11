import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';

// ------------------------------------------------------------ vocabulary --

export const STATUS_META = {
  backlog:     { label: 'Backlog',     tone: 'slate',  color: 'var(--slate)' },
  todo:        { label: 'To do',       tone: '',       color: 'var(--text-2)' },
  in_progress: { label: 'In progress', tone: 'blue',   color: 'var(--blue)' },
  in_review:   { label: 'In review',   tone: 'purple', color: 'var(--purple)' },
  blocked:     { label: 'Blocked',     tone: 'red',    color: 'var(--red)' },
  done:        { label: 'Done',        tone: 'green',  color: 'var(--green)' },
  cancelled:   { label: 'Cancelled',   tone: 'slate',  color: 'var(--text-3)' },
};

export const PRIORITY_META = {
  urgent: { label: 'Urgent', tone: 'red',   color: 'var(--red)' },
  high:   { label: 'High',   tone: 'amber', color: 'var(--amber)' },
  medium: { label: 'Medium', tone: 'blue',  color: 'var(--blue)' },
  low:    { label: 'Low',    tone: 'slate', color: 'var(--slate)' },
};

export const TYPE_META = {
  task:        { label: 'Task',        icon: 'check' },
  bug:         { label: 'Bug',         icon: 'bug' },
  improvement: { label: 'Improvement', icon: 'spark' },
  action:      { label: 'Action item', icon: 'target' },
  doc:         { label: 'Document',    icon: 'file' },
};

export const SOURCE_META = {
  gmeet:     { label: 'Google Meet', icon: 'video' },
  whatsapp:  { label: 'WhatsApp',    icon: 'chat' },
  call:      { label: 'Phone call',  icon: 'phone' },
  in_person: { label: 'In person',   icon: 'users' },
  other:     { label: 'Other',       icon: 'dots' },
};

export const DOC_CATEGORY_META = {
  runbook:    'Runbook',
  spec:       'Specification',
  how_to:     'How-to',
  decision:   'Decision record',
  onboarding: 'Onboarding',
  other:      'Other',
};

// ----------------------------------------------------------------- dates --

export function formatDate(value, { withTime = false } = {}) {
  if (!value) return '—';
  const date = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value);
  const opts = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  if (withTime) return `${date.toLocaleDateString(undefined, opts)}, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  return date.toLocaleDateString(undefined, opts);
}

export function relativeTime(value) {
  if (!value) return '';
  const date = new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 31) return `${Math.round(days / 7)}w ago`;
  return formatDate(value);
}

/** Human phrasing for a due date, plus how alarmed to look about it. */
export function dueMeta(dueDate, status) {
  if (!dueDate) return null;
  if (['done', 'cancelled'].includes(status)) return { label: formatDate(dueDate), tone: '' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const days = Math.round((due - today) / 86_400_000);
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'red', overdue: true };
  if (days === 0) return { label: 'Due today', tone: 'red' };
  if (days === 1) return { label: 'Due tomorrow', tone: 'amber' };
  if (days <= 7) return { label: `Due in ${days}d`, tone: 'amber' };
  return { label: `Due ${formatDate(dueDate)}`, tone: '' };
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------ primitives --

export function Avatar({ user, name, color, size = 26, className = '' }) {
  const label = user?.name || name || '?';
  const background = user?.avatar_color || color || '#8b919d';
  const initials = label
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className={`avatar ${className}`}
      style={{ width: size, height: size, background, fontSize: Math.max(9, size * 0.4) }}
      title={label}
    >
      {initials || '?'}
    </span>
  );
}

export function AvatarStack({ users = [], max = 4, size = 24 }) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <span className="row" style={{ gap: 0 }}>
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size={size} className="stack" />
      ))}
      {rest > 0 && (
        <span className="avatar stack" style={{ width: size, height: size, background: 'var(--text-3)', fontSize: size * 0.36 }}>
          +{rest}
        </span>
      )}
    </span>
  );
}

export const Badge = ({ tone = '', children, square, style, title }) => (
  <span className={`badge ${tone} ${square ? 'sq' : ''}`} style={style} title={title}>
    {children}
  </span>
);

export const StatusPill = ({ status }) => {
  const meta = STATUS_META[status] || { label: status, tone: '' };
  return (
    <Badge tone={meta.tone} square>
      <span className="dot" style={{ background: meta.color }} />
      {meta.label}
    </Badge>
  );
};

export const PriorityTag = ({ priority, compact }) => {
  const meta = PRIORITY_META[priority] || PRIORITY_META.medium;
  if (compact) return <span className="dot" style={{ background: meta.color }} title={`${meta.label} priority`} />;
  return (
    <Badge tone={meta.tone} square>
      {meta.label}
    </Badge>
  );
};

export const ProgressBar = ({ value = 0, tone = '' }) => (
  <div className={`progress ${tone}`}>
    <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

export const Spinner = () => <span className="spinner" />;

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="empty">
      <Spinner />
      <p style={{ marginTop: 12 }}>{label}</p>
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, children, action }) {
  return (
    <div className="empty">
      <div className="icon">
        <Icon name={icon} size={20} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, bodyClass = '', className = '', style }) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || actions) && (
        <header className="card-head">
          <div className="grow">
            {title && <h2>{title}</h2>}
            {subtitle && <div className="small muted" style={{ marginTop: 2 }}>{subtitle}</div>}
          </div>
          {actions}
        </header>
      )}
      <div className={`card-body ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, required }) {
  return (
    <div className="field">
      {label && (
        <label>
          {label}
          {required && <span style={{ color: 'var(--red)' }}> *</span>}
        </label>
      )}
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children, footer, width = '' }) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${width}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div className="grow">
            <h2>{title}</h2>
            {subtitle && <div className="small muted" style={{ marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', tone = 'danger', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className={`btn ${tone === 'danger' ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Modal>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          className={`tab ${value === tab.value ? 'active' : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.icon && <Icon name={tab.icon} size={14} />}
          {tab.label}
          {tab.count !== undefined && tab.count !== null && (
            <span className="badge sq" style={{ marginLeft: 2 }}>{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
          title={option.title}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Menu({ trigger, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <span onClick={() => setOpen((v) => !v)}>{trigger}</span>
      {open && (
        <div className="menu" style={{ top: '100%', [align]: 0, marginTop: 4 }} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </span>
  );
}

export const MenuItem = ({ icon, children, onClick, danger }) => (
  <button className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick}>
    {icon && <Icon name={icon} size={14} />}
    {children}
  </button>
);

export function Callout({ tone = '', icon = 'info', children, title }) {
  return (
    <div className={`callout ${tone}`}>
      <Icon name={icon} size={16} />
      <div>
        {title && <div className="strong" style={{ marginBottom: 2 }}>{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', style }) {
  return (
    <div className="search" style={style}>
      <Icon name="search" size={14} />
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250, 500];

/**
 * Server-side pagination bar: rows-per-page picker (up to 500) + prev/next.
 * `total`/`page`/`limit` come straight from the API response driving the
 * table — the page never slices data itself, only asks the server for a
 * different page/limit.
 */
export function Pagination({ page, limit, total, onPageChange, onLimitChange, limitOptions = PAGE_SIZE_OPTIONS }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div className="pagination">
      <div className="small muted">
        {total === 0 ? 'No results' : `Showing ${start}–${end} of ${total}`}
      </div>
      <div className="pagination-controls">
        <label className="pagination-limit">
          <span className="tiny muted">Rows per page</span>
          <select className="input sm" value={limit} onChange={(e) => onLimitChange(Number(e.target.value))}>
            {limitOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="icon-btn sm" disabled={page <= 1} onClick={() => onPageChange(1)} aria-label="First page" title="First page">
            <Icon name="chevronsLeft" size={14} />
          </button>
          <button type="button" className="btn sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <Icon name="chevronLeft" size={13} />
            Prev
          </button>
          <span className="small" style={{ padding: '0 4px', whiteSpace: 'nowrap' }}>
            Page {page} of {totalPages}
          </span>
          <button type="button" className="btn sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            Next
            <Icon name="chevronRight" size={13} />
          </button>
          <button type="button" className="icon-btn sm" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)} aria-label="Last page" title="Last page">
            <Icon name="chevronsRight" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small horizontal bar chart used across the dashboard and reports. */
export function BarChart({ data, max, formatValue = (v) => v }) {
  const ceiling = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bar-chart">
      {data.map((row) => (
        <div className="bar-row" key={row.label}>
          <span className="truncate muted" title={row.label}>{row.label}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${(row.value / ceiling) * 100}%`, background: row.color || 'var(--accent)' }}
            />
          </span>
          <span className="strong center" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatValue(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Deliberately small markdown renderer — headings, lists, tables, code and
 * inline emphasis. Enough for runbooks without pulling in a dependency.
 */
export function Markdown({ children }) {
  const escape = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const inline = (text) =>
    escape(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

  const lines = String(children || '').split('\n');
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.startsWith('```')) {
      const block = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) block.push(lines[index++]);
      index += 1;
      html.push(`<pre><code>${escape(block.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      html.push('<hr />');
      index += 1;
      continue;
    }

    if (line.trim().startsWith('|') && lines[index + 1]?.includes('---')) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const header = cells(line);
      index += 2;
      const body = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) body.push(cells(lines[index++]));
      html.push(
        `<table><thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(inline(lines[index].replace(/^\s*[-*+]\s+/, '')));
        index += 1;
      }
      html.push(`<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(inline(lines[index].replace(/^\s*\d+[.)]\s+/, '')));
        index += 1;
      }
      html.push(`<ol>${items.map((i) => `<li>${i}</li>`).join('')}</ol>`);
      continue;
    }

    if (line.startsWith('>')) {
      html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
      index += 1;
      continue;
    }

    if (line.trim()) {
      const paragraph = [];
      while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|>|\|)/.test(lines[index])) {
        paragraph.push(lines[index++]);
      }
      html.push(`<p>${inline(paragraph.join(' '))}</p>`);
      continue;
    }

    index += 1;
  }

  // Input is authored by signed-in team members and escaped above.
  return <div className="md" dangerouslySetInnerHTML={{ __html: html.join('\n') }} />;
}
