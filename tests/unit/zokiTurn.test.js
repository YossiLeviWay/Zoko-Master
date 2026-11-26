import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_SCHEMAS } from '../../worker/src/claude.js';
import { buildLocalRequest } from '../../worker/src/localModel.js';
import { appendLearningLog, buildSchoolContext, claudeLimitFor, dailyLimitFor, dayKey, learningLogLine, looksLikeAction, replyWithStoredMemory, replyWithoutFalseSave, secondsToMidnight, stripStudentSection, teachingNote, toolSpecs, validatedProposal, withoutMilestoneRetraction } from '../../worker/src/zokiTurn.js';

test('daily limits depend on the role and can be overridden', () => {
  assert.equal(dailyLimitFor('principal'), 300);
  assert.equal(dailyLimitFor('teacher'), 60);
  assert.equal(dailyLimitFor('viewer'), 20);
  assert.equal(dailyLimitFor('teacher', { ZOKI_DAILY_LIMITS: '{"teacher":5}' }), 5);
  assert.equal(dailyLimitFor('teacher', { ZOKI_DAILY_LIMITS: 'not json' }), 60);
  assert.equal(dayKey(new Date('2026-11-25T23:59:00Z')), '2026-11-25');
  assert.equal(secondsToMidnight(new Date('2026-11-25T23:59:00Z')), 60);
});

test('only instructions are routed to an action; questions are not', () => {
  assert.equal(looksLikeAction('פתח כיתה חדשה ט2'), true);
  assert.equal(looksLikeAction('בבקשה תיצור משימה להזמנת אוטובוס'), true);
  assert.equal(looksLikeAction('כמה כיתות יש בבית הספר?'), false);
  assert.equal(looksLikeAction('מתי מגישים תוכנית טיולים'), false);
});

test('teaching becomes a short personal note, nothing else does', () => {
  assert.equal(teachingNote('זכור שאני מחנכת של ז2'), 'אני מחנכת של ז2');
  assert.equal(teachingNote('תזכור שאני פותח ישיבות בסיכום החלטות'), 'אני פותח ישיבות בסיכום החלטות');
  assert.equal(teachingNote('חשוב שתדע: אצלי ישיבות הנהלה נפתחות בסיכום החלטות'), 'אצלי ישיבות הנהלה נפתחות בסיכום החלטות');
  assert.equal(teachingNote('העדפות שלי: תענה תמיד בעברית קצרה ובנקודות'), 'תענה תמיד בעברית קצרה ובנקודות');
  assert.equal(teachingNote('מי מחנכת ז2?'), '');
  assert.equal(teachingNote('זכור'), '');
  assert.equal(replyWithoutFalseSave('רשמתי. אזכור את זה.', false), 'לא שמרתי את זה כזיכרון. כדי שאשמור, התחילו ב«תזכור ש…», «חשוב שתדע: …» או «העדפות שלי: …».');
  assert.equal(replyWithoutFalseSave('רשמתי.', true), 'רשמתי.');
  assert.equal(replyWithoutFalseSave('הנה מבנה לישיבה.', false), 'הנה מבנה לישיבה.');
  const meeting = 'אצלי ישיבות הנהלה בנויות כך שכל בעל תפקיד מציג 2 דקות ומעלה רעיון אחד לשיפור, ולא עדכונים.';
  assert.equal(replyWithStoredMemory('שמרתי: כל בעל תפקיד מציג 2 דקות לכל היותר.', meeting), `נשמר כלשונו: ${meeting}`);
  assert.equal(replyWithStoredMemory(`נשמר כלשונו: ${meeting}\nהנה מבנה.`, meeting), `נשמר כלשונו: ${meeting}\nהנה מבנה.`);
  assert.equal(teachingNote(`חשוב שתדע: ${meeting}`), meeting);
  assert.equal(replyWithStoredMemory('הנה מבנה לישיבה.', ''), 'הנה מבנה לישיבה.');
  const milestones = 'אבני דרך קרובות של התפקיד בלבד (תשפ״ז). אלה אינן אירועים בגאנט:\n• אסיפת הורים (עד 30.11.2026)\n• ועדת התמדה ראשונה (עד 30.11.2026)';
  const retracted = withoutMilestoneRetraction('אסיפת הורים עד 30.11.\nאסיפת הורים לא מופיעה בנתונים, זו הייתה טעות.\nועדת התמדה ראשונה היא אבן דרך של התפקיד.', milestones);
  assert.match(retracted, /אבן דרך של התפקיד/u);
  assert.doesNotMatch(retracted, /טעות/u);
});

