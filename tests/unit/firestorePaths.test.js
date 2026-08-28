import test from 'node:test';
import assert from 'node:assert/strict';
import { schoolCollectionPath } from '../../src/services/firestore/paths.js';

test('task invitations always resolve to the server-managed school collection', () => {
  assert.equal(
    schoolCollectionPath('school_a', 'taskInvitations'),
    'schools/school_a/taskInvitations',
  );
});

test('gradebooks resolve to the tenant-scoped collection', () => {
  assert.equal(
    schoolCollectionPath('school_a', 'gradebooks'),
    'schools/school_a/gradebooks',
  );
});

test('collective brain boards resolve to the tenant-scoped collection', () => {
  assert.equal(
    schoolCollectionPath('school_a', 'collectiveBrainBoards'),
    'schools/school_a/collectiveBrainBoards',
  );
});

test('unknown school resources fail closed', () => {
  assert.throws(
    () => schoolCollectionPath('school_a', 'notConfigured', 'nested'),
    /Unsupported school resource/,
  );
});
