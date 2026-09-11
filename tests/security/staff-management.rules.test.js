import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { changeStaffMember } from '../../src/services/firestore/staffManagementRepository.js';
let environment;
const person = { schoolId: 'a', schoolIds: ['a'], role: 'viewer', accountStatus: 'active', jobTitle: 'מורה' };
before(async () => {
  environment = await initializeTestEnvironment({ projectId: 'demo-zoko-security', firestore: { rules: await readFile('firestore.rules', 'utf8') } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [id, overrides] of Object.entries({ manager: { role: 'principal' }, teacher: {}, outsider: { schoolId: 'b', schoolIds: ['b'] }, protected: { role: 'principal' }, nestedProtected: {}, single: {}, legacy: {}, multi: { schoolIds: ['a', 'b'], jobTitlesBySchool: { b: 'רכז מדעים' } }, title: {}, attack: {} })) {
      await setDoc(doc(db, 'users', id), { ...person, ...overrides });
    }
    for (const id of ['single', 'multi', 'attack']) await setDoc(doc(db, 'schools/a/memberships', id), { status: 'active', role: 'viewer' });
    await setDoc(doc(db, 'schools/a/memberships/nestedProtected'), { status: 'active', role: 'principal' });
    await setDoc(doc(db, 'schools/b/memberships/multi'), { status: 'active', role: 'viewer' });
    await setDoc(doc(db, 'schools/a'), { name: 'a' });
    await setDoc(doc(db, 'schools/b'), { name: 'b' });
  });
});
after(async () => environment?.cleanup());
const database = (uid = 'manager') => environment.authenticatedContext(uid).firestore();
const change = (userId, extras = {}) => changeStaffMember({ db: database(extras.actorId), actorId: 'manager', schoolId: 'a', userId, operation: 'jobTitle', title: 'רכזת פדגוגית וחברתית', expectedTitle: 'מורה', requestId: crypto.randomUUID(), confirmed: true, ...extras });
const read = async path => { let value; await environment.withSecurityRulesDisabled(async c => { value = (await getDoc(doc(c.firestore(), path))).data(); }); return value; };

test('Spark title change is scoped, confirmed, idempotent and rejects changed retry payload', async () => {
  const requestId = 'title-once';
  await change('title', { requestId });
  assert.equal((await read('users/title')).jobTitle, 'רכזת פדגוגית וחברתית');
  assert.equal((await change('title', { requestId })).repeated, true);
  await assert.rejects(change('title', { requestId, title: 'אחר' }), /invalid-input/);
  await assert.rejects(change('title'), /stale-proposal/);
  await assert.rejects(change('teacher', { confirmed: false }), /invalid-input/);
  const receipt = await read(`schools/a/staffChanges/${requestId}`);
  assert.deepEqual(Object.keys(receipt).sort(), ['actorId', 'createdAt', 'operation', 'payloadHash', 'schoolId', 'userId']);
});

test('title and removal preserve other institutions, account and history', async () => {
  await change('multi');
  let value = await read('users/multi');
  assert.equal(value.jobTitle, 'מורה');
  assert.equal(value.jobTitlesBySchool.b, 'רכז מדעים');
  await change('multi', { operation: 'remove' });
  value = await read('users/multi');
  assert.deepEqual(value.schoolIds, ['b']);
  assert.equal(value.schoolId, 'b');
  assert.equal(value.accountStatus, 'active');
  assert.equal(value.jobTitlesBySchool.a, 'רכזת פדגוגית וחברתית');
  assert.equal((await read('schools/a/memberships/multi')).status, 'revoked');
  assert.equal((await read('schools/b/memberships/multi')).status, 'active');
  await assertFails(getDoc(doc(database('multi'), 'schools/a')));
  await getDoc(doc(database('multi'), 'schools/b'));
});

test('single and legacy membership removal revokes institutional access without account deletion', async () => {
  for (const id of ['single', 'legacy']) {
    const requestId = crypto.randomUUID();
    await change(id, { operation: 'remove', requestId });
    assert.equal((await change(id, { operation: 'remove', requestId })).repeated, true);
    const value = await read(`users/${id}`);
    assert.equal(value.accountStatus, 'pending');
    assert.deepEqual(value.schoolIds, []);
    await assertFails(getDoc(doc(database(id), 'schools/a')));
  }
});

test('staff changes reject peers, outsiders, self and protected managers', async () => {
  for (const id of ['manager', 'protected', 'outsider', 'nestedProtected']) await assert.rejects(change(id));
  await assert.rejects(change('attack', { actorId: 'teacher' }));
});

test('forged writes cannot change roles, other schools, or omit active membership revocation', async () => {
  const db = database();
  for (const patch of [
    { role: 'principal', jobTitlesBySchool: { a: 'מורה' } },
    { jobTitlesBySchool: { a: 'מורה', b: 'אחר' } },
    { schoolId: '', schoolIds: [], pendingSchools: [], accountStatus: 'pending' },
  ]) {
    const requestId = crypto.randomUUID();
    const batch = writeBatch(db);
    batch.update(doc(db, 'users/attack'), { ...patch, staffChange: { schoolId: 'a', requestId }, updatedAt: serverTimestamp() });
    batch.set(doc(db, 'schools/a/staffChanges', requestId), { actorId: 'manager', userId: 'attack', schoolId: 'a', operation: patch.schoolIds ? 'remove' : 'jobTitle', payloadHash: '0'.repeat(64), createdAt: serverTimestamp() });
    await assertFails(batch.commit());
  }
  assert.equal((await read('users/attack')).role, 'viewer');
  assert.equal((await read('schools/a/memberships/attack')).status, 'active');
});
