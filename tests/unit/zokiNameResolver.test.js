import test from 'node:test';
import assert from 'node:assert/strict';
import { labelCard, matchByName, resolveZokiProposal } from '../../src/services/zokiNameResolver.js';
import { V1_TOOLS, guardProposals } from '../../worker/src/zokiActionTools.js';
import { prepareZokiAction, releaseActionWrite } from '../../src/utils/zokiActions.js';
import { runZokiAction } from '../../src/services/zokiActionRunner.js';

const classes = [
  { id: 'c1', label: 'הכיתה של יעקב', data: { name: 'הכיתה של יעקב', gradeLevel: 'י״א', academicYear: 'תשפ״ז', teacherId: 't1', studyDays: [0, 1], status: 'active' } },
  { id: 'c2', label: 'הכיתה של שרון', data: { name: 'הכיתה של שרון' } },
];
const staff = [{ id: 'u1', label: 'דגנית בן חיים', data: {} }, { id: 'u2', label: 'שירן אלקלעי', data: {} }];
const loaders = { classes: async () => classes, staff: async () => staff, teams: async () => [], tasks: async () => [], students: async () => [] };

test('a class is found by its name, exact or partial, and never guessed when several match', () => {
  assert.equal(matchByName(classes, 'הכיתה של יעקב').item.id, 'c1');
  assert.equal(matchByName(classes, 'יעקב').item.id, 'c1');
  assert.equal(matchByName(classes, 'הכיתה של').error, 'many');
  assert.equal(matchByName(classes, 'כיתה שלא קיימת').error, 'none');
});

test('every tool that needed an id accepts a name instead and no longer requires the id', () => {
  assert.ok(V1_TOOLS.update_class.properties.className);
  assert.deepEqual(V1_TOOLS.update_class.required, []);
  assert.ok(V1_TOOLS.set_task_assignee.properties.assigneeName && V1_TOOLS.set_task_assignee.properties.taskTitle);
  assert.equal(V1_TOOLS.add_team_members.properties.memberNames.type, 'array');
  assert.deepEqual(V1_TOOLS.create_personal_task.required, ['title']);
});

test('the answer to a clarifying question keeps the write request that came before it', () => {
  const proposal = [{ tool: 'update_class', input: { className: 'הכיתה של יעקב', gradeLevel: 'י״ב' } }];
  assert.equal(guardProposals('אין לי מזהה כיתה רק את השם שלה: הכיתה של יעקב', proposal).length, 0);
  assert.equal(guardProposals('אין לי מזהה כיתה רק את השם שלה: הכיתה של יעקב', proposal, 'תשנה את השכבה של הכיתה של יעקב לי״ב').length, 1);
});

test('updating a class by name changes only the requested field and can be undone', async () => {
  const resolved = await resolveZokiProposal({ tool: 'update_class', input: { className: 'הכיתה של יעקב', gradeLevel: 'י״ב' } }, { schoolId: 's1' }, loaders);
  assert.equal(resolved.proposal.input.classId, 'c1');
  const card = labelCard(prepareZokiAction(resolved.proposal, { manager: true, actorId: 'boss' }), resolved.labels);
  assert.equal(card.allowed, true);
  assert.ok(card.lines[0].includes('הכיתה של יעקב') && !card.lines[0].includes('c1'));
  const calls = [];
  const io = { db: {}, getClass: async () => classes[0].data, updateClass: async input => { calls.push(input); } };
  const outcome = await runZokiAction(card, { schoolId: 's1', manager: true, actor: { uid: 'boss' } }, io);
  releaseActionWrite('s1', 'boss', card.requestId);
  assert.equal(outcome.saved, true);
  assert.equal(calls[0].input.gradeLevel, 'י״ב');
  assert.equal(calls[0].input.name, 'הכיתה של יעקב');
  assert.equal(calls[0].input.teacherId, 't1');
  assert.deepEqual(calls[0].input.studyDays, [0, 1]);
  assert.equal(outcome.undo.fields.gradeLevel, 'י״א');
});

test('people are found by name, and an unknown or ambiguous name is explained instead of saved', async () => {
  const ok = await resolveZokiProposal({ tool: 'update_class', input: { className: 'שרון', teacherName: 'דגנית' } }, { schoolId: 's1' }, loaders);
  assert.equal(ok.proposal.input.teacherId, 'u1');
  const missing = await resolveZokiProposal({ tool: 'update_class', input: { className: 'ח׳ 3', gradeLevel: 'ח' } }, { schoolId: 's1' }, loaders);
  assert.match(missing.error, /לא מצאתי כיתה/u);
  const many = await resolveZokiProposal({ tool: 'update_class', input: { className: 'הכיתה של', gradeLevel: 'ח' } }, { schoolId: 's1' }, loaders);
  assert.match(many.error, /כמה התאמות/u);
  const members = await resolveZokiProposal({ tool: 'add_team_members', input: { teamId: 'x', memberNames: ['שירן'] } }, { schoolId: 's1' }, { ...loaders, teams: async () => [{ id: 'x', label: 'צוות טיולים', data: {} }] });
  assert.deepEqual(members.proposal.input.memberIds, ['u2']);
});

test('a class roster is a browser-side read: offered, kept for the browser, and listed by class or grade', async () => {
  const { isReadTool } = await import('../../worker/src/zokiToolRound.js');
  const { buildClaudeRequest } = await import('../../worker/src/claude.js');
  assert.equal(isReadTool('list_class_students'), false);
  assert.equal(isReadTool('read_calendar'), true);
  const ask = [{ tool: 'list_class_students', input: { gradeLevel: 'י״ב' } }];
  assert.equal(guardProposals('רשימה שמית לכיתה י״ב', ask).length, 1);
  const request = buildClaudeRequest({ profile: { systemPrompt: 'x', tools: [] }, messages: [{ role: 'user', content: 'רשימה' }], heldKeys: ['students.view'] });
  assert.ok(request.tools.some(tool => tool.name === 'list_class_students'));
  assert.ok(!request.tools.some(tool => tool.name === 'read_students'));

  const graded = [{ id: 'c1', label: 'הכיתה של יעקב', data: { gradeLevel: 'י"ב' } }];
  const resolved = await resolveZokiProposal({ tool: 'list_class_students', input: { className: 'י״ב' } }, { schoolId: 's1' }, { ...loaders, classes: async () => graded });
  assert.equal(resolved.proposal.input.gradeLevel, 'י״ב');
  assert.equal(resolved.proposal.input.classId, undefined);
  const byName = await resolveZokiProposal({ tool: 'list_class_students', input: { className: 'יעקב' } }, { schoolId: 's1' }, { ...loaders, classes: async () => graded });
  assert.equal(byName.proposal.input.classId, 'c1');

  const card = prepareZokiAction(resolved.proposal, { manager: true, actorId: 'boss' });
  assert.equal(card.allowed, true);
  assert.equal(card.write, false);
  const io = { listClassStudents: async () => [{ className: 'הכיתה של יעקב', gradeLevel: 'י״ב', students: ['אליה לב', 'נתן דדשב'] }] };
  const outcome = await runZokiAction(card, { schoolId: 's1', manager: true, actor: { uid: 'boss' } }, io);
  assert.match(outcome.text, /הכיתה של יעקב/u);
  assert.match(outcome.text, /1\. אליה לב\n2\. נתן דדשב/u);
  const empty = await runZokiAction(card, { schoolId: 's1', manager: true, actor: { uid: 'boss' } }, { listClassStudents: async () => [] });
  assert.match(empty.text, /לא מצאתי כיתות בשכבה/u);
});
