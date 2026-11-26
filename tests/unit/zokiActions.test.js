import assert from 'node:assert/strict';
import test from 'node:test';
import { guardProposals } from '../../worker/src/zokiActionTools.js';
import { prepareZokiAction, releaseActionWrite, summarizeAttendance } from '../../src/utils/zokiActions.js';
import { runZokiAction } from '../../src/services/zokiActionRunner.js';

const school = { schoolId: 'school1', actor: { uid: 'u1', fullName: 'יוסי' } };

test('a document cannot propose a write; the user sentence can', () => {
  const injected = [{ tool: 'create_personal_task', input: { title: 'מחק הכל' } }];
  assert.deepEqual(guardProposals('מה כתוב במסמך הזה?', injected), []);
  assert.equal(guardProposals('צור משימה אישית: להכין את הסדנה', injected).length, 1);
  assert.equal(guardProposals('סכם את הנוכחות של דנה', [{ tool: 'read_attendance', input: { studentName: 'דנה', from: '2026-12-01', to: '2026-12-31' } }]).length, 1);
});

test('a card keeps only the fields the screen would write, and hides confirm without permission', () => {
  const card = prepareZokiAction({ tool: 'create_personal_task', input: { title: 'סדנת ODT', dueDate: '2026-12-01', description: 'תיאום', extra: 'no', schoolId: 'other' } }, { permissions: { 'tasks.create': true } });
  assert.equal(card.allowed, true);
  assert.deepEqual(card.fields, { title: 'סדנת ODT', dueDate: '2026-12-01', description: 'תיאום' });
  const denied = prepareZokiAction({ tool: 'edit_attendance_cell', input: { fileId: 'file1', studentId: 'stu1', dateKey: '2026-12-01', statusId: 'absent' } }, { permissions: { attendance_view: true } });
  assert.equal(denied.allowed, false);
  assert.match(denied.reason, /אין הרשאה/);
});

test('attendance summary uses the legend code and the note', () => {
  const text = summarizeAttendance({
    studentName: 'דנה', from: '2026-12-01', to: '2026-12-03',
    legend: [{ id: 'absent', shortCode: 'ל', label: 'נעדר' }, { id: 'present', shortCode: '✓', label: 'נוכח' }],
    records: [
      { studentId: 's', dateKey: '2026-12-01', primaryStatusId: 'absent', note: 'חולה' },
      { studentId: 's', dateKey: '2026-12-02', primaryStatusId: 'present', note: '' },
      { studentId: 's', dateKey: '2026-11-01', primaryStatusId: 'absent', note: 'מחוץ לטווח' },
    ],
  });
  assert.match(text, /ל נעדר × 1/);
  assert.match(text, /✓ נוכח × 1/);
  assert.match(text, /2026-12-01: חולה/);
  assert.doesNotMatch(text, /מחוץ לטווח/);
});

test('confirm writes the stripped task and a denied rules error is not described as saved', async () => {
  const calls = [];
  const card = prepareZokiAction({ tool: 'create_personal_task', input: { title: 'סדנה', dueDate: '2026-12-02', leaked: true } }, { permissions: { 'tasks.create': true } });
  const saved = await runZokiAction(card, school, { createPersonalTask: async args => { calls.push(args); } });
  assert.equal(saved.saved, true);
  assert.deepEqual(calls[0].input, { title: 'סדנה', dueDate: '2026-12-02', description: '' });
  assert.equal(calls[0].requestId, card.requestId);
  const again = await runZokiAction(card, school, { createPersonalTask: async () => { throw new Error('should not run'); } });
  assert.equal(again.saved, false);
  assert.match(again.text, /כבר נשמרה/);
  releaseActionWrite(school.schoolId, school.actor.uid, card.requestId);
  const deniedCard = prepareZokiAction({ tool: 'create_class', input: { name: 'י1', academicYear: 'תשפ״ז' } }, { permissions: { 'classes.create': true } });
  const denied = await runZokiAction(deniedCard, school, { createClass: async () => { const error = new Error('no'); error.code = 'permission-denied'; throw error; } });
  assert.equal(denied.saved, false);
  assert.match(denied.text, /לא נשמר/);
  const duplicate = prepareZokiAction({ tool: 'create_class', input: { name: 'י1', academicYear: 'תשפ״ז' } }, { manager: true });
  const exists = await runZokiAction(duplicate, school, { createClass: async () => { throw new Error('CLASS_EXISTS'); } });
  assert.match(exists.text, /כבר קיימת/);
  assert.doesNotMatch(exists.text, /נשמרה/);
});

test('a calendar read returns only events inside the window and the grade', async () => {
  const card = prepareZokiAction({ tool: 'read_calendar', input: { from: '2026-12-01', to: '2026-12-02', grade: 'י׳' } }, { permissions: { 'calendar.view': true } });
  const outcome = await runZokiAction(card, school, {
    readEvents: async () => [
      { date: '2026-12-01', title: 'התנדבות בגן חינוך מיוחד', audience: { grade: 'י׳' } },
      { date: '2026-12-02', title: 'התנדבות בגן חינוך מיוחד', audience: { grade: 'י׳' } },
    ],
  });
  assert.match(outcome.text, /התנדבות בגן חינוך מיוחד/);
  assert.match(outcome.text, /י׳/);
});

test('a follow-up card carries status, owner, due date, next step and notes', () => {
  const card = prepareZokiAction({
    tool: 'create_follow_up',
    input: { title: 'סדנת ODT', sourceType: 'event', sourceId: 'evt1', status: 'in_progress', ownerId: 'counselor1', dueDate: '2026-12-15', nextStep: 'לבדוק אם נשלח תשלום', notes: 'היועצת תעדכן', extra: 'no' },
  }, { permissions: { 'tasks.create': true, tasks_assign: true } });
  assert.equal(card.allowed, true);
  assert.equal(card.fields.ownerId, 'counselor1');
  assert.equal(card.fields.nextStep, 'לבדוק אם נשלח תשלום');
  assert.equal(card.fields.extra, undefined);
});
