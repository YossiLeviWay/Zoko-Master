import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPersonalContext, buildPersonalSnapshot, buildReflectionRequest, compactPersonalContext, emptyProfile,
  parseReflection, profileIsEmpty, sanitizeProfile, snapshotText,
} from '../../worker/src/personalBrain.js';

const now = new Date('2026-11-26T08:00:00Z');
const school = {
  uid: 'u1',
  user: { fullName: 'דנה כהן', jobTitle: 'מחנכת ט1', role: 'teacher', responsibilityAreas: ['חינוך חברתי'] },
  teams: [{ id: 't1', name: 'צוות ט', memberIds: ['u1', 'u2'], leaderIds: ['u1'] }, { id: 't2', name: 'צוות מדעים', memberIds: ['u2'] }],
  classes: [{ id: 'c1', name: 'ט1', teacherId: 'u1' }, { id: 'c2', name: 'י2', teacherId: 'u2' }],
  tasks: [
    { id: 'a', title: 'להגיש ציונים', dueDate: '2026-11-20', assigneeIds: ['u1'], status: 'open' },
    { id: 'b', title: 'טיול שנתי', dueDate: '2026-12-01', assigneeType: 'team', assigneeTeamId: 't1', status: 'open' },
    { id: 'c', title: 'משימה של מישהו אחר', dueDate: '2026-11-27', assigneeIds: ['u2'], status: 'open' },
    { id: 'd', title: 'משימה שהסתיימה', dueDate: '2026-11-27', assigneeIds: ['u1'], status: 'done' },
  ],
  events: [
    { id: 'e1', title: 'ישיבת צוות ט', date: '2026-11-29', visibleTo: ['t1'] },
    { id: 'e2', title: 'ישיבת מדעים', date: '2026-11-30', visibleTo: ['t2'] },
    { id: 'e3', title: 'יום הורים', date: '2026-12-03', visibleTo: 'all' },
    { id: 'e4', title: 'אירוע רחוק', date: '2027-02-01' },
  ],
  holidays: [{ id: 'h', name: 'חנוכה', startDate: '2026-12-06', endDate: '2026-12-13' }],
  now,
};

test('the snapshot holds only what belongs to this user', () => {
  const snapshot = buildPersonalSnapshot(school);
  assert.deepEqual(snapshot.teams, [{ name: 'צוות ט', lead: true }]);
  assert.deepEqual(snapshot.classes, [{ name: 'ט1', homeroom: true }]);
  assert.deepEqual(snapshot.tasks.map(task => task.title), ['להגיש ציונים', 'טיול שנתי']);
  assert.equal(snapshot.overdue, 1);
  assert.deepEqual(snapshot.events.map(event => event.title), ['ישיבת צוות ט', 'יום הורים']);
  const text = snapshotText(snapshot, now);
  assert.match(text, /דנה כהן, מחנכת ט1/u);
  assert.match(text, /באיחור מ-20\/11/u);
  assert.match(text, /חנוכה/u);
  assert.doesNotMatch(text, /משימה של מישהו אחר|ישיבת מדעים|אירוע רחוק/u);
});

test('the gantt lists a grade activity in the next two weeks, and a manager sees a team-only event', () => {
  const volunteering = { id: 'g', title: 'התנדבות', date: '2026-12-01', endDate: '2026-12-02', visibleTo: 'all', audience: { grade: 'י׳', kind: 'activity' }, category: 'חברתי' };
  const closed = { id: 'p', title: 'ישיבה סגורה', date: '2026-12-03', visibleTo: ['secret'] };
  const teacher = buildPersonalSnapshot({ ...school, events: [...school.events, volunteering, closed] });
  assert.deepEqual(teacher.events.filter(event => event.title === 'התנדבות'), [{ date: '2026-12-01', end: '2026-12-02', title: 'התנדבות', category: 'חברתי', grade: 'י׳', subject: '' }]);
  assert.ok(!teacher.events.some(event => event.title === 'ישיבה סגורה'));
  assert.match(snapshotText(teacher, now), /בגאנט ובלוח השנה בשבועיים הקרובים:/u);
  assert.match(snapshotText(teacher, now), /01\/12–02\/12 התנדבות \(שכבה י׳, חברתי\)/u);
  const principal = buildPersonalSnapshot({ ...school, user: { ...school.user, role: 'principal' }, manager: true, events: [closed] });
  assert.deepEqual(principal.events.map(event => event.title), ['ישיבה סגורה']);
});

