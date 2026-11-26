import { subscribePrivateSession } from './browserPrivacy.js';

export const REPLY_CHOICES = Object.freeze([
  { id: 'done', label: 'בוצע', taskStatus: 'done' },
  { id: 'in_progress', label: 'בתהליך', taskStatus: 'in_progress' },
  { id: 'not_done', label: 'לא בוצע עדיין', taskStatus: 'todo' },
  { id: 'need_help', label: 'צריך עזרה', taskStatus: 'in_progress' },
]);

const CHOICE_IDS = new Set(REPLY_CHOICES.map(item => item.id));
const snoozed = new Set();
subscribePrivateSession(() => snoozed.clear());

const clean = (value, max) => String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
const day = value => (/^\d{4}-\d{2}-\d{2}$/u.test(value || '') ? value : '');
const safeId = value => (/^[\w-]{1,128}$/u.test(value || '') ? value : '');

export function canRequestReply({ manager = false, permissions = {} } = {}) {
  return manager || permissions.tasks_assign === true || permissions['tasks.assign'] === true;
}

export function choiceLabel(id) {
  return REPLY_CHOICES.find(item => item.id === id)?.label || '';
}

export function taskStatusForChoice(id) {
  return REPLY_CHOICES.find(item => item.id === id)?.taskStatus || '';
}

export function buildReplyRequest(input, actor, schoolId) {
  const question = clean(input.question, 500);
  const assigneeId = safeId(input.assigneeId);
  const sourceType = ['task', 'event', 'standalone'].includes(input.sourceType) ? input.sourceType : '';
  if (question.length < 2 || !assigneeId || !sourceType) return { error: 'חסרים נמען, סוג או שאלה.' };
  const sourceId = sourceType === 'standalone' ? '' : safeId(input.sourceId);
  if (sourceType !== 'standalone' && !sourceId) return { error: 'חסר פריט מקושר.' };
  const askedAt = new Date().toISOString();
  return {
    value: {
      schoolId,
      sourceType,
      sourceId,
      sourceTitle: clean(input.sourceTitle, 180),
      question,
      assigneeId,
      requesterId: actor.uid,
      requesterName: clean(actor.fullName, 120),
      status: 'open',
      dueDate: day(input.dueDate),
      reminderAt: clean(input.reminderAt, 40),
      answer: { choice: '', note: '', date: '', at: '', by: '' },
      history: [{ kind: 'asked', by: actor.uid, question, at: askedAt }],
      createdBy: actor.uid,
      updatedBy: actor.uid,
    },
  };
}

export function buildReplyAnswer(current, { choice, note = '', date = '' }, actor) {
  if (!current || current.status !== 'open' || current.assigneeId !== actor.uid) return { error: 'אין הרשאה לענות על הבקשה הזו.' };
  if (!CHOICE_IDS.has(choice)) return { error: 'בחרו סטטוס.' };
  const at = new Date().toISOString();
  const answer = { choice, note: clean(note, 2000), date: day(date), at, by: actor.uid };
  return {
    value: {
      status: 'answered',
      answer,
      history: [...(current.history || []), { kind: 'answered', by: actor.uid, choice, note: answer.note, date: answer.date, at }],
      updatedBy: actor.uid,
    },
  };
}

export function snoozeReply(id) { snoozed.add(id); }
export function isReplySnoozed(id) { return snoozed.has(id); }

export function promptsFor(items, uid) {
  return items.filter(item => item.status === 'open' && item.assigneeId === uid && !isReplySnoozed(item.id))
    .sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
}

export function openRequestsFor(items, uid, { manager = false } = {}) {
  return items.filter(item => item.status === 'open' && (manager || item.requesterId === uid));
}

export function answeredRequestsFor(items, uid, { manager = false } = {}) {
  return items.filter(item => item.status === 'answered' && (manager || item.requesterId === uid || item.assigneeId === uid))
    .sort((a, b) => String(b.answer?.at || '').localeCompare(String(a.answer?.at || '')));
}

export function stackSlice(items, expanded = false) {
  if (expanded || items.length <= 2) return { shown: items, hidden: 0 };
  return { shown: items.slice(0, 2), hidden: items.length - 2 };
}

export function unansweredSummary(items) {
  const open = items.filter(item => item.status === 'open');
  if (!open.length) return 'אין בקשות שממתינות לתשובה.';
  return open.map(item => `${item.assigneeName || item.assigneeId} — ${item.sourceTitle || item.question}`).join('\n');
}

export function rulesNotReady(error) {
  return /permission-denied|PERMISSION_DENIED|insufficient/iu.test(`${error?.code || ''} ${error?.message || ''}`);
}
