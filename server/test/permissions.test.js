/**
 * Permission tests run against a real throwaway database — DB_FILE is set
 * before the modules that open the connection are imported.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamtrack-test-'));
process.env.DB_FILE = path.join(dir, 'test.db');

const { db, initSchema } = await import('../src/db.js');
const { can, projectRole, visibleProjectIds, capabilitiesFor } = await import('../src/permissions.js');

const users = {};
let alphaId;
let betaId;

before(() => {
  initSchema();

  const insertUser = db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, 'x', ?)",
  );
  for (const [key, name, role] of [
    ['admin', 'Ada Admin', 'admin'],
    ['manager', 'Mo Manager', 'manager'],
    ['member', 'Mia Member', 'member'],
    ['viewer', 'Vic Viewer', 'viewer'],
    ['outsider', 'Otto Outsider', 'member'],
  ]) {
    const id = Number(insertUser.run(name, `${key}@example.com`, role).lastInsertRowid);
    users[key] = { id, name, role, is_active: 1 };
  }

  const insertProject = db.prepare('INSERT INTO projects (key, name, lead_id) VALUES (?, ?, ?)');
  alphaId = Number(insertProject.run('ALPHA', 'Alpha', users.manager.id).lastInsertRowid);
  betaId = Number(insertProject.run('BETA', 'Beta', users.manager.id).lastInsertRowid);

  const addMember = db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)');
  addMember.run(alphaId, users.manager.id, 'lead');
  addMember.run(alphaId, users.member.id, 'member');
  addMember.run(alphaId, users.viewer.id, 'viewer');
  // A plain member who was given lead on Beta — role is per project.
  addMember.run(betaId, users.member.id, 'lead');
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('an admin is a lead on every project without being a member', () => {
  assert.equal(projectRole(users.admin, alphaId), 'lead');
  assert.equal(projectRole(users.admin, betaId), 'lead');
  assert.equal(can(users.admin, 'project.delete', alphaId), true);
  assert.equal(can(users.admin, 'user.manage'), true);
});

test('project roles are per project, not global', () => {
  assert.equal(projectRole(users.member, alphaId), 'member');
  assert.equal(projectRole(users.member, betaId), 'lead');
  assert.equal(can(users.member, 'project.members', alphaId), false);
  assert.equal(can(users.member, 'project.members', betaId), true);
});

test('a non-member has no access at all', () => {
  assert.equal(projectRole(users.outsider, alphaId), null);
  assert.equal(can(users.outsider, 'task.view', alphaId), false);
  assert.equal(can(users.outsider, 'task.create', alphaId), false);
});

test('a project viewer can read but not write', () => {
  assert.equal(can(users.viewer, 'task.view', alphaId), true);
  assert.equal(can(users.viewer, 'report.view', alphaId), true);
  assert.equal(can(users.viewer, 'task.create', alphaId), false);
  assert.equal(can(users.viewer, 'task.transition', alphaId), false);
  assert.equal(can(users.viewer, 'comment.create', alphaId), false);
});

test('an org viewer cannot be escalated by a generous project role', () => {
  const addMember = db.prepare('INSERT OR REPLACE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)');
  addMember.run(betaId, users.viewer.id, 'lead');

  assert.equal(projectRole(users.viewer, betaId), 'viewer', 'org role caps the project role');
  assert.equal(can(users.viewer, 'task.create', betaId), false);
});

test('only admins and managers can create projects', () => {
  assert.equal(can(users.admin, 'project.create'), true);
  assert.equal(can(users.manager, 'project.create'), true);
  assert.equal(can(users.member, 'project.create'), false);
  assert.equal(can(users.viewer, 'project.create'), false);
});

test('managing people is administrators only', () => {
  assert.equal(can(users.admin, 'user.manage'), true);
  assert.equal(can(users.manager, 'user.manage'), false);
  assert.equal(can(users.member, 'user.manage'), false);
});

test('a deactivated account can do nothing', () => {
  const suspended = { ...users.admin, is_active: 0 };
  assert.equal(can(suspended, 'task.view', alphaId), false);
  assert.equal(can(suspended, 'user.manage'), false);
});

test('project-scoped capabilities are denied without a project', () => {
  assert.equal(can(users.member, 'task.create', null), false);
});

test('visible projects are limited to membership, and unlimited for admins', () => {
  assert.deepEqual(visibleProjectIds(users.outsider), []);
  assert.deepEqual(visibleProjectIds(users.manager), [alphaId, betaId].slice(0, 1));
  assert.deepEqual(visibleProjectIds(users.admin).sort(), [alphaId, betaId].sort());
});

test('the capability list handed to the UI matches the checks', () => {
  const forMember = capabilitiesFor(users.member, alphaId);
  assert.equal(forMember.projectRole, 'member');
  assert.ok(forMember.capabilities.includes('task.create'));
  assert.ok(!forMember.capabilities.includes('project.delete'));

  const forViewer = capabilitiesFor(users.viewer, alphaId);
  assert.ok(forViewer.capabilities.includes('task.view'));
  assert.ok(!forViewer.capabilities.includes('task.create'));
});
