import test from 'node:test';
import assert from 'node:assert/strict';
import { HOSTING_PROXY, LOCAL_DATA_NOTE, LOCAL_MODEL_NOTE, answerFromSchoolData, isWorkerNetworkError, schoolGrounding } from '../../src/utils/zokiOffline.js';
import { offlineAnswer } from '../../src/services/zokiOfflineAnswer.js';

const sources = {
  events: [
    { title: 'שיעור חינוך', date: '2026-11-26', certainty: 'confirmed', email: 'hidden@example.com' },
    { title: 'טיול', date: '2026-11-26', certainty: 'tentative' },
    { title: 'ישיבה', date: '2026-11-24' },
  ],
  tasks: [
    { title: 'להכין מערך', dueDate: '2026-11-27', status: 'todo', description: 'הערה אישית' },
    { title: 'נסגר', status: 'done' },
  ],
  classes: [
    { name: 'י1', gradeLevel: 'י', status: 'active', teacherPhone: '050' },
    { name: 'ארכיון', status: 'archived' },
  ],
};

test('a blocked worker is a network error, and the hosting proxy is not available', () => {
  assert.equal(isWorkerNetworkError({ code: 'worker-unreachable' }), true);
  assert.equal(isWorkerNetworkError({ code: 'worker-timeout' }), false);
  assert.equal(isWorkerNetworkError({ code: 'resource-exhausted' }), false);
  assert.equal(HOSTING_PROXY.available, false);
  assert.match(HOSTING_PROXY.reason, /Cloud Functions/);
});

test('offline grounding keeps schedule, tasks and classes, and drops private fields', () => {
  const grounding = schoolGrounding(sources, '2026-11-26');
  assert.equal(grounding.events.length, 3);
  assert.equal(JSON.stringify(grounding).includes('hidden@example.com'), false);
  assert.equal(JSON.stringify(grounding).includes('050'), false);
  assert.equal(JSON.stringify(grounding).includes('הערה אישית'), false);
  assert.deepEqual(grounding.tasks.map(task => task.title), ['להכין מערך']);
  assert.deepEqual(grounding.classes.map(item => item.name), ['י1']);
});

test('the data answer lists today, and a local model replaces it without an action', async () => {
  const grounding = schoolGrounding(sources, '2026-11-26');
  const data = answerFromSchoolData('מה הלוז היום?', grounding);
  assert.match(data, /שיעור חינוך/);
  assert.match(data, /טיול · לא סגור/);
  assert.doesNotMatch(data, /ישיבה/);
  const model = await offlineAnswer({
    question: 'מה הלוז היום?',
    sources,
    today: '2026-11-26',
    model: async () => 'היום יש שיעור חינוך וטיול.',
  });
  assert.equal(model.layer, 'local-model');
  assert.equal(model.note, LOCAL_MODEL_NOTE);
  assert.equal(model.clientAction, null);
  const dataOnly = await offlineAnswer({
    question: 'מה הלוז היום?',
    sources,
    today: '2026-11-26',
    model: async () => null,
  });
  assert.equal(dataOnly.layer, 'local-data');
  assert.equal(dataOnly.note, LOCAL_DATA_NOTE);
  assert.match(dataOnly.answer, /שיעור חינוך/);
});
