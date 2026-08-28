import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSchoolBrain,
  learningRecord,
  normalizedIntent,
  preserveApprovedPatterns,
  relevantBrainContext,
  sanitizeInstitutionalText,
  upsertApprovedPattern,
} from '../../worker/src/brain.js';
import { validatedAgentProposal } from '../../worker/src/index.js';

test('institutional sanitizer keeps names while removing sensitive identifiers', () => {
  const result = sanitizeInstitutionalText('התלמידה נועה כהן, ת״ז 123456789, כתובת רחוב הרצל 12 ומידע רפואי: נוטלת תרופה קבועה.');
  assert.match(result, /נועה כהן/u);
  assert.doesNotMatch(result, /123456789|הרצל 12|נוטלת תרופה/u);
  assert.match(result, /הוסר/u);
});

test('learning record attributes the source teacher and saved result', () => {
  const result = learningRecord({
    actor: { uid: 'teacher-1', fullName: 'יעל לוי' },
    schoolId: 'school-1',
    request: 'הכנת מבחנים לשכבת ח׳',
    savedTask: { id: 'task-1', title: 'הכנת מבחני ח׳' },
  });
  assert.equal(result.actorName, 'יעל לוי');
  assert.equal(result.savedTask.title, 'הכנת מבחני ח׳');
  assert.match(normalizedIntent(result.originalText), /מבחנים/u);
});

test('learning records recursively remove private fields before temporary storage', () => {
  const result = learningRecord({
    actor: { uid: 'teacher-1', fullName: 'יעל לוי' },
    schoolId: 'school-1',
    request: 'עבודה עם נועה כהן',
    savedTask: { title: 'שיחה', studentName: 'נועה כהן', phone: '050-1234567', details: { medicalInfo: 'רגישות' } },
  });
  assert.equal(result.savedTask.studentName, 'נועה כהן');
  assert.equal(result.savedTask.phone, undefined);
  assert.equal(result.savedTask.details.medicalInfo, undefined);
});

test('school brain is a single readable markdown file with approved patterns', () => {
  const markdown = createSchoolBrain({
    school: { id: 'school-1', name: 'בית ספר עתיד' },
    staff: [{ id: 'u1', name: 'יעל לוי', jobTitle: 'רכזת פדגוגית', teams: ['פדגוגי'], classes: [] }],
    students: [{ name: 'נועה כהן', className: 'ח׳1', grade: 'ח׳' }],
    patterns: [{ id: 'exam', name: 'הכנת מבחנים', contributors: ['יעל לוי'], roles: ['רכז פדגוגי'], steps: ['קביעת מועד'] }],
  });
  assert.match(markdown, /# המוח המוסדי/u);
  assert.match(markdown, /יעל לוי/u);
  assert.match(markdown, /נועה כהן/u);
  assert.match(markdown, /zoko:pattern:exam/u);
});

test('publishing a pattern updates its stable block without duplicating it', () => {
  const initial = createSchoolBrain({ school: { id: 's1', name: 'מוסד' }, patterns: [] });
  const first = upsertApprovedPattern(initial, { id: 'exam', name: 'מבחנים', steps: ['שלב ראשון'] });
  const second = upsertApprovedPattern(first, { id: 'exam', name: 'מבחנים מעודכנים', steps: ['שלב שני'] });
  assert.equal((second.match(/zoko:pattern:exam/g) || []).length, 2);
  assert.doesNotMatch(second, /שלב ראשון/u);
  assert.match(second, /שלב שני/u);
});

test('operational sync preserves patterns already approved in GitHub', () => {
  const previous = upsertApprovedPattern(createSchoolBrain({ school: { id: 's1' }, patterns: [] }), { id: 'exam', name: 'מבחנים', steps: ['תיאום'] });
  const generated = createSchoolBrain({ school: { id: 's1', name: 'שם מעודכן' }, patterns: [] });
  const result = preserveApprovedPatterns(previous, generated);
  assert.match(result, /שם מעודכן/u);
  assert.match(result, /zoko:pattern:exam/u);
});

test('brain context keeps relevant sections when the file is large', () => {
  const markdown = `# מוח\n\n## כללים\nבסיס\n${Array.from({ length: 30 }, (_, index) => `\n## תחום ${index}\nתוכן ${'א'.repeat(500)}`).join('')}\n## מבחנים\nרכז פדגוגי ומחנכי שכבה`;
  const context = relevantBrainContext(markdown, 'הכנת מבחנים לשכבה', 3500);
  assert.match(context, /רכז פדגוגי/u);
  assert.ok(context.length <= 3500);
});

test('worker removes people, teams and entities that are not in the approved brain', () => {
  const markdown = createSchoolBrain({
    school: { id: 's1', name: 'מוסד' },
    staff: [{ id: 'u1', name: 'יעל לוי', jobTitle: 'רכזת', teams: [], classes: [] }],
    units: [{ type: 'צוות', name: 'צוות פדגוגי' }, { type: 'כיתה', name: 'ח׳1' }],
  });
  const result = validatedAgentProposal({
    assigneeSuggestions: ['יעל לוי', 'אדם לא קיים'],
    teamSuggestions: ['צוות פדגוגי', 'צוות מומצא'],
    linkedEntitySuggestions: ['ח׳1', 'כיתה אחרת'],
  }, markdown);
  assert.deepEqual(result.assigneeSuggestions, ['יעל לוי']);
  assert.deepEqual(result.teamSuggestions, ['צוות פדגוגי']);
  assert.deepEqual(result.linkedEntitySuggestions, ['ח׳1']);
});
