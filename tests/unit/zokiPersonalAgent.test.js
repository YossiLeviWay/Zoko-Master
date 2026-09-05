import test from 'node:test';
import assert from 'node:assert/strict';
import { validSourcePath, mergeMemories, normalizeMemories, selectRelevantMemories } from '../../src/utils/zokiMemory.js';

test('retrieval accepts only current school records and own personal tasks', () => {
  assert.ok(validSourcePath('schools/a/students/student1', 'a', 'teacher'));
  assert.ok(validSourcePath('tasks_a/task1', 'a', 'teacher'));
  assert.ok(validSourcePath('users/teacher/personalTasks/task1', 'a', 'teacher'));
  for (const path of ['schools/b/students/student1', 'users/other/personalTasks/task1', 'users/teacher', 'schools/a/../users', 'schools/a/settings/private', 'schools/a/students/s/notes/n']) assert.equal(validSourcePath(path, 'a', 'teacher'), false);
});

test('memory rejects unsupported facts, secrets and forged sources; deduplicates preferences', () => {
  const mutation = { operation: 'upsert', type: 'preference', content: 'אני מעדיף תשובות קצרות', sourceIds: ['user'] };
  const first = mergeMemories([], [mutation], [], true);
  assert.equal(first.memories.length, 1);
  assert.equal(mergeMemories(first.memories, [mutation], [], true).changed.length, 0);
  assert.equal(mergeMemories([], [{ ...mutation, type: 'fact' }], [], true).memories.length, 0);
  assert.equal(mergeMemories([], [{ ...mutation, sourceIds: ['schools/other/students/s'] }], [], true).memories.length, 0);
  assert.equal(mergeMemories([], [{ ...mutation, content: 'password=secret' }], [], true).memories.length, 0);
  assert.equal(mergeMemories([], [mutation], [], false).memories.length, 0);
  assert.equal(mergeMemories(first.memories, [{ operation: 'delete', id: first.memories[0].id }], [], false).memories.length, 0);
});

test('untrusted stored memory must have a valid bounded shape', () => {
  assert.deepEqual(normalizeMemories([null, { content: {} }, { id: '../escape' }]), []);
  const now = Date.now();
  const source = { id: 'students_a/s' };
  const result = mergeMemories([], [{ operation: 'upsert', type: 'fact', content: 'מעקב נוכחות', sourceIds: [source.id] }], [source], true, now);
  assert.equal(normalizeMemories(result.memories).length, 1);
  assert.equal(mergeMemories(result.memories, [], [], true, now + 91 * 86400000).memories.length, 0);
});

test('prompt retrieval keeps durable and relevant memories while omitting unrelated facts', () => {
  const updatedAt = new Date().toISOString();
  const memories = [
    { id: 'preference', type: 'preference', content: 'אני מעדיף תשובות קצרות', refs: [], updatedAt, expiresAt: null },
    { id: 'attendance', type: 'fact', content: 'יש לעקוב אחרי נוכחות בכיתה יא', refs: [], updatedAt, expiresAt: null },
    { id: 'trip', type: 'fact', content: 'הטיול מתקיים ביום רביעי', refs: [], updatedAt, expiresAt: null },
    { id: 'followup', type: 'followup', content: 'לבדוק משימות פתוחות השבוע', refs: [], updatedAt, expiresAt: null },
  ];
  assert.deepEqual(selectRelevantMemories(memories, 'מה מצב הנוכחות?', 6).map(item => item.id), ['attendance', 'preference', 'followup']);
  assert.equal(selectRelevantMemories(memories, 'שלום', 2).length, 2);
  assert.ok(!selectRelevantMemories(memories, 'שלום', 6).some(item => item.id === 'trip'));
});
