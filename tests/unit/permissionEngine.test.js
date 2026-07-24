import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePermission, normalizeScope, scopeAllows } from '../../functions/src/services/permissionEngine.js';

function context(overrides = {}) {
  return {
    schoolId: 'school_a',
    nowMs: Date.parse('2026-07-24T12:00:00.000Z'),
    subject: {
      uid: 'teacher_a', schoolIds: ['school_a'], accountStatus: 'active', systemRole: 'viewer',
      platformAdmin: false, globalAdmin: false, roleIds: ['teacher'], teamIds: ['pedagogy'], classIds: ['class_a'],
    },
    capabilityGrants: [],
    resourceAcls: [],
    ...overrides,
  };
}

test('normalizes supported scopes without duplicate values', () => {
  assert.deepEqual(normalizeScope({ type: 'classes', classIds: ['a', 'a', 'b'] }), { type: 'classes', values: ['a', 'b'] });
  assert.equal(scopeAllows({ type: 'classes', values: ['a'] }, { classId: 'b' }, 'u'), false);
});
test('school boundary denies an otherwise valid capability', () => {
  const decision = evaluatePermission(context({ subject: { ...context().subject, schoolIds: ['school_b'] } }), {
    capability: 'students.view', resource: { classId: 'class_a' },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'cross-school');
});

test('class-scoped roles allow only the assigned class', () => {
  const base = context({ capabilityGrants: [{ capability: 'students.view', scope: { type: 'classes', values: ['class_a'] }, source: 'role:teacher' }] });
  assert.equal(evaluatePermission(base, { capability: 'students.view', resource: { classId: 'class_a' } }).allowed, true);
  assert.equal(evaluatePermission(base, { capability: 'students.view', resource: { classId: 'class_b' } }).allowed, false);
});

test('team ACL grants resource access with a structured source', () => {
  const decision = evaluatePermission(context({ resourceAcls: [{
    resourceType: 'folder', resourceId: 'shared', principalType: 'team', principalId: 'pedagogy', accessLevel: 'view', active: true,
  }] }), { capability: 'files.view', resourceType: 'folder', resourceId: 'shared', accessLevel: 'view', resource: {} });
  assert.equal(decision.allowed, true);
  assert.equal(decision.source, 'team-acl');
});

test('folder inheritance grants a child resource', () => {
  const decision = evaluatePermission(context({ resourceAcls: [{
    resourceType: 'file', resourceId: 'child', principalType: 'user', principalId: 'teacher_a', accessLevel: 'edit', inheritedFrom: 'parent', active: true,
  }] }), { capability: 'files.edit', resourceType: 'file', resourceId: 'child', accessLevel: 'edit', resource: {} });
  assert.equal(decision.allowed, true);
  assert.equal(decision.source, 'parent-acl');
});

test('explicit deny wins over a role and resource grant', () => {
  const decision = evaluatePermission(context({
    capabilityGrants: [{ capability: 'files.view', scope: { type: 'school' }, source: 'role:teacher' }],
    resourceAcls: [
      { resourceType: 'file', resourceId: 'secret', principalType: 'role', principalId: 'teacher', accessLevel: 'view', active: true },
      { resourceType: 'file', resourceId: 'secret', principalType: 'user', principalId: 'teacher_a', explicitDeny: true, accessLevel: 'view', active: true },
    ],
  }), { capability: 'files.view', resourceType: 'file', resourceId: 'secret', accessLevel: 'view', resource: {} });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'explicit-deny');
});

test('expired grants and inactive users are denied', () => {
  const expired = evaluatePermission(context({ capabilityGrants: [{ capability: 'students.view', scope: { type: 'school' }, expiresAt: '2026-07-23T00:00:00.000Z' }] }), { capability: 'students.view', resource: {} });
  const inactive = evaluatePermission(context({ subject: { ...context().subject, accountStatus: 'disabled' } }), { capability: 'students.view', resource: {} });
  assert.equal(expired.allowed, false);
  assert.equal(inactive.reason, 'inactive-user');
});

test('institution manager keeps protected access despite an ACL deny', () => {
  const manager = context({
    subject: { ...context().subject, systemRole: 'institution_manager' },
    resourceAcls: [{ resourceType: 'file', resourceId: 'secret', principalType: 'user', principalId: 'teacher_a', explicitDeny: true, active: true }],
  });
  assert.equal(evaluatePermission(manager, { capability: 'files.view', resourceType: 'file', resourceId: 'secret', resource: {} }).allowed, true);
});
