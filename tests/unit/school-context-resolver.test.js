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
import {
  buildTaskResponsibilityPlan,
  canSaveInstitutionalAgentRule,
} from '../../src/services/taskResponsibilityEngine.js';

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

test('similar tasks learn the current user\'s previous team and assignees without a server trigger', () => {
  clearSchoolContextCache();
  const sources = {
    ...baseSources(),
    staff: [{ id: 'media-lead', fullName: 'מובילת מדיה', jobTitle: 'רכזת מדיה' }],
    teams: [{ id: 'media', name: 'צוות מדיה', responsibility: 'צילום ותיעוד', memberIds: ['media-lead'] }],
    tasks: [{
      id: 'previous',
      title: 'ארגון יום צילום לצוות',
      teamId: 'media',
      assigneeIds: ['media-lead'],
    }],
  };
  const request = 'ארגון יום צילום נוסף';
  const context = resolveSchoolTaskContext({ ...config({ sources }), request });
  const proposal = createLocalTaskProposal(request, context);
  assert.deepEqual(proposal.teamSuggestions, ['צוות מדיה']);
  assert.equal(proposal.assignmentPlan.responsible.some(item => item.id === 'media-lead'), true);
  assert.match(proposal.reasoningSummary, /משימות דומות שלך/u);
});

function tripOrganizationSources() {
  return {
    ...baseSources(),
    staff: [
      { id: 'trip-lead', fullName: 'שרה מובילה', jobTitle: 'רכזת טיולים', teamIds: ['trips'] },
      { id: 'teacher-11', fullName: 'דוד מחנך', jobTitle: 'מחנך שכבת יא', classIds: ['class-11'] },
      { id: 'counselor', fullName: 'יעל יועצת', jobTitle: 'יועצת בית הספר', customRoleIds: ['counselor-role'] },
      { id: 'administrator', fullName: 'מיכל מנהלנית', jobTitle: 'מנהלנית', customRoleIds: ['admin-role'] },
      { id: 'secretary', fullName: 'נועה מזכירה', jobTitle: 'מזכירת בית הספר', customRoleIds: ['secretary-role'] },
      { id: 'principal', fullName: 'מנהל בית הספר', jobTitle: 'מנהל', role: 'principal' },
      { id: 'irrelevant', fullName: 'אורפז חן', jobTitle: 'מורה למתמטיקה' },
    ],
    teams: [{
      id: 'trips', name: 'צוות טיולים', description: 'טיולים וסיורים',
      responsibilityAreas: ['טיולים', 'מסעות'], keywords: ['טיול שנתי'], aliases: ['רכזי טיולים'],
      memberIds: ['trip-lead'], managerIds: ['trip-lead'],
      supportingRoles: ['יועצת', 'מנהלנית', 'מזכירה'], typicalTaskTypes: ['טיול שנתי'],
    }],
    roles: [
      { id: 'counselor-role', name: 'יועצת', description: 'ייעוץ וליווי' },
      { id: 'admin-role', name: 'מנהלנית', description: 'תפעול וספקים' },
      { id: 'secretary-role', name: 'מזכירה', description: 'תקשורת ואישורים' },
    ],
  };
}

test('annual trip plan assigns a real team leader and only relevant partners', () => {
  clearSchoolContextCache();
  const sources = tripOrganizationSources();
  const request = 'לקדם טיול שנתי לשכבת י״א בסוף נובמבר';
  const context = resolveSchoolTaskContext({ ...config({ sources }), request });
  const plan = buildTaskResponsibilityPlan({ request, context, now: new Date(2026, 7, 3) });
  assert.equal(plan.assignments.responsible.some(item => item.id === 'trips' && item.source === 'team'), true);
  assert.equal(plan.assignments.responsible.some(item => item.id === 'trip-lead'), true);
  assert.equal(plan.assignments.partners.some(item => item.id === 'teacher-11'), true);
  assert.equal(plan.assignments.partners.some(item => item.id === 'counselor'), true);
  assert.equal(plan.assignments.partners.some(item => item.id === 'administrator'), true);
  assert.equal(plan.assignments.partners.some(item => item.id === 'secretary'), true);
  assert.equal(JSON.stringify(plan.assignments).includes('אורפז חן'), false);
  assert.equal(plan.followUpQuestion, 'האם הטיול כולל לינה?');
  assert.deepEqual(plan.dateRange, { startDate: '2026-11-23', endDate: '2026-11-30' });
  assert.equal(plan.confidence, 'high');
});

test('overnight answer changes the annual trip steps and every step has a suggested party', () => {
  clearSchoolContextCache();
  const sources = tripOrganizationSources();
  const request = 'לקדם טיול שנתי לשכבת יא בסוף נובמבר';
  const context = resolveSchoolTaskContext({ ...config({ sources }), request });
  const withOvernight = buildTaskResponsibilityPlan({ request, answer: 'כן, כולל לינה', context });
  const dayTrip = buildTaskResponsibilityPlan({ request, answer: 'לא, זה טיול יומי', context });
  assert.equal(withOvernight.workPlanSteps.some(step => step.id === 'lodging'), true);
  assert.equal(dayTrip.workPlanSteps.some(step => step.id === 'lodging'), false);
  assert.equal(withOvernight.followUpQuestion, null);
  assert.equal(withOvernight.workPlanSteps.every(step => step.suggestedParties.length > 0), true);
});

test('agent asks one focused question when a matching team has no leader', () => {
  clearSchoolContextCache();
  const sources = tripOrganizationSources();
  sources.teams = [{ ...sources.teams[0], managerIds: [], leaderIds: [] }];
  const request = 'טיול שנתי לשכבת יא עם לינה';
  const context = resolveSchoolTaskContext({ ...config({ sources }), request });
  const plan = buildTaskResponsibilityPlan({ request, context });
  assert.equal(plan.followUpQuestion, 'לא הוגדר ראש צוות. מי יוביל את המשימה מטעם הצוות?');
});

test('institutional learning requires an explicit manager authorization', () => {
  assert.equal(canSaveInstitutionalAgentRule({}), false);
  assert.equal(canSaveInstitutionalAgentRule({ permissions: { 'tasks.managePlaybooks': false } }), false);
  assert.equal(canSaveInstitutionalAgentRule({ isManager: true }), true);
});
