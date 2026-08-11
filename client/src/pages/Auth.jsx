import { useState } from 'react';
import { useApp } from '../store.jsx';
import { Icon } from '../components/icons.jsx';
import { Callout, Field, Spinner } from '../components/ui.jsx';

const DEMO_ACCOUNTS = [
  { email: 'prashanth@example.com', role: 'Administrator', name: 'Prashanth S' },
  { email: 'anita@example.com', role: 'Manager', name: 'Anita Rao' },
  { email: 'vikram@example.com', role: 'Team member', name: 'Vikram Iyer' },
  { email: 'divya@example.com', role: 'Viewer (read only)', name: 'Divya Krishnan' },
];

function Setup() {
  const { runSetup, toast, orgSettings } = useApp();
  const [form, setForm] = useState({ name: '', email: '', password: '', workspace: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await runSetup(form);
      toast('Workspace ready. Welcome aboard.', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          {orgSettings.logo ? (
            <img className="brand-mark brand-logo-img" style={{ width: 32, height: 32, borderRadius: 10 }} src={orgSettings.logo} alt="" />
          ) : (
            <span className="brand-mark" style={{ width: 32, height: 32, borderRadius: 10 }}>
              <Icon name="infinity" size={20} strokeWidth={2.4} />
            </span>
          )}
          {orgSettings.app_name}
        </div>

        <form className="card" onSubmit={submit}>
          <div className="card-head">
            <div>
              <h2>Set up your workspace</h2>
              <div className="small muted" style={{ marginTop: 2 }}>
                This creates the first administrator account. It only happens once.
              </div>
            </div>
          </div>
          <div className="card-body col" style={{ gap: 14 }}>
            <Field label="Your name" required>
              <input className="input" value={form.name} onChange={set('name')} placeholder="Priya Sharma" required />
            </Field>
            <Field label="Work email" required>
              <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="you@company.com" required />
            </Field>
            <Field label="Password" hint="At least 8 characters." required>
              <input className="input" type="password" value={form.password} onChange={set('password')} required minLength={8} />
            </Field>
            <Field label="First project" hint="You can rename or delete it later.">
              <input className="input" value={form.workspace} onChange={set('workspace')} placeholder="Customer Portal" />
            </Field>

            {error && <Callout tone="danger" icon="alert">{error}</Callout>}

            <button className="btn primary lg block" disabled={busy}>
              {busy ? <Spinner /> : 'Create workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Auth() {
  const { needsSetup, signIn, toast, orgSettings } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (needsSetup) return <Setup />;

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await signIn(email, password);
      toast(`Welcome back, ${user.name.split(' ')[0]}.`, 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const useDemo = (demoEmail) => {
    setEmail(demoEmail);
    setPassword('password123');
    setError('');
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          {orgSettings.logo ? (
            <img className="brand-mark brand-logo-img" style={{ width: 32, height: 32, borderRadius: 10 }} src={orgSettings.logo} alt="" />
          ) : (
            <span className="brand-mark" style={{ width: 32, height: 32, borderRadius: 10 }}>
              <Icon name="infinity" size={20} strokeWidth={2.4} />
            </span>
          )}
          {orgSettings.app_name}
        </div>

        <form className="card" onSubmit={submit}>
          <div className="card-head">
            <div>
              <h2>Sign in</h2>
              <div className="small muted" style={{ marginTop: 2 }}>
                Turn discussions into work nobody forgets.
              </div>
            </div>
          </div>
          <div className="card-body col" style={{ gap: 14 }}>
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="username"
                required
              />
            </Field>

            <Field label="Password">
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  style={{ paddingRight: 38 }}
                  required
                />
                <button
                  type="button"
                  className="icon-btn sm"
                  style={{ position: 'absolute', right: 4, top: 3 }}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Icon name={showPassword ? 'eyeOff' : 'eye'} size={15} />
                </button>
              </div>
            </Field>

            {error && <Callout tone="danger" icon="alert">{error}</Callout>}

            <button className="btn primary lg block" disabled={busy}>
              {busy ? <Spinner /> : 'Sign in'}
            </button>

            <div className="demo-accounts">
              <div className="tiny dim" style={{ marginBottom: 6 }}>
                Demo accounts — click one to fill the form (password: password123)
              </div>
              {DEMO_ACCOUNTS.map((account) => (
                <button type="button" key={account.email} className="demo-account" onClick={() => useDemo(account.email)}>
                  <Icon name="user" size={13} />
                  <span className="grow truncate">{account.name}</span>
                  <span className="tiny dim">{account.role}</span>
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
