import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { Icon } from '../components/icons.jsx';
import { Avatar, Badge, Callout, Card, Field, Spinner, Tabs, formatDate } from '../components/ui.jsx';

const AVATAR_COLORS = ['#5b5bd6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

const NOTIFY_OPTIONS = [
  { key: 'assigned', label: 'Something is assigned to me', hint: 'A task lands in your queue.' },
  { key: 'mentioned', label: 'Somebody @mentions me', hint: 'In a task comment.' },
  { key: 'comment', label: 'New comments on what I watch', hint: 'Tasks you are assigned to or watching.' },
  { key: 'status', label: 'Status changes on what I watch', hint: 'Moves between board columns and other edits.' },
  { key: 'due', label: 'Deadlines', hint: 'Due in the next two days, and every day it stays overdue.' },
  { key: 'action_item', label: 'Action items', hint: 'When notes are shared or an item is put on you.' },
];

const MAX_IMAGE_BYTES = 800 * 1024; // keeps the stored data URL modest

export default function Settings() {
  const { user, setUser, theme, setTheme, toast, projects, orgSettings, updateOrgSettings } = useApp();
  const isAdmin = user.role === 'admin';

  const [tab, setTab] = useState('profile');
  const [profile, setProfile] = useState({
    name: user.name, title: user.title || '', phone: user.phone || '', avatar_color: user.avatar_color,
  });
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm: '' });
  const [prefs, setPrefs] = useState({
    assigned: true, mentioned: true, comment: true, status: true, due: true, action_item: true,
    ...(user.notify_prefs || {}),
  });
  const [busy, setBusy] = useState(false);
  const [appName, setAppName] = useState(orgSettings.app_name);
  const [brandingBusy, setBrandingBusy] = useState(false);

  const saveAppName = async () => {
    const trimmed = appName.trim();
    if (!trimmed) return toast('Application name cannot be empty.', 'error');
    setBrandingBusy(true);
    try {
      await updateOrgSettings({ app_name: trimmed });
      toast('Application name saved.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBrandingBusy(false);
    }
  };

  const pickImage = (field) => (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Please choose an image file.', 'error');
    if (file.size > MAX_IMAGE_BYTES) return toast('That image is too large — please use one under 800KB.', 'error');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await updateOrgSettings({ [field]: reader.result });
        toast(`${field === 'logo' ? 'Logo' : 'Favicon'} updated.`, 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    reader.readAsDataURL(file);
  };

  const clearImage = (field) => async () => {
    try {
      await updateOrgSettings({ [field]: null });
      toast(`${field === 'logo' ? 'Logo' : 'Favicon'} reset to default.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const saveProfile = async () => {
    setBusy(true);
    try {
      const { user: updated } = await api.patch('/auth/me', profile);
      setUser((current) => ({ ...current, ...updated }));
      toast('Profile saved.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const savePrefs = async (next) => {
    setPrefs(next);
    try {
      const { user: updated } = await api.patch('/auth/me', { notify_prefs: next });
      setUser((current) => ({ ...current, ...updated }));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const changePassword = async () => {
    if (passwords.new_password.length < 8) return toast('New password must be at least 8 characters.', 'error');
    if (passwords.new_password !== passwords.confirm) return toast('The two new passwords do not match.', 'error');
    setBusy(true);
    try {
      await api.post('/auth/me/password', {
        current_password: passwords.current_password,
        new_password: passwords.new_password,
      });
      setPasswords({ current_password: '', new_password: '', confirm: '' });
      toast('Password changed.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <div className="page-head">
        <div className="grow">
          <h1>Settings</h1>
          <div className="sub">Your profile, what you get told about, and how the app looks.</div>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'profile', label: 'Profile', icon: 'user' },
          { value: 'notifications', label: 'Notifications', icon: 'bell' },
          { value: 'access', label: 'My access', icon: 'shield' },
          { value: 'appearance', label: 'Appearance', icon: 'sun' },
          ...(isAdmin ? [{ value: 'branding', label: 'Branding', icon: 'flag' }] : []),
        ]}
      />

      {tab === 'profile' && (
        <div className="col" style={{ gap: 14 }}>
          <Card title="Your details">
            <div className="row" style={{ gap: 16, marginBottom: 16, alignItems: 'flex-start' }}>
              <Avatar user={{ name: profile.name, avatar_color: profile.avatar_color }} size={56} />
              <div className="grow">
                <div className="strong">{profile.name}</div>
                <div className="small muted">{user.email}</div>
                <div className="row" style={{ gap: 6, marginTop: 10 }}>
                  {AVATAR_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setProfile((p) => ({ ...p, avatar_color: color }))}
                      style={{
                        width: 22, height: 22, borderRadius: 7, background: color, cursor: 'pointer',
                        border: profile.avatar_color === color ? '2px solid var(--text)' : '2px solid transparent',
                      }}
                      aria-label={`Use ${color}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="grid c2" style={{ gap: 12 }}>
              <Field label="Name">
                <input className="input" value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} />
              </Field>
              <Field label="Job title">
                <input className="input" value={profile.title} onChange={(e) => setProfile((p) => ({ ...p, title: e.target.value }))} />
              </Field>
              <Field label="Phone">
                <input className="input" value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} />
              </Field>
              <Field label="Email" hint="An administrator can change this for you.">
                <input className="input" value={user.email} disabled />
              </Field>
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              <span className="spacer" />
              <button className="btn primary" onClick={saveProfile} disabled={busy}>
                {busy ? <Spinner /> : 'Save profile'}
              </button>
            </div>
          </Card>

          <Card title="Change password">
            <div className="grid c3" style={{ gap: 12 }}>
              <Field label="Current password">
                <input className="input" type="password" value={passwords.current_password}
                       onChange={(e) => setPasswords((p) => ({ ...p, current_password: e.target.value }))} />
              </Field>
              <Field label="New password" hint="Minimum 8 characters.">
                <input className="input" type="password" value={passwords.new_password}
                       onChange={(e) => setPasswords((p) => ({ ...p, new_password: e.target.value }))} />
              </Field>
              <Field label="Confirm new password">
                <input className="input" type="password" value={passwords.confirm}
                       onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))} />
              </Field>
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <span className="spacer" />
              <button className="btn" onClick={changePassword} disabled={busy || !passwords.current_password}>
                Change password
              </button>
            </div>
          </Card>
        </div>
      )}

      {tab === 'notifications' && (
        <Card title="Tell me about…" subtitle="Turn anything off and it stops reaching your bell immediately.">
          {NOTIFY_OPTIONS.map((option) => (
            <div className="switch-row" key={option.key}>
              <div>
                <div className="strong small">{option.label}</div>
                <div className="tiny muted">{option.hint}</div>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={prefs[option.key] !== false}
                  onChange={(e) => savePrefs({ ...prefs, [option.key]: e.target.checked })}
                />
              </label>
            </div>
          ))}
          <div style={{ marginTop: 14 }}>
            <Callout icon="info">
              Deadline alerts are raised at most once a day per task, so an overdue item nudges you daily rather
              than filling your list.
            </Callout>
          </div>
        </Card>
      )}

      {tab === 'access' && (
        <div className="col" style={{ gap: 14 }}>
          <Card title="Your access level">
            <div className="row" style={{ gap: 12 }}>
              <Badge tone={user.role === 'admin' ? 'red' : user.role === 'manager' ? 'purple' : user.role === 'viewer' ? '' : 'blue'} square>
                {user.role}
              </Badge>
              <span className="small muted grow">
                {user.role === 'admin' && 'You can do anything in this workspace, including managing people.'}
                {user.role === 'manager' && 'You can create projects and add people, and you have full control of your own projects.'}
                {user.role === 'member' && 'You can work on the projects you belong to.'}
                {user.role === 'viewer' && 'You have read-only access. Ask an administrator if you need to make changes.'}
              </span>
            </div>
          </Card>

          <Card title="Projects you belong to" bodyClass="tight">
            {projects.length === 0 ? (
              <div style={{ padding: 16 }} className="muted small">You are not on any project yet.</div>
            ) : (
              projects.map((project) => (
                <div className="list-item plain" key={project.id}>
                  <span className="dot" style={{ background: project.color }} />
                  <div className="grow">
                    <div className="small strong">{project.name}</div>
                    <div className="tiny dim">{project.key} · {project.stats.total} tasks</div>
                  </div>
                  <Badge tone={project.my_role === 'lead' ? 'accent' : 'outline'} square>
                    {project.my_role || 'admin access'}
                  </Badge>
                </div>
              ))
            )}
          </Card>

          <Card title="Account">
            <div className="row between small">
              <span className="muted">Member since</span>
              <span>{formatDate(user.created_at)}</span>
            </div>
          </Card>
        </div>
      )}

      {tab === 'appearance' && (
        <Card title="Appearance">
          <div className="switch-row">
            <div>
              <div className="strong small">Dark mode</div>
              <div className="tiny muted">Saved to your account — follows you to any device you sign in on.</div>
            </div>
            <button className="btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
              {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            </button>
          </div>
          <div className="switch-row">
            <div>
              <div className="strong small">Full Theme Customizer</div>
              <div className="tiny muted">Sidebar color, topbar color, layout width and sidebar size.</div>
            </div>
            <button className="btn" onClick={() => window.dispatchEvent(new Event('infytrack:open-customizer'))}>
              <Icon name="sliders" size={14} />
              Open customizer
            </button>
          </div>
        </Card>
      )}

      {tab === 'branding' && isAdmin && (
        <div className="col" style={{ gap: 14 }}>
          <Callout icon="shield">
            Only administrators can change these. They apply workspace-wide, for every signed-in user and on the
            sign-in screen itself.
          </Callout>

          <Card title="Application name" subtitle="Shown in the sidebar, the sign-in screen and the browser tab.">
            <div className="row" style={{ gap: 10 }}>
              <input className="input grow" value={appName} onChange={(e) => setAppName(e.target.value)} maxLength={40} />
              <button className="btn primary" onClick={saveAppName} disabled={brandingBusy || !appName.trim() || appName.trim() === orgSettings.app_name}>
                {brandingBusy ? <Spinner /> : 'Save'}
              </button>
            </div>
          </Card>

          <Card title="Logo" subtitle="Replaces the mark in the sidebar and sign-in screen. Square image, under 800KB.">
            <div className="row" style={{ gap: 16 }}>
              {orgSettings.logo ? (
                <img
                  src={orgSettings.logo} alt=""
                  style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'contain', border: '1px solid var(--border)' }}
                />
              ) : (
                <span className="brand-mark" style={{ width: 48, height: 48, borderRadius: 12 }}>
                  <Icon name="infinity" size={26} strokeWidth={2.4} />
                </span>
              )}
              <div className="row" style={{ gap: 8 }}>
                <label className="btn sm">
                  <Icon name="download" size={13} style={{ transform: 'rotate(180deg)' }} />
                  Upload
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={pickImage('logo')} />
                </label>
                {orgSettings.logo && (
                  <button className="btn sm" onClick={clearImage('logo')}>Reset to default</button>
                )}
              </div>
            </div>
          </Card>

          <Card title="Favicon" subtitle="Shown in the browser tab. Square image works best, under 800KB.">
            <div className="row" style={{ gap: 16 }}>
              {orgSettings.favicon ? (
                <img
                  src={orgSettings.favicon} alt=""
                  style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'contain', border: '1px solid var(--border)' }}
                />
              ) : (
                <span className="small muted">Using the default favicon.</span>
              )}
              <div className="row" style={{ gap: 8 }}>
                <label className="btn sm">
                  <Icon name="download" size={13} style={{ transform: 'rotate(180deg)' }} />
                  Upload
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={pickImage('favicon')} />
                </label>
                {orgSettings.favicon && (
                  <button className="btn sm" onClick={clearImage('favicon')}>Reset to default</button>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