test('a stored profile is cut to shape; an old mood and an old concern fade away', () => {
  const profile = sanitizeProfile({
    summary: 'x'.repeat(900), facts: ['מלמדת מתמטיקה 12 שנה', 'מלמדת מתמטיקה 12 שנה', 5, 'ת"ז 123456789'],
    preferences: Array.from({ length: 20 }, (_, index) => `העדפה מספר ${index}`),
    focus: [{ text: 'מבחן מחצית', since: '2026-11-20T00:00:00Z' }, { text: 'נושא ישן', since: '2026-08-01T00:00:00Z' }],
    mood: { tone: 'לחוץ', note: 'הרבה מטלות', at: '2026-11-01T00:00:00Z' }, turns: 4, junk: 'ignored',
  }, now);
  assert.equal(profile.summary.length, 500);
  assert.equal(profile.facts.length, 2);
  assert.ok(!profile.facts.join(' ').includes('123456789'));
  assert.equal(profile.preferences.length, 8);
  assert.deepEqual(profile.focus.map(item => item.text), ['מבחן מחצית']);
  assert.equal(profile.mood, null);
  assert.equal(profile.junk, undefined);
  assert.equal(sanitizeProfile({ mood: { tone: 'depressed', note: 'x' } }, now).mood, null);
  assert.ok(profileIsEmpty(emptyProfile()));
});

test('the personal context carries the guidance, the snapshot and what was learned', () => {
  const profile = sanitizeProfile({ summary: 'מחנכת מנוסה', preferences: ['תשובות קצרות בנקודות'], insights: ['להציע צעד אחד בכל פעם'], mood: { tone: 'עמוס', note: 'שבוע מבחנים', at: now.toISOString() } }, now);
  const context = buildPersonalContext({ snapshot: buildPersonalSnapshot(school), profile, now });
  for (const expected of ['התאם את הטון', 'דנה כהן', 'להגיש ציונים', 'תשובות קצרות בנקודות', 'להציע צעד אחד בכל פעם', 'עמוס']) assert.ok(context.includes(expected), expected);
  assert.equal(buildPersonalContext({}), '');
  const compact = compactPersonalContext({ snapshot: buildPersonalSnapshot(school), profile, now });
  assert.ok(compact.length <= 900 && compact.includes('דנה כהן') && compact.includes('עמוס'));
});

test('reflection sends the known profile and the exchange, and nothing when the user said nothing', () => {
  const request = buildReflectionRequest({ profile: { facts: ['מחנכת ט1'] }, messages: [{ role: 'user', content: 'אני מעדיפה תשובות קצרות' }], reply: 'בסדר גמור', role: 'מחנכת', model: 'm' });
  assert.equal(request.model, 'm');
  assert.match(request.messages[0].content, /מחנכת ט1/u);
  assert.match(request.messages[0].content, /המשתמש: אני מעדיפה תשובות קצרות\nזוקי: בסדר גמור/u);
  assert.equal(buildReflectionRequest({ profile: {}, messages: [{ role: 'assistant', content: 'שלום' }], model: 'm' }), null);
});

test('a reflection updates the profile; a broken one changes nothing', () => {
  const before = sanitizeProfile({ facts: ['מחנכת ט1'], focus: [{ text: 'מבחן מחצית', since: '2026-11-20T00:00:00.000Z' }], turns: 2 }, now);
  const answer = { content: [{ type: 'text', text: 'הנה:\n{"summary":"מחנכת שמעדיפה קיצור","facts":["מחנכת ט1"],"preferences":["תשובות קצרות"],"focus":["מבחן מחצית","טיול שנתי"],"insights":["לפתוח בשורה התחתונה"],"mood":{"tone":"לחוץ","note":"דדליין קרוב"}}' }] };
  const next = parseReflection(answer, before, now);
  assert.equal(next.turns, 3);
  assert.deepEqual(next.preferences, ['תשובות קצרות']);
  assert.equal(next.focus[0].since, '2026-11-20T00:00:00.000Z');
  assert.equal(next.focus[1].since, now.toISOString());
  assert.deepEqual([next.mood.tone, next.mood.at], ['לחוץ', now.toISOString()]);
  for (const broken of [{ content: [{ type: 'text', text: 'אין לי מה להוסיף' }] }, { content: [{ type: 'text', text: '{not json}' }] }, {}, { content: [{ type: 'text', text: '[1,2]' }] }]) {
    assert.deepEqual(parseReflection(broken, before, now), before);
  }
});
