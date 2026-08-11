import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import './styles.css';
import { AppProvider, useApp } from './store.jsx';
import Layout from './components/Layout.jsx';
import { Icon } from './components/icons.jsx';
import { Loading } from './components/ui.jsx';

import Auth from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Board from './pages/Board.jsx';
import Tasks from './pages/Tasks.jsx';
import TaskDetail from './pages/TaskDetail.jsx';
import Meetings from './pages/Meetings.jsx';
import MeetingCapture from './pages/MeetingCapture.jsx';
import MeetingDetail from './pages/MeetingDetail.jsx';
import ActionItems from './pages/ActionItems.jsx';
import Docs from './pages/Docs.jsx';
import Services from './pages/Services.jsx';
import Reports from './pages/Reports.jsx';
import ActivityLog from './pages/ActivityLog.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import People from './pages/People.jsx';
import Settings from './pages/Settings.jsx';

function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`} onClick={() => dismissToast(toast.id)}>
          <Icon
            name={toast.tone === 'error' ? 'alert' : toast.tone === 'success' ? 'check' : 'info'}
            size={15}
            style={{ marginTop: 1, flexShrink: 0 }}
          />
          <span className="grow small">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

function Shell() {
  const { user, loading, orgSettings } = useApp();

  if (loading) {
    return (
      <div className="auth-wrap">
        <Loading label={`Starting ${orgSettings.app_name}…`} />
      </div>
    );
  }

  if (!user) return <Auth />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/board" element={<Board />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/meetings" element={<Meetings />} />
        <Route path="/meetings/new" element={<MeetingCapture />} />
        <Route path="/meetings/:id" element={<MeetingDetail />} />
        <Route path="/action-items" element={<ActionItems />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/:id" element={<Docs />} />
        <Route path="/services" element={<Services />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/activity" element={<ActivityLog />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/people" element={<People />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Shell />
        <Toasts />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
