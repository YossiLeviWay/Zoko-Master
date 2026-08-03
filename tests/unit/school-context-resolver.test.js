import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeminiSchoolContext,
  buildSchoolContextVersion,
  buildUserPermissionsVersion,
  clearSchoolContextCache,
  createLocalTaskProposal,
  loadSchoolContextSources,
  primeSchoolContext,
  resolveSchoolTaskContext,
  resolveTaskAssistantWithFallback,
} from '../../src/services/schoolContextResolver.js';

const baseSources = () => ({
  staff: [
    { id: 'trip-lead', fullName: 'שרה מובילה', jobTitle: 'רכזת טיולים', teamIds: ['trips'] },
    { id: 'teacher-11', fullName: 'דוד מחנך', jobTitle: 'מחנך', classIds: ['class-11'] },
    { id: 'private-user', fullName: 'אדם חסוי', identityNumber: '123456789', phone: '0500000000' },
  ],
  teams: [{ id: 'trips', name: 'צוות טיולים', responsibility: 'טיולים וסיורים', memberIds: ['trip-lead'], managerIds: ['trip-lead'] }],
  roles: [{ id: 'trip-role', name: 'רכז טיולים', description: 'אחריות על טיולים' }],
  classes: [{ id: 'class-11', name: 'כיתה י״א 1', grade: 'יא', teacherId: 'teacher-11' }],
  events: [{ id: 'event-1', title: 'ישיבת צוות', startDate: '2026-09-01' }],
  holidays: [{ id: 'holiday-1', name: 'חופשה', startDate: '2026-10-01', endDate: '2026-10-02' }],
  initiatives: [{ id: 'initiative-1', title: 'תכנית טיולים שנתית', teamId: 'trips' }],
  tasks: [{ id: 'task-1', title: 'הזמנת אוטובוס', teamId: 'trips' }],
  approvedRules: ['אין לקבוע פעילות ביום חסום'],
});

const fullPermissions = {
  __principal: true,
  'tasks.useAssistant': true,
};

function config(overrides = {}) {
  const sources = overrides.sources || baseSources();
  const permissions = overrides.permissions || fullPermissions;
  return {
    schoolId: overrides.schoolId || 'school-a',
    contextVersion: buildSchoolContextVersion(sources),
    userPermissionsVersion: buildUserPermissionsVersion(permissions),
    permissions,
    sources,
  };
}

test('school context source loaders start concurrently', async () => {
  const started = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const promise = loadSchoolContextSources({
    teams: async () => { started.push('teams'); await gate; return ['teams']; },
    roles: async () => { started.push('roles'); await gate; return ['roles']; },
    classes: async () => { started.push('classes'); await gate; return ['classes']; },
  });
  await Promise.resolve();
  assert.deepEqual(started.sort(), ['classes', 'roles', 'teams']);
  release();
  assert.deepEqual(await promise, { teams: ['teams'], roles: ['roles'], classes: ['classes'] });
});

test('resolver identifies the trips team and grade homeroom teacher', () => {
  clearSchoolContextCache();
  const result = resolveSchoolTaskContext({ ...config(), request: 'לקדם טיול לשכבת יא' });
  assert.equal(result.teams[0].id, 'trips');
  assert.equal(result.gradeClasses[0].id, 'class-11');
  assert.equal(result.homeroomTeachers[0].id, 'teacher-11');
  assert.equal(createLocalTaskProposal('לקדם טיול לשכבת יא', result).teamSuggestions[0], 'צוות טיולים');
});

test('cache is isolated by school and permission version and invalidates after a team change', () => {
  clearSchoolContextCache();
  const sources = baseSources();
  const firstConfig = config({ sources });
  const first = primeSchoolContext(firstConfig);
  assert.equal(first.teams[0].name, 'צוות טיולים');

  const changedSources = { ...sources, teams: [{ ...sources.teams[0], name: 'צוות מסעות' }] };
  const changed = primeSchoolContext(config({ sources: changedSources }));
  assert.equal(changed.teams[0].name, 'צוות מסעות');

  const restricted = primeSchoolContext(config({
    sources: changedSources,
    permissions: { 'tasks.useAssistant': true },
  }));
  assert.deepEqual(restricted.staff, []);
  assert.deepEqual(restricted.teams, []);
});

test('school context cache expires instead of becoming persistent browser state', () => {
  clearSchoolContextCache();
  const original = config();
  const first = primeSchoolContext({ ...original, now: 1000 });
  assert.equal(first.teams[0].name, 'צוות טיולים');
  const sources = baseSources();
  sources.teams[0].name = 'צוות מעודכן';
  const cached = primeSchoolContext({ ...original, sources, now: 2000 });
  assert.equal(cached.teams[0].name, 'צוות טיולים');
  const refreshed = primeSchoolContext({ ...original, sources, now: 122001 });
  assert.equal(refreshed.teams[0].name, 'צוות מעודכן');
});

test('Gemini context contains no people, record ids or sensitive fields', () => {
  clearSchoolContextCache();
  const local = resolveSchoolTaskContext({ ...config(), request: 'לקדם טיול לשכבת יא' });
  const gemini = buildGeminiSchoolContext(local);
  const serialized = JSON.stringify(gemini);
  assert.equal(serialized.includes('שרה מובילה'), false);
  assert.equal(serialized.includes('trip-lead'), false);
  assert.equal(serialized.includes('123456789'), false);
  assert.deepEqual(gemini.matchingTeamLabels, ['צוות טיולים']);
});

test('Gemini failure returns the local proposal instead of blocking task creation', async () => {
  const localProposal = createLocalTaskProposal('לקדם טיול לשכבת יא', resolveSchoolTaskContext({
    ...config(),
    request: 'לקדם טיול לשכבת יא',
  }));
  const result = await resolveTaskAssistantWithFallback({
    localProposal,
    generate: async () => { throw new Error('timeout'); },
  });
  assert.equal(result.usedLocalFallback, true);
  assert.equal(result.proposal.taskType, 'team');
  assert.deepEqual(result.proposal.teamSuggestions, ['צוות טיולים']);
});
