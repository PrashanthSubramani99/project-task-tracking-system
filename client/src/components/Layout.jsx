import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Icon } from './icons.jsx';
import { Avatar, Menu, MenuItem, relativeTime, EmptyState } from './ui.jsx';

const NAV = [
  {
    label: 'Work',
    items: [
      { to: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
      { to: '/board', icon: 'board', label: 'Board' },
      { to: '/tasks', icon: 'list', label: 'Tasks' },
      { to: '/action-items', icon: 'target', label: 'Action items', countKey: 'openActions' },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { to: '/meetings', icon: 'chat', label: 'Discussions' },
      { to: '/docs', icon: 'book', label: 'Documentation' },
      { to: '/services', icon: 'server', label: 'Ports & services' },
    ],
  },
  {
    label: 'Insight',
    items: [
      { to: '/reports', icon: 'chart', label: 'Reports' },
      { to: '/activity', icon: 'activity', label: 'Activity log' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { to: '/projects', icon: 'folder', label: 'Projects' },
      { to: '/people', icon: 'users', label: 'People' },
      { to: '/settings', icon: 'settings', label: 'Settings' },
    ],
  },
];

const NOTIF_STYLE = {
  assigned:    { icon: 'user',   tone: 'var(--blue)',   soft: 'var(--blue-soft)' },
  mentioned:   { icon: 'chat',   tone: 'var(--purple)', soft: 'var(--purple-soft)' },
  comment:     { icon: 'chat',   tone: 'var(--slate)',  soft: 'var(--slate-soft)' },
  status:      { icon: 'refresh',tone: 'var(--slate)',  soft: 'var(--slate-soft)' },
  due_soon:    { icon: 'clock',  tone: 'var(--amber)',  soft: 'var(--amber-soft)' },
  overdue:     { icon: 'alert',  tone: 'var(--red)',    soft: 'var(--red-soft)' },
  action_item: { icon: 'target', tone: 'var(--accent)', soft: 'var(--accent-soft)' },
  project:     { icon: 'folder', tone: 'var(--green)',  soft: 'var(--green-soft)' },
};

function NotificationPanel({ onClose }) {
  const { notifications, unread, refreshNotifications } = useApp();
  const navigate = useNavigate();

  const open = async (notification) => {
    if (!notification.read_at) {
      await api.post(`/notifications/${notification.id}/read`).catch(() => {});
      refreshNotifications();
    }
    if (notification.link) {
      navigate(notification.link);
      onClose();
    }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel">
        <header className="panel-head">
          <h2 className="grow">Notifications</h2>
          {unread > 0 && (
            <button
              className="btn sm ghost"
              onClick={async () => {
                await api.post('/notifications/read-all');
                refreshNotifications();
              }}
            >
              Mark all read
            </button>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="panel-body">
          {notifications.length === 0 ? (
            <EmptyState icon="bell" title="Nothing to catch up on">
              Alerts about your tasks, mentions and deadlines will show up here.
            </EmptyState>
          ) : (
            notifications.map((notification) => {
              const style = NOTIF_STYLE[notification.type] || NOTIF_STYLE.status;
              return (
                <div
                  key={notification.id}
                  className={`notif ${notification.read_at ? '' : 'unread'}`}
                  onClick={() => open(notification)}
                >
                  <span className="notif-icon" style={{ background: style.soft, color: style.tone }}>
                    <Icon name={style.icon} size={14} />
                  </span>
                  <div className="grow">
                    <div className="strong small">{notification.title}</div>
                    {notification.body && (
                      <div className="small muted" style={{ marginTop: 2 }}>{notification.body}</div>
                    )}
                    <div className="tiny dim" style={{ marginTop: 4 }}>
                      {notification.actor_name ? `${notification.actor_name} · ` : ''}
                      {relativeTime(notification.created_at)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}

export default function Layout({ children }) {
  const { user, unread, signOut, theme, setTheme, projects, canWriteSomewhere } = useApp();
  const [panelOpen, setPanelOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setNavOpen(false), [location.pathname]);

  const counts = {
    openActions: projects.reduce((sum, p) => sum + (p.stats?.open_action_items || 0), 0),
  };

  return (
    <div className="app">
      <nav className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">
            <Icon name="infinity" size={16} strokeWidth={2.4} />
          </span>
          InfyTrack
        </div>

        <div className="sidebar-scroll">
          {NAV.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => {
                const count = item.countKey ? counts[item.countKey] : null;
                return (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <Icon name={item.icon} size={16} />
                    {item.label}
                    {count > 0 && <span className="count alert">{count}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <Menu
            align="left"
            trigger={
              <button className="nav-item" style={{ width: '100%' }}>
                <Avatar user={user} size={24} />
                <span className="grow truncate" style={{ textAlign: 'left' }}>{user?.name}</span>
                <Icon name="chevronDown" size={14} />
              </button>
            }
          >
            <MenuItem icon="user" onClick={() => navigate('/settings')}>
              My profile
            </MenuItem>
            <MenuItem icon={theme === 'dark' ? 'sun' : 'moon'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </MenuItem>
            <div className="menu-sep" />
            <MenuItem icon="logout" danger onClick={signOut}>
              Sign out
            </MenuItem>
          </Menu>
        </div>
      </nav>

      {navOpen && <div className="scrim mobile-only" style={{ zIndex: 39 }} onClick={() => setNavOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Icon name="menu" size={18} />
          </button>

          {canWriteSomewhere ? (
            <>
              <button className="btn primary sm" onClick={() => navigate('/meetings/new')}>
                <Icon name="plus" size={14} />
                Log a discussion
              </button>
              <button className="btn sm hide-sm" onClick={() => navigate('/tasks?new=1')}>
                <Icon name="plus" size={14} />
                New task
              </button>
            </>
          ) : (
            <span className="small dim row" style={{ gap: 6 }}>
              <Icon name="eye" size={14} />
              Read-only access
            </span>
          )}

          <div className="spacer" />

          <button className="icon-btn" onClick={() => setPanelOpen(true)} aria-label="Notifications">
            <Icon name="bell" size={17} />
            {unread > 0 && <span className="notif-dot">{unread > 9 ? '9+' : unread}</span>}
          </button>
        </header>

        {children}
      </div>

      {panelOpen && <NotificationPanel onClose={() => setPanelOpen(false)} />}
    </div>
  );
}
