import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStaffSchema,
  notificationSchema,
  setRoleSchema,
} from '../src/validation/schemas.js';

test('regular staff creation cannot request global_admin', () => {
  assert.throws(() => createStaffSchema.parse({
    email: 'user@example.test',
    fullName: 'User',
    role: 'global_admin',
    schoolId: 'school_a',
  }));
});

test('role schema rejects unknown fields and malformed IDs', () => {
  assert.throws(() => setRoleSchema.parse({
    userId: '../unsafe',
    schoolId: 'school_a',
    role: 'viewer',
    unexpected: true,
  }));
});

test('notifications are bounded and links are local routes', () => {
  assert.throws(() => notificationSchema.parse({
    schoolId: 'school_a',
    userIds: ['user_a'],
    title: 'Notice',
    type: 'system',
    link: 'https://example.test/phishing',
  }));
  const parsed = notificationSchema.parse({
    schoolId: 'school_a',
    userIds: ['user_a', 'user_a'],
    title: 'Notice',
    type: 'system',
    link: '/notifications',
  });
  assert.deepEqual(parsed.userIds, ['user_a']);
});
