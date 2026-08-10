import { db } from './db.js';

export const ORG_ROLES = ['admin', 'manager', 'member', 'viewer'];
export const PROJECT_ROLES = ['lead', 'member', 'viewer'];

export const ORG_ROLE_LABELS = {
  admin: 'Administrator',
  manager: 'Manager',
  member: 'Team member',
  viewer: 'Viewer',
};

/**
 * What a role can do inside a project. `lead` is also what an org admin gets
 * everywhere, so admins never need to be added to a project by hand.
 */
const PROJECT_CAPS = {
  lead: [
    'project.view', 'project.edit', 'project.delete', 'project.members',
    'task.view', 'task.create', 'task.edit', 'task.delete', 'task.assign', 'task.transition',
    'meeting.view', 'meeting.create', 'meeting.edit', 'meeting.delete',
    'action.manage',
    'doc.view', 'doc.create', 'doc.edit', 'doc.delete',
    'service.view', 'service.create', 'service.edit', 'service.delete',
    'comment.create', 'comment.delete.any',
    'report.view', 'activity.view',
  ],
  member: [
    'project.view',
    'task.view', 'task.create', 'task.edit', 'task.assign', 'task.transition',
    'meeting.view', 'meeting.create', 'meeting.edit',
    'action.manage',
    'doc.view', 'doc.create', 'doc.edit',
    'service.view', 'service.create', 'service.edit',
    'comment.create',
    'report.view', 'activity.view',
  ],
  viewer: [
    'project.view', 'task.view', 'meeting.view', 'doc.view', 'service.view',
    'report.view', 'activity.view',
  ],
};

/** Org-wide capabilities that do not belong to a single project. */
const ORG_CAPS = {
  admin: ['user.manage', 'user.invite', 'project.create', 'org.settings', 'report.view.all'],
  manager: ['user.invite', 'project.create', 'report.view.all'],
  member: [],
  viewer: [],
};

/**
 * A user's effective role inside one project.
 * Org admins are leads everywhere. Everyone else gets their membership role,
 * or null when they are not a member (= no access at all).
 */
export function projectRole(user, projectId) {
  if (!user) return null;
  if (user.role === 'admin') return 'lead';
  if (!projectId) return null;
  const row = db
    .prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, user.id);
  if (!row) return null;
  // An org-level viewer can never exceed read access, whatever the project says.
  if (user.role === 'viewer') return 'viewer';
  return row.role;
}

/**
 * Capability check. `projectId` is required for every project-scoped
 * capability; org capabilities ignore it.
 */
export function can(user, capability, projectId = null) {
  if (!user || !user.is_active) return false;
  if (ORG_CAPS[user.role]?.includes(capability)) return true;
  if (Object.values(ORG_CAPS).flat().includes(capability)) return false; // org cap, not granted
  const role = projectRole(user, projectId);
  if (!role) return false;
  return PROJECT_CAPS[role].includes(capability);
}

/** Express guard for a project-scoped capability. */
export function requireCap(capability, getProjectId = (req) => Number(req.params.projectId) || null) {
  return (req, res, next) => {
    const projectId = getProjectId(req);
    if (!can(req.user, capability, projectId)) {
      return res.status(403).json({
        error: 'You do not have permission to do that',
        capability,
        hint: 'Ask a project lead or an administrator for access.',
      });
    }
    next();
  };
}

/** IDs of every project a user may read. */
export function visibleProjectIds(user) {
  if (!user) return [];
  if (user.role === 'admin') {
    return db.prepare('SELECT id FROM projects').all().map((r) => r.id);
  }
  return db
    .prepare('SELECT project_id AS id FROM project_members WHERE user_id = ?')
    .all(user.id)
    .map((r) => r.id);
}

/** The full capability list for a user, used by the UI to hide dead controls. */
export function capabilitiesFor(user, projectId = null) {
  const org = ORG_CAPS[user.role] ?? [];
  const role = projectRole(user, projectId);
  const project = role ? PROJECT_CAPS[role] : [];
  return { orgRole: user.role, projectRole: role, capabilities: [...new Set([...org, ...project])] };
}
