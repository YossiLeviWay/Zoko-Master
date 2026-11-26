import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { prepareZokiAction } from '../../src/utils/zokiActions.js';
import { guardProposals } from '../../worker/src/zokiActionTools.js';
import {
  answeredRequestsFor,
  buildReplyAnswer,
  buildReplyRequest,
  canRequestReply,
  openRequestsFor,
  promptsFor,
  snoozeReply,
  stackSlice,
  taskStatusForChoice,
  unansweredSummary,
} from '../../src/utils/replyRequests.js';

const actor = { uid: 'manager1', fullName: 'יוסי' };
const counselor = { uid: 'counselor1', fullName: 'היועצת' };

test('only a manager or someone who can assign tasks may request a reply', () => {
  assert.equal(canRequestReply({ permissions: {} }), false);
  assert.equal(canRequestReply({ permissions: { tasks_edit: true } }), false);
  assert.equal(canRequestReply({ permissions: { tasks_assign: true } }), true);
  assert.equal(canRequestReply({ manager: true }), true);
  const denied = prepareZokiAction({ tool: 'request_reply', input: { question: 'האם נשלח תשלום?', assigneeId: 'counselor1', sourceType: 'task', sourceId: 'task1', sourceTitle: 'סדנת ODT' } }, { permissions: { 'tasks.create': true } });
  assert.equal(denied.allowed, false);
  const allowed = prepareZokiAction({ tool: 'request_reply', input: { question: 'האם נשלח תשלום?', assigneeId: 'counselor1', sourceType: 'task', sourceId: 'task1', sourceTitle: 'סדנת ODT', extra: 'no' } }, { permissions: { tasks_assign: true } });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.fields.extra, undefined);
  assert.equal(allowed.fields.question, 'האם נשלח תשלום?');
});

test('a reply stores the question, and only the assignee can answer with a status, note and date', () => {
  const built = buildReplyRequest({ question: 'האם תיאמת את סדנת ODT? נשלח תשלום?', assigneeId: 'counselor1', sourceType: 'task', sourceId: 'task1', sourceTitle: 'תקציב אס״א', dueDate: '2026-12-15' }, actor, 'school1');
  assert.equal(built.value.status, 'open');
  assert.equal(built.value.requesterId, 'manager1');
  assert.equal(built.value.history[0].kind, 'asked');
  const stranger = buildReplyAnswer(built.value, { choice: 'done' }, { uid: 'other' });
  assert.match(stranger.error, /אין הרשאה/);
  const answer = buildReplyAnswer({ ...built.value, assigneeId: 'counselor1' }, { choice: 'in_progress', note: 'הסדנה נקבעה, התשלום עדיין לא', date: '2026-12-20' }, counselor);
  assert.equal(answer.value.status, 'answered');
  assert.equal(answer.value.answer.choice, 'in_progress');
  assert.equal(answer.value.history.at(-1).kind, 'answered');
  assert.equal(taskStatusForChoice('done'), 'done');
  assert.equal(taskStatusForChoice('not_done'), 'todo');
  assert.equal(taskStatusForChoice('need_help'), 'in_progress');
});

test('the prompt stack stays compact, a snooze hides it for this session, and unanswered people are listed', () => {
  const items = [1, 2, 3].map(index => ({ id: `r${index}`, status: 'open', assigneeId: 'counselor1', requesterId: 'manager1', sourceTitle: `סדנה ${index}`, question: '?', dueDate: `2026-12-0${index}` }));
  assert.equal(stackSlice(items).shown.length, 2);
  assert.equal(stackSlice(items).hidden, 1);
  assert.equal(stackSlice(items, true).shown.length, 3);
  assert.equal(promptsFor(items, 'counselor1').length, 3);
  snoozeReply('r1');
  assert.equal(promptsFor(items, 'counselor1').map(item => item.id).includes('r1'), false);
  assert.equal(openRequestsFor(items, 'manager1').length, 3);
  assert.equal(answeredRequestsFor([{ ...items[0], status: 'answered', answer: { choice: 'done', at: '2026-12-01' } }], 'manager1').length, 1);
  assert.match(unansweredSummary([{ status: 'open', assigneeId: 'counselor1', assigneeName: 'היועצת', sourceTitle: 'סדנת ODT' }]), /היועצת/);
  assert.equal(guardProposals('מי לא ענה?', [{ tool: 'list_unanswered_replies', input: {} }]).length, 1);
  assert.equal(guardProposals('בקש עדכון מהיועצת על הסדנה', [{ tool: 'request_reply', input: { question: 'האם שולם?', assigneeId: 'counselor1', sourceType: 'standalone' } }]).length, 1);
});

test('the rules change is in the file and is not a deployed function', () => {
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /function canAskForReply/);
  assert.match(rules, /function replyRequestAnswerAllowed/);
  assert.match(rules, /match \/replyRequests\/\{requestId\}/);
  assert.match(rules, /allow delete: if false;/);
  const indexes = readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8');
  assert.match(indexes, /replyRequests/);
});
