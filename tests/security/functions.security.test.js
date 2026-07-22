import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approveMembershipHandler,
} from '../../functions/src/callables/memberships.js';
import { createNotificationsHandler } from '../../functions/src/callables/notifications.js';
import { createStaffHandler, setRoleHandler } from '../../functions/src/callables/staff.js';
import { adminAuth, adminDb } from '../../functions/src/services/firebaseAdmin.js';

const SCHOOL_A = 'school_a';
const SCHOOL_B = 'school_b';
const createdAuthUsers = new Set();

function actorRequest(uid, data, claims = {}) {
  return { auth: { uid, token: claims }, data };
}

async function seedUser(uid, schoolId, role = 'viewer', extra = {}) {
  await adminDb.collection('users').doc(uid).set({
    uid,
    schoolId,
    schoolIds: [schoolId],
    pendingSchools: [],
    role,
    accountStatus: 'active',
    permissions: {},
    teamIds: [],
    ...extra,
  });
}

beforeEach(async () => {
  const collections = await adminDb.listCollections();
  await Promise.all(collections.map(async collectionRef => {
    const snapshot = await collectionRef.get();
    const batch = adminDb.batch();
    snapshot.docs.forEach(document => batch.delete(document.ref));
    if (!snapshot.empty) await batch.commit();
  }));
});

afterEach(async () => {
  await Promise.all([...createdAuthUsers].map(uid => adminAuth.deleteUser(uid).catch(() => undefined)));
  createdAuthUsers.clear();
});

test('privileged functions reject unauthenticated and cross-school actors', async () => {
  await assert.rejects(
    createNotificationsHandler({ auth: null, data: {} }),
    error => error.code === 'unauthenticated',
  );
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await assert.rejects(createStaffHandler(actorRequest('principal_a', {
    email: 'member@example.test',
    fullName: 'Member',
    role: 'viewer',
    schoolId: SCHOOL_B,
  })), error => error.code === 'permission-denied');
});

test('principal cannot grant global_admin through setUserRole', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('target_a', SCHOOL_A);
  await adminAuth.createUser({ uid: 'target_a', email: 'target@example.test' });
  createdAuthUsers.add('target_a');
  await assert.rejects(setRoleHandler(actorRequest('principal_a', {
    userId: 'target_a',
    schoolId: SCHOOL_A,
    role: 'global_admin',
  })), error => error.code === 'permission-denied');
});

test('authorized membership approval writes an audit log', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await adminDb.collection('users').doc('pending_user').set({
    uid: 'pending_user',
    role: 'viewer',
    schoolId: '',
    schoolIds: [],
    pendingSchools: [SCHOOL_A],
    accountStatus: 'pending',
  });
  const result = await approveMembershipHandler(actorRequest('principal_a', {
    userId: 'pending_user',
    schoolId: SCHOOL_A,
  }));
  assert.deepEqual(result, { ok: true });
  const updated = await adminDb.collection('users').doc('pending_user').get();
  assert.equal(updated.data().accountStatus, 'active');
  assert.ok(updated.data().schoolIds.includes(SCHOOL_A));
  const audit = await adminDb.collection('auditLogs')
    .where('action', '==', 'membership.approve')
    .get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].data().schoolId, SCHOOL_A);
});

test('authorized server notification validates school and records audit metadata only', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('recipient_a', SCHOOL_A);
  const result = await createNotificationsHandler(actorRequest('principal_a', {
    schoolId: SCHOOL_A,
    userIds: ['recipient_a'],
    title: 'Authorized update',
    body: 'A short body',
    type: 'system',
    link: '/notifications',
  }));
  assert.equal(result.createdCount, 1);
  const notifications = await adminDb.collection('notifications').get();
  assert.equal(notifications.size, 1);
  assert.equal(notifications.docs[0].data().userId, 'recipient_a');
  const audit = await adminDb.collection('auditLogs')
    .where('action', '==', 'notification.create')
    .get();
  assert.equal(audit.size, 1);
  assert.deepEqual(audit.docs[0].data().metadata, { recipientCount: 1, type: 'system' });
});
