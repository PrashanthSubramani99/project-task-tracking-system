import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setToken, clearToken, getToken } from './api.js';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

const THEME_KEY = 'teamtrack.theme';

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [capabilities, setCapabilities] = useState([]);
  const [projects, setProjects] = useState([]);
  const [people, setPeople] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'light');

  const toastId = useRef(0);

  const toast = useCallback((message, tone = 'info') => {
    const id = ++toastId.current;
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3600);
  }, []);

  const dismissToast = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  /** Reference data every screen needs: projects the user can see, and people. */
  const loadWorkspace = useCallback(async () => {
    const [projectData, peopleData] = await Promise.all([
      api.get('/projects').catch(() => ({ projects: [] })),
      api.get('/users').catch(() => ({ users: [] })),
    ]);
    setProjects(projectData.projects || []);
    setPeople(peopleData.users || []);
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const data = await api.get('/notifications', { limit: 40 });
      setNotifications(data.notifications || []);
      setUnread(data.unread || 0);
    } catch {
      /* a failed poll is not worth interrupting the user over */
    }
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    setUser(null);
    setCapabilities([]);
    setProjects([]);
    setNotifications([]);
    setUnread(0);
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      if (!getToken()) {
        const info = await api.get('/auth/bootstrap');
        setNeedsSetup(info.needsSetup);
        setUser(null);
        return;
      }
      const me = await api.get('/auth/me');
      setUser(me.user);
      setCapabilities(me.capabilities || []);
      await Promise.all([loadWorkspace(), refreshNotifications()]);
    } catch {
      clearToken();
      setUser(null);
      try {
        const info = await api.get('/auth/bootstrap');
        setNeedsSetup(info.needsSetup);
      } catch {
        /* server unreachable — the sign-in screen will surface it */
      }
    } finally {
      setLoading(false);
    }
  }, [loadWorkspace, refreshNotifications]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const onSignedOut = () => signOut();
    window.addEventListener('teamtrack:signed-out', onSignedOut);
    return () => window.removeEventListener('teamtrack:signed-out', onSignedOut);
  }, [signOut]);

  // Poll for new alerts. Cheap, and it keeps the bell honest without sockets.
  useEffect(() => {
    if (!user) return undefined;
    const timer = setInterval(refreshNotifications, 45_000);
    return () => clearInterval(timer);
  }, [user, refreshNotifications]);

  const signIn = useCallback(
    async (email, password) => {
      const data = await api.post('/auth/login', { email, password });
      setToken(data.token);
      setUser(data.user);
      const me = await api.get('/auth/me');
      setCapabilities(me.capabilities || []);
      await Promise.all([loadWorkspace(), refreshNotifications()]);
      return data.user;
    },
    [loadWorkspace, refreshNotifications],
  );

  const runSetup = useCallback(
    async (payload) => {
      const data = await api.post('/auth/setup', payload);
      setToken(data.token);
      setUser(data.user);
      setNeedsSetup(false);
      const me = await api.get('/auth/me');
      setCapabilities(me.capabilities || []);
      await loadWorkspace();
      return data.user;
    },
    [loadWorkspace],
  );

  const completeJourneyStep = useCallback(
    async (step) => {
      if (!user || user.journey?.[step]) return;
      try {
        const data = await api.post(`/auth/me/journey/${step}`);
        setUser((current) => ({ ...current, journey: data.journey }));
      } catch {
        /* the tour is a nicety, never block on it */
      }
    },
    [user],
  );

  /**
   * Capability lookup. Project-scoped checks need the user's role on that
   * project, which the server already encoded into the project list.
   */
  const can = useCallback(
    (capability, projectId = null) => {
      if (!user) return false;
      if (user.role === 'admin') return true;
      if (['user.manage', 'org.settings'].includes(capability)) return user.role === 'admin';
      if (['project.create', 'user.invite'].includes(capability)) return ['admin', 'manager'].includes(user.role);
      if (user.role === 'viewer') return capability.endsWith('.view') || capability === 'project.view';

      if (projectId) {
        const project = projects.find((p) => p.id === Number(projectId));
        const role = project?.my_role;
        if (role === 'viewer') return capability.endsWith('.view');
        if (role === 'lead') return true;
      }
      // Non-viewers can do the everyday things; the server is the real gate
      // and returns a clear 403 when a specific project says otherwise.
      return !['project.delete', 'project.members', 'task.delete', 'doc.delete', 'service.delete'].includes(capability);
    },
    [user, projects],
  );

  /**
   * Can this person create anything at all? Used to hide "New task" style
   * controls from read-only accounts rather than letting them click into a
   * guaranteed 403.
   */
  const canWriteSomewhere = useMemo(() => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'viewer') return false;
    return projects.some((project) => project.my_role && project.my_role !== 'viewer');
  }, [user, projects]);

  const value = useMemo(
    () => ({
      user, setUser, capabilities, can, canWriteSomewhere,
      projects, people, loadWorkspace,
      notifications, unread, refreshNotifications,
      loading, needsSetup,
      signIn, signOut, runSetup, completeJourneyStep,
      toast, toasts, dismissToast,
      theme, setTheme,
    }),
    [
      user, capabilities, can, canWriteSomewhere, projects, people, loadWorkspace,
      notifications, unread, refreshNotifications, loading, needsSetup, signIn, signOut,
      runSetup, completeJourneyStep, toast, toasts, dismissToast, theme,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
