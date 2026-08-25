import { inferTaskTeamSuggestion, normalizeTaskAssistantProposal, redactTaskAssistantInput } from '../utils/taskAssistant.js';
import { buildTaskResponsibilityPlan } from './taskResponsibilityEngine.js';

const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map();
const CONTEXT_TYPES = new Set([
  'teams',
  'teamMembers',
  'roles',
  'relevantRoles',
  'classes',
  'gradeHomeroomTeachers',
  'calendar',
  'initiatives',
  'tasks',
  'approvedRules',
  'playbooks',
]);

const text = (value, maxLength = 180) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
const ids = value => Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 100) : [];
const unique = values => [...new Set(values.filter(Boolean))];
const dateText = value => /^\d{4}-\d{2}-\d{2}/u.test(text(value, 32)) ? text(value, 10) : '';

function timestampValue(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  return text(value, 40);
}

function stableVersion(items = []) {
  const value = items.map(rawItem => {
    const item = typeof rawItem === 'string' ? { name: rawItem } : rawItem;
    return [
      text(item?.id || item?.uid, 128),
      text(item?.name || item?.title || item?.fullName, 180),
      text(item?.description || item?.responsibility || item?.status, 180),
      text(item?.grade || item?.gradeLevel || item?.role || item?.jobTitle, 80),
      text(item?.teacherId || item?.homeroomTeacherId || item?.managerId, 128),
      dateText(item?.startDate || item?.date),
      dateText(item?.endDate || item?.dueDate),
      timestampValue(item?.updatedAt || item?.createdAt),
      unique([
        ...ids(item?.memberIds),
        ...ids(item?.staffIds),
        ...ids(item?.teamIds),
        ...ids(item?.classIds),
        ...ids(item?.customRoleIds),
        ...Object.values(item?.customRoleAssignments || {}).flatMap(ids),
        ...ids(item?.leaderIds),
        ...ids(item?.managerIds),
        ...ids(item?.responsibilityAreas),
        ...ids(item?.keywords),
        ...ids(item?.aliases),
        ...ids(item?.supportingRoles),
        ...ids(item?.typicalTaskTypes),
      ]).sort().join(','),
    ].join(':');
  }).sort().join('|');
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildSchoolContextVersion(sources = {}) {
  return [
    sources.staff,
    sources.teams,
    sources.roles,
    sources.classes,
    sources.events,
    sources.holidays,
    sources.initiatives,
    sources.tasks,
    sources.approvedRules,
    sources.playbooks,
  ].map(stableVersion).join('.');
}

export function buildUserPermissionsVersion(permissions = {}) {
  const value = Object.entries(permissions)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key)
    .sort()
    .join('|') || 'viewer';
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export async function loadSchoolContextSources(loaders = {}) {
  const entries = Object.entries(loaders);
  const values = await Promise.all(entries.map(([, loader]) => loader()));
  return Object.fromEntries(entries.map(([key], index) => [key, values[index]]));
}

function canRead(permissions, ...keys) {
  return keys.some(key => permissions?.[key] === true);
}

function sanitizeStaff(item, schoolId) {
  return {
    id: text(item?.uid || item?.id, 128),
    name: text(item?.fullName || item?.displayName || item?.name),
    jobTitle: text(item?.jobTitle || item?.position || item?.profession || item?.roleName),
    role: text(item?.role, 80),
    teamIds: ids(item?.teamIds),
    classIds: ids(item?.classIds),
    customRoleIds: unique([
      ...ids(item?.customRoleIds),
      ...ids(item?.customRoleAssignments?.[schoolId]),
    ]),
  };
}

function sanitizeTeam(item) {
  return {
    id: text(item?.id, 128),
    name: text(item?.name || item?.title),
    responsibility: text(item?.responsibility || item?.description || item?.domain, 280),
    memberIds: ids(item?.memberIds),
    leaderIds: unique([...ids(item?.leaderIds), ...ids(item?.managerIds), text(item?.managerId, 128)]),
    responsibilityAreas: unique([...ids(item?.responsibilityAreas), text(item?.responsibility, 120)]),
    keywords: ids(item?.keywords),
    aliases: ids(item?.aliases),
    supportingRoles: ids(item?.supportingRoles),
    typicalTaskTypes: ids(item?.typicalTaskTypes),
  };
}

function sanitizeRole(item) {
  return {
    id: text(item?.id, 128),
    name: text(item?.name || item?.title),
    description: text(item?.description, 280),
    responsibilityAreas: ids(item?.responsibilityAreas),
    relatedTeamIds: ids(item?.relatedTeamIds),
    relatedClassIds: ids(item?.relatedClassIds),
    relatedGrades: ids(item?.relatedGrades),
    commonTaskTypes: ids(item?.commonTaskTypes),
  };
}

function sanitizeClass(item) {
  return {
    id: text(item?.id, 128),
    name: text(item?.name || item?.title),
    grade: text(item?.grade || item?.gradeLevel || item?.layer, 40),
    homeroomTeacherIds: unique([
      text(item?.teacherId, 128),
      text(item?.homeroomTeacherId, 128),
      ...ids(item?.homeroomTeacherIds),
    ]),
    staffIds: ids(item?.staffIds),
  };
}

function sanitizeCalendarItem(item, kind) {
  return {
    id: text(item?.id, 128),
    title: text(item?.title || item?.name),
    startDate: dateText(item?.startDate || item?.date),
    endDate: dateText(item?.endDate || item?.startDate || item?.date),
    blocked: item?.blocked === true || item?.isBlocked === true || item?.isSchoolDay === false || kind === 'holiday',
    kind,
  };
}

function sanitizeWorkItem(item, kind) {
  return {
    id: text(item?.id, 128),
    title: text(item?.title || item?.name),
    teamId: text(item?.teamId || item?.assigneeTeamId, 128),
    classIds: ids(item?.classIds),
    status: text(item?.status, 60),
    dueDate: dateText(item?.dueDate || item?.endDate),
    assigneeIds: ids(item?.assigneeIds),
    responsibleIds: ids(item?.responsibleIds),
    partnerIds: ids(item?.partnerIds),
    informedIds: ids(item?.informedIds),
    participantIds: ids(item?.participantIds),
    kind,
  };
}

function assembleAuthorizedContext(sources, permissions) {
  const principal = canRead(permissions, '__principal');
  const teamAccess = principal || canRead(permissions, 'teams_view', 'teams.view', 'tasks_assign', 'tasks.assign');
  const staffAccess = principal || canRead(permissions, 'staff_view', 'staff.view', 'tasks_assign', 'tasks.assign');
  const roleAccess = principal || canRead(permissions, 'roles.view', 'staff_view', 'staff.view');
  const classAccess = principal || canRead(permissions, 'classes_view', 'classes.view');
  const calendarAccess = principal || canRead(permissions, 'calendar_view', 'calendar.view');
  const initiativeAccess = principal || canRead(permissions, 'initiatives.view', 'initiatives.viewAll');
  const taskAccess = principal || canRead(permissions, 'tasks_view', 'tasks.viewOwn', 'tasks.viewAll');
  return {
    staff: staffAccess ? (sources.staff || []).map(item => sanitizeStaff(item, sources.schoolId)).filter(item => item.id && item.name) : [],
    teams: teamAccess ? (sources.teams || []).map(sanitizeTeam).filter(item => item.id && item.name) : [],
    roles: roleAccess ? (sources.roles || []).map(sanitizeRole).filter(item => item.id && item.name) : [],
    classes: classAccess ? (sources.classes || []).map(sanitizeClass).filter(item => item.id && item.name) : [],
    calendar: calendarAccess ? [
      ...(sources.events || []).map(item => sanitizeCalendarItem(item, 'event')),
      ...(sources.holidays || []).map(item => sanitizeCalendarItem(item, 'holiday')),
    ].filter(item => item.id && item.title) : [],
    initiatives: initiativeAccess ? (sources.initiatives || []).map(item => sanitizeWorkItem(item, 'initiative')).filter(item => item.id && item.title) : [],
    tasks: taskAccess ? (sources.tasks || []).map(item => sanitizeWorkItem(item, 'task')).filter(item => item.id && item.title).slice(0, 100) : [],
    approvedRules: principal || canRead(permissions, 'tasks.useAssistant')
      ? (sources.approvedRules || []).map(item => text(item, 240)).filter(Boolean).slice(0, 20)
      : [],
    playbooks: principal || canRead(permissions, 'tasks.useAssistant')
      ? (sources.playbooks || []).filter(item => item && typeof item === 'object').slice(0, 20)
      : [],
  };
}

function cacheKey({ schoolId, contextVersion, userPermissionsVersion }) {
  return `${text(schoolId, 128)}:${text(contextVersion, 500)}:${text(userPermissionsVersion, 1000)}`;
}

export function primeSchoolContext({ schoolId, contextVersion, userPermissionsVersion, permissions, sources, now = Date.now() }) {
  const key = cacheKey({ schoolId, contextVersion, userPermissionsVersion });
  const current = cache.get(key);
  if (current && current.expiresAt > now) return current.value;
  for (const existingKey of cache.keys()) {
    if (existingKey.startsWith(`${schoolId}:`) && existingKey !== key) cache.delete(existingKey);
  }
  const value = assembleAuthorizedContext({ ...sources, schoolId }, permissions);
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

export function invalidateSchoolContext(schoolId) {
  for (const key of cache.keys()) {
    if (!schoolId || key.startsWith(`${schoolId}:`)) cache.delete(key);
  }
}

export function clearSchoolContextCache() {
  cache.clear();
}

const GRADE_PATTERN = /(?:שכבה|שכבת|כיתה|כיתות)\s*(י[״"׳']?[אב]?|ט|ח|ז)|(?:^|\s)(י[״"׳']?[אב]?|ט|ח|ז)(?:\s|$)/u;

export function inferSchoolTaskRequest(request = '') {
  const safe = redactTaskAssistantInput(request);
  if (!safe.safe) return { domain: '', grade: '', teamSuggestion: '' };
  const teamSuggestion = inferTaskTeamSuggestion(safe.text);
  const gradeMatch = safe.text.match(GRADE_PATTERN);
  return {
    domain: teamSuggestion ? teamSuggestion.replace(/^צוות\s+/u, '') : '',
    grade: text(gradeMatch?.[1] || gradeMatch?.[2], 12).replace(/[״"׳']/gu, ''),
    teamSuggestion,
  };
}

function includesSearchable(value, terms) {
  const candidate = text(value, 400).toLocaleLowerCase('he');
  return terms.some(term => candidate.includes(term));
}

export function resolveSchoolTaskContext({
  schoolId,
  contextVersion,
  userPermissionsVersion,
  permissions = {},
  sources = {},
  request = '',
  contextRequest = {},
}) {
  const context = primeSchoolContext({ schoolId, contextVersion, userPermissionsVersion, permissions, sources });
  const inferred = inferSchoolTaskRequest(request);
  const requested = new Set((contextRequest.requestedContext || [
    'teams', 'teamMembers', 'relevantRoles', 'gradeHomeroomTeachers', 'calendar', 'initiatives', 'tasks', 'approvedRules', 'playbooks',
  ]).filter(item => CONTEXT_TYPES.has(item)));
  const domain = text(contextRequest.domain || inferred.domain, 80);
  const grade = text(contextRequest.grade || inferred.grade, 12);
  const domainTerms = unique([domain, inferred.teamSuggestion, ...domain.split(/\s+/u)]).map(item => item.toLocaleLowerCase('he'));
  const requestTerms = unique(text(request, 1800).toLocaleLowerCase('he')
    .split(/[^\p{L}\p{N}]+/gu)
    .filter(item => item.length > 2 && !['משימה', 'צריך', 'צריכה', 'לקדם', 'עבור', 'הכנת'].includes(item)))
    .slice(0, 12);
  const taskTerms = domainTerms.length ? domainTerms : requestTerms;
  const matchingTeams = requested.has('teams') || requested.has('teamMembers')
    ? context.teams.filter(team => includesSearchable([
        team.name,
        team.responsibility,
        ...team.responsibilityAreas,
        ...team.keywords,
        ...team.aliases,
        ...team.typicalTaskTypes,
      ].join(' '), domainTerms))
    : [];
  const teamMemberIds = new Set(matchingTeams.flatMap(team => [...team.memberIds, ...team.leaderIds]));
  const teamMembers = requested.has('teamMembers') ? context.staff.filter(member => teamMemberIds.has(member.id)) : [];
  const supportingRoleTerms = unique(matchingTeams.flatMap(team => team.supportingRoles));
  const builtInSupportTerms = inferred.domain && /טיול|מסע|סיור/u.test(inferred.domain)
    ? ['יועץ', 'יועצת', 'מנהלנית', 'מנהלן', 'מזכירה', 'מזכיר']
    : [];
  const relevantRoles = requested.has('roles') || requested.has('relevantRoles')
    ? context.roles.filter(role => (
        !domainTerms.length
        || includesSearchable(`${role.name} ${role.description} ${role.responsibilityAreas.join(' ')}`, domainTerms)
        || supportingRoleTerms.includes(role.id)
        || includesSearchable(`${role.name} ${role.description}`, [...supportingRoleTerms, ...builtInSupportTerms])
      ))
    : [];
  const roleIds = new Set(relevantRoles.map(role => role.id));
  const normalizedRequest = text(request, 1800).toLocaleLowerCase('he');
  const roleHolders = context.staff.filter(member => (
    member.customRoleIds.some(roleId => roleIds.has(roleId))
    || (member.jobTitle && normalizedRequest.includes(member.jobTitle.toLocaleLowerCase('he')))
  ));
  const supportRoleHolders = context.staff.filter(member => (
    includesSearchable(member.jobTitle, [...supportingRoleTerms, ...builtInSupportTerms])
    || member.customRoleIds.some(roleId => relevantRoles.some(role => role.id === roleId
      && includesSearchable(`${role.name} ${role.description}`, [...supportingRoleTerms, ...builtInSupportTerms])))
  ));
  const gradeClasses = requested.has('classes') || requested.has('gradeHomeroomTeachers')
    ? context.classes.filter(item => !grade || item.grade === grade || item.name.includes(grade))
    : [];
  const homeroomIds = new Set(gradeClasses.flatMap(item => item.homeroomTeacherIds));
  const homeroomTeachers = requested.has('gradeHomeroomTeachers') ? context.staff.filter(member => homeroomIds.has(member.id)) : [];
  const relevantCalendar = requested.has('calendar') ? context.calendar : [];
  const relevantInitiatives = requested.has('initiatives')
    ? context.initiatives.filter(item => !domainTerms.length || includesSearchable(item.title, domainTerms)).slice(0, 10)
    : [];
  const relevantTasks = requested.has('tasks')
    ? context.tasks.filter(item => taskTerms.length > 0 && includesSearchable(item.title, taskTerms)).slice(0, 10)
    : [];
  return {
    inferred,
    teams: matchingTeams,
    authorizedTeams: context.teams,
    teamMembers,
    relevantRoles,
    roleHolders,
    supportRoleHolders,
    authorizedStaff: context.staff,
    gradeClasses,
    homeroomTeachers,
    calendar: relevantCalendar,
    initiatives: relevantInitiatives,
    tasks: relevantTasks,
    approvedRules: requested.has('approvedRules') ? context.approvedRules : [],
    playbooks: requested.has('playbooks') ? context.playbooks : [],
  };
}

export function schoolContextStatusMessage(result) {
  const parts = [];
  if (result?.inferred?.grade) parts.push(`שכבת ${result.inferred.grade}`);
  if (result?.teams?.[0]?.name) parts.push(result.teams[0].name);
  if (!parts.length) return 'ההקשר המוסדי מוכן. משלים את פרטי ההצעה...';
  return `זיהיתי שהמשימה קשורה ל${parts.join(' ול')}.`;
}

export function buildGeminiSchoolContext(result) {
  return {
    domain: result?.inferred?.domain || null,
    grade: result?.inferred?.grade || null,
    matchingTeamLabels: unique((result?.teams || []).map(team => team.name)).slice(0, 5),
    relevantRoleLabels: unique((result?.relevantRoles || []).map(role => role.name)).slice(0, 5),
    classLabels: unique((result?.gradeClasses || []).map(item => item.name)).slice(0, 8),
    blockedDates: (result?.calendar || []).filter(item => item.blocked).map(item => ({
      title: item.title,
      startDate: item.startDate,
      endDate: item.endDate,
    })).slice(0, 20),
    relatedInitiativeLabels: unique((result?.initiatives || []).map(item => item.title)).slice(0, 5),
    similarTaskLabels: unique((result?.tasks || []).map(item => item.title)).slice(0, 5),
    approvedRules: (result?.approvedRules || []).slice(0, 10),
  };
}

export function createLocalTaskProposal(request, result, options = {}) {
  const safe = redactTaskAssistantInput(request);
  if (!safe.safe) {
    const error = new Error(safe.reason);
    error.code = safe.reason;
    throw error;
  }
  const title = safe.text.split(/[.!?\n]/u).find(Boolean)?.slice(0, 180) || 'משימה חדשה';
  const plan = buildTaskResponsibilityPlan({
    request,
    answer: options.answer || '',
    context: result,
    playbooks: result?.playbooks || [],
  });
  const team = plan.assignments.responsible.find(item => item.source === 'team')?.name
    || result?.teams?.[0]?.name
    || result?.inferred?.teamSuggestion
    || '';
  const assignees = unique([
    ...(plan.assignments.responsible || []).filter(item => item.source === 'staff').map(item => item.name),
  ]).slice(0, 12);
  return normalizeTaskAssistantProposal({
    title,
    description: safe.text,
    taskType: team ? 'team' : assignees.length ? 'assigned' : 'personal',
    priority: 'medium',
    assigneeSuggestions: assignees,
    teamSuggestions: team ? [team] : [],
    linkedEntitySuggestions: (result?.gradeClasses || []).map(item => item.name).slice(0, 5),
    dateRange: plan.dateRange,
    dueDate: plan.dateRange?.endDate || null,
    followUpQuestion: plan.followUpQuestion,
    completionCriteria: plan.completionCriteria,
    subtasks: plan.workPlanSteps.map(step => step.title),
    assignmentPlan: plan.assignments,
    workPlanSteps: plan.workPlanSteps,
    confidence: plan.confidence,
    domain: plan.domain,
    playbookId: plan.playbookId,
    commonDocuments: plan.commonDocuments,
    reasoningSummary: plan.summary,
  });
}

export function mergeTaskAssistantProposals(localProposal, agentProposal) {
  const local = normalizeTaskAssistantProposal(localProposal);
  const agent = normalizeTaskAssistantProposal(agentProposal);
  return normalizeTaskAssistantProposal({
    ...local,
    ...agent,
    taskType: local.teamSuggestions.length > 0 && ['personal', 'assigned'].includes(agent.taskType)
      ? 'team'
      : agent.taskType,
    title: agent.title || local.title,
    description: agent.description || local.description,
    assigneeSuggestions: unique([...local.assigneeSuggestions, ...agent.assigneeSuggestions]),
    teamSuggestions: unique([...local.teamSuggestions, ...agent.teamSuggestions]),
    linkedEntitySuggestions: unique([...local.linkedEntitySuggestions, ...agent.linkedEntitySuggestions]),
    assignmentPlan: local.assignmentPlan,
    workPlanSteps: local.workPlanSteps.length ? local.workPlanSteps : agent.workPlanSteps,
    confidence: local.confidence,
    domain: local.domain,
    playbookId: local.playbookId,
    commonDocuments: local.commonDocuments,
    followUpQuestion: local.playbookId ? local.followUpQuestion : agent.followUpQuestion,
    reasoningSummary: agent.reasoningSummary || local.reasoningSummary,
  });
}

export async function resolveTaskAssistantWithFallback({ localProposal, generate }) {
  try {
    const agentProposal = await generate();
    return {
      proposal: mergeTaskAssistantProposals(localProposal, agentProposal),
      usedLocalFallback: false,
    };
  } catch (error) {
    return { proposal: normalizeTaskAssistantProposal(localProposal), usedLocalFallback: true, error };
  }
}
