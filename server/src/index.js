import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initSchema, db } from './db.js';
import { authenticate } from './auth.js';
import { startScheduler, runDeadlineSweep } from './scheduler.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import meetingRoutes from './routes/meetings.js';
import docRoutes from './routes/docs.js';
import serviceRoutes from './routes/services.js';
import notificationRoutes from './routes/notifications.js';
import activityRoutes from './routes/activity.js';
import reportRoutes from './routes/reports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;

initSchema();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  res.json({ ok: true, users: count, time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);

// Everything past this point needs a signed-in user.
app.use('/api/users', authenticate, userRoutes);
app.use('/api/projects', authenticate, projectRoutes);
app.use('/api/tasks', authenticate, taskRoutes);
app.use('/api/meetings', authenticate, meetingRoutes);
app.use('/api/docs', authenticate, docRoutes);
app.use('/api/services', authenticate, serviceRoutes);
app.use('/api/notifications', authenticate, notificationRoutes);
app.use('/api/activity', authenticate, activityRoutes);
app.use('/api/reports', authenticate, reportRoutes);

/** Manual trigger for the deadline sweep, handy for demos and cron. */
app.post('/api/admin/sweep', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrators only' });
  res.json(runDeadlineSweep());
});

app.use('/api', (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` }));

// Serve the built client when it exists, so one process runs the whole app.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg shape.
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong on our side' });
});

app.listen(PORT, () => {
  console.log(`TeamTrack API listening on http://localhost:${PORT}`);
  if (!fs.existsSync(clientDist)) {
    console.log('Client build not found — run `npm run build` in client/, or use the Vite dev server.');
  }
});

startScheduler({ intervalMinutes: Number(process.env.SWEEP_INTERVAL_MIN) || 30 });