test('students are hidden from the model unless the user may see them', () => {
  const md = '# מוח\n\n## סגל\n\nדנה\n\n## תלמידים והקשרים לימודיים\n\n| נועה לוי | ז1 |\n\n## לוח שנה\n\nטיול';
  assert.ok(!stripStudentSection(md).includes('נועה לוי'));
  assert.ok(stripStudentSection(md).includes('לוח שנה'));
  assert.ok(!buildSchoolContext({ markdown: md, canSeeStudents: false }).includes('נועה לוי'));
  assert.ok(buildSchoolContext({ markdown: md, canSeeStudents: true }).includes('נועה לוי'));
});

test('context is bounded and carries the user memories', () => {
  const ctx = buildSchoolContext({ markdown: 'א'.repeat(50000), memories: [{ content: 'אני מחנכת ז2' }], maxChars: 3000 });
  assert.ok(ctx.length <= 3000);
  assert.ok(buildSchoolContext({ markdown: 'קצר', memories: [{ content: 'אני מחנכת ז2' }] }).includes('אני מחנכת ז2'));
  assert.equal(buildLocalRequest({ messages: [{ role: 'user', content: 'שלום' }], context: 'נתונים' }).context, 'נתונים');
  assert.equal('context' in buildLocalRequest({ messages: [{ role: 'user', content: 'שלום' }] }), false);
});

test('a proposal is accepted only for a tool the user holds, with known fields', () => {
  const allowed = ['create_task'];
  assert.equal(validatedProposal({ tool: 'read_class_grades', input: { classId: 'x' } }, allowed, TOOL_SCHEMAS), null);
  assert.equal(validatedProposal({ tool: 'delete_everything', input: {} }, allowed, TOOL_SCHEMAS), null);
  assert.equal(validatedProposal({ tool: null }, allowed, TOOL_SCHEMAS), null);
  const ok = validatedProposal({ tool: 'create_task', input: { title: 'להזמין אוטובוס', hack: 'x' } }, allowed, TOOL_SCHEMAS);
  assert.deepEqual(ok, { tool: 'create_task', input: { title: 'להזמין אוטובוס' }, missing: [] });
  assert.deepEqual(validatedProposal({ tool: 'create_task', input: {} }, allowed, TOOL_SCHEMAS).missing, ['title']);
  assert.deepEqual(toolSpecs(['create_task', 'nope'], TOOL_SCHEMAS).map(item => item.name), ['create_task']);
});

test('the learning log appends dated lines and stays bounded', () => {
  const line = learningLogLine({ at: new Date('2026-11-25T10:30:00Z'), kind: 'דפוס אושר', actor: 'דנה', summary: 'הזמנת אוטובוס\nלטיול' });
  assert.equal(line, '- 2026-11-25 10:30 · דפוס אושר · דנה · הזמנת אוטובוס לטיול');
  let log = '';
  for (let i = 0; i < 400; i += 1) log = appendLearningLog(log, `${line} ${i}`, 5000);
  assert.ok(log.startsWith('# יומן למידה של זוקי'));
  assert.ok(log.length <= 5000 + 200);
  assert.ok(log.trimEnd().endsWith('399'));
});

test('each role has its own Claude allowance, below its daily limit', () => {
  assert.equal(claudeLimitFor('teacher'), 25);
  assert.equal(claudeLimitFor('principal'), 100);
  assert.equal(claudeLimitFor('teacher', { ZOKI_CLAUDE_LIMITS: '{"teacher":0}' }), 0);
  assert.ok(claudeLimitFor('teacher') < dailyLimitFor('teacher'));
});
