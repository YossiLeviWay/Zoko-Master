import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import { buildPermissionContext, evaluatePermission } from './permissionEngine.js';
import { builtInTaskPattern } from '../config/taskAgentPlaybooks.js';

const clean = (value, max = 180) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const ids = value => [...new Set((Array.isArray(value) ? value : []).filter(item => typeof item === 'string' && item))].slice(0, 100);
const lower = value => clean(Array.isArray(value) ? value.join(' ') : value, 600).toLocaleLowerCase('he');

async function collectionDocuments(paths) {
  const snapshots = await Promise.all(paths.map(path => adminDb.collection(path).get().catch(() => null)));
  const merged = new Map();
  snapshots.filter(Boolean).forEach(snapshot => snapshot.docs.forEach(item => {
    if (!merged.has(item.id)) merged.set(item.id, { id: item.id, ...item.data() });
  }));
  return [...merged.values()];
}

async function schoolUsers(schoolId) {
  const [modern, legacy] = await Promise.all([
    adminDb.collection('users').where('schoolIds', 'array-contains', schoolId).get().catch(() => null),
    adminDb.collection('users').where('schoolId', '==', schoolId).get().catch(() => null),
  ]);
  const merged = new Map();
  [modern, legacy].filter(Boolean).forEach(snapshot => snapshot.docs.forEach(item => merged.set(item.id, { id: item.id, ...item.data() })));
  return [...merged.values()].filter(item => !['disabled', 'deleting', 'pending'].includes(item.accountStatus));
}

function staffRecord(item, schoolId) {
  return {
    id: item.id,
    name: clean(item.fullName || item.displayName || item.name, 120),
    jobTitle: clean(item.jobTitle || item.roleName || item.position, 120),
    teamIds: ids(item.teamIdsBySchool?.[schoolId] || item.teamIds),
    classIds: ids(item.classIdsBySchool?.[schoolId] || item.classIds),
    roleIds: ids(item.customRoleAssignments?.[schoolId] || item.customRoleIds),
  };
}

function teamRecord(item) {
  return {
    id: item.id,
    name: clean(item.name || item.title, 120),
    description: clean(item.description || item.responsibility || item.domain, 300),
    memberIds: ids(item.memberIds),
    leaderIds: ids([...(item.leaderIds || []), ...(item.managerIds || []), item.managerId].filter(Boolean)),
    keywords: ids([...(item.keywords || []), ...(item.aliases || []), ...(item.typicalTaskTypes || [])]),
  };
}

function classRecord(item) {
  return {
    id: item.id,
    name: clean(item.name || item.title, 120),
    grade: clean(item.grade || item.gradeLevel || item.layer, 30),
    homeroomTeacherIds: ids([item.teacherId, item.homeroomTeacherId, ...(item.homeroomTeacherIds || [])].filter(Boolean)),
    staffIds: ids(item.staffIds),
  };
}

function roleRecord(item) {
  return {
    id: item.id,
    name: clean(item.name || item.title, 120),
    description: clean(item.description, 300),
    responsibilityAreas: ids(item.responsibilityAreas),
    commonTaskTypes: ids(item.commonTaskTypes),
  };
}

function calendarRecord(item, kind) {
  return {
    id: item.id,
    title: clean(item.title || item.name, 120),
    startDate: clean(item.startDate || item.date, 10),
    endDate: clean(item.endDate || item.startDate || item.date, 10),
    blocked: kind === 'holiday' || item.blocked === true || item.isSchoolDay === false,
  };
}

function relevant(items, request, fields, limit = 12) {
  const words = lower(request).split(/[^\p{L}\p{N}]+/gu).filter(word => word.length > 2);
  if (!words.length) return items.slice(0, limit);
  return items.map(item => ({
    item,
    score: words.reduce((score, word) => score + (fields.map(field => lower(item[field])).join(' ').includes(word) ? 1 : 0), 0),
  })).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(entry => entry.item);
}

function gradeFrom(request) {
  return clean(request, 1800).match(/(?:שכבה|שכבת|כיתה|כיתות)\s*(י[״"׳']?[אב]?|ט|ח|ז|ו|ה|ד|ג|ב|א)/u)?.[1]?.replace(/[״"׳']/gu, '') || '';
}

function capabilities(permissionContext) {
  const allowed = capability => evaluatePermission(permissionContext, { capability, accessLevel: 'view' }).allowed;
  const canAssign = allowed('tasks_assign') || allowed('tasks.assign') || allowed('tasks_edit');
  return {
    canAssign,
    collaborationMode: canAssign ? 'assign' : 'invite',
    canManagePatterns: ['principal', 'institution_manager'].includes(permissionContext.subject?.systemRole),
  };
}

async function approvedPatterns(schoolId, request, queryVector = null) {
  const collection = adminDb.collection(`schools/${schoolId}/taskPatterns`);
  let snapshot = null;
  if (queryVector?.length && typeof collection.findNearest === 'function') {
    snapshot = await collection.where('status', '==', 'approved').findNearest({
      vectorField: 'embedding',
      queryVector: FieldValue.vector(queryVector),
      limit: 8,
      distanceMeasure: 'COSINE',
    }).get().catch(() => null);
  }
  snapshot ||= await collection.where('status', '==', 'approved').limit(50).get().catch(() => null);
  if (!snapshot) return [];
  const patterns = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  return relevant(patterns, request, ['name', 'domain', 'normalizedIntent', 'keywordsText'], 8).map(item => ({
    id: item.id,
    name: clean(item.name, 120),
    domain: clean(item.domain, 80),
    normalizedIntent: clean(item.normalizedIntent, 300),
    teamIds: ids(item.teamIds),
    roleIds: ids(item.roleIds),
    collaboratorIds: ids(item.collaboratorIds),
    classIds: ids(item.classIds),
    commonDocuments: ids(item.commonDocuments),
    steps: Array.isArray(item.steps) ? item.steps.slice(0, 20) : [],
    confidence: Number(item.confidence) || 0,
  }));
}

export async function loadTaskAgentContext({ actor, schoolId, request, queryVector = null }) {
  const [users, teamsRaw, rolesRaw, classesRaw, eventsRaw, holidaysRaw, patterns, profile, permissionContext] = await Promise.all([
    schoolUsers(schoolId),
    collectionDocuments([`schools/${schoolId}/teams`, `teams_${schoolId}`]),
    collectionDocuments([`schools/${schoolId}/roleDefinitions`, `roles_${schoolId}`]),
    collectionDocuments([`schools/${schoolId}/classes`, `classes_${schoolId}`]),
    collectionDocuments([`schools/${schoolId}/events`, `events_${schoolId}`]),
    collectionDocuments([`schools/${schoolId}/holidays`, `holidays_${schoolId}`]),
    approvedPatterns(schoolId, request, queryVector),
    adminDb.doc(`users/${actor.uid}/taskAgentProfiles/${schoolId}`).get().catch(() => null),
    buildPermissionContext({ userId: actor.uid, schoolId }),
  ]);
  const staff = users.map(item => staffRecord(item, schoolId)).filter(item => item.id && item.name);
  const teams = teamsRaw.map(teamRecord).filter(item => item.id && item.name);
  const roles = rolesRaw.map(roleRecord).filter(item => item.id && item.name);
  const classes = classesRaw.map(classRecord).filter(item => item.id && item.name);
  const grade = gradeFrom(request);
  const gradeClasses = grade ? classes.filter(item => item.grade === grade || item.name.includes(grade)) : [];
  const classStaffIds = new Set(gradeClasses.flatMap(item => [...item.homeroomTeacherIds, ...item.staffIds]));
  const relevantTeams = relevant(teams, request, ['name', 'description', 'keywords'], 10);
  const teamStaffIds = new Set(relevantTeams.flatMap(item => [...item.memberIds, ...item.leaderIds]));
  const relevantRoles = relevant(roles, request, ['name', 'description', 'responsibilityAreas', 'commonTaskTypes'], 10);
  const roleIds = new Set(relevantRoles.map(item => item.id));
  const candidateStaff = staff.filter(item => classStaffIds.has(item.id) || teamStaffIds.has(item.id) || item.roleIds.some(id => roleIds.has(id)) || relevant([item], request, ['name', 'jobTitle'], 1).length);
  return {
    schoolId,
    grade: grade || null,
    staff: (candidateStaff.length ? candidateStaff : staff).slice(0, 60),
    teams: relevantTeams.length ? relevantTeams : teams.slice(0, 30),
    roles: relevantRoles.length ? relevantRoles : roles.slice(0, 30),
    classes: (gradeClasses.length ? gradeClasses : relevant(classes, request, ['name', 'grade'], 12)),
    calendar: [
      ...eventsRaw.map(item => calendarRecord(item, 'event')),
      ...holidaysRaw.map(item => calendarRecord(item, 'holiday')),
    ].filter(item => item.title && item.startDate).slice(0, 50),
    patterns,
    personalProfile: profile?.exists ? profile.data() : {},
    capabilities: capabilities(permissionContext),
    hasRelevantStaff: candidateStaff.length > 0,
    hasRelevantTeam: relevantTeams.length > 0,
  };
}

function party(item, source) {
  return { id: item.id, name: item.name, jobTitle: item.jobTitle || '', source };
}

export function localTaskAgentProposal(request, context) {
  const source = clean(request, 1800);
  const exam = /מבחן|מבחנים|בחינה|בחינות|הערכה/u.test(source);
  const baseline = builtInTaskPattern(source);
  const pedagogical = context.staff.filter(item => /פדגוג|רכז.*מקצוע|רכז.*שכבה/u.test(`${item.jobTitle} ${item.name}`));
  const classIds = new Set(context.classes.flatMap(item => item.homeroomTeacherIds));
  const homeroom = context.staff.filter(item => classIds.has(item.id) || /מחנכ/u.test(item.jobTitle));
  const preferred = Object.entries(context.personalProfile?.collaboratorFrequency || {})
    .sort(([, left], [, right]) => Number(right) - Number(left)).map(([id]) => id);
  const ordered = [...context.staff].sort((a, b) => Number(preferred.includes(b.id)) - Number(preferred.includes(a.id)));
  const responsible = exam ? pedagogical.slice(0, 1) : (context.hasRelevantStaff || preferred.length ? ordered.slice(0, 1) : []);
  const partners = exam ? homeroom.filter(item => !responsible.some(lead => lead.id === item.id)).slice(0, 12) : [];
  const team = context.hasRelevantTeam || context.patterns[0] ? context.teams[0] : null;
  const approved = context.patterns[0];
  const steps = approved?.steps?.length ? approved.steps : baseline?.steps || [];
  return {
    title: source.split(/[.!?\n]/u)[0].slice(0, 180),
    description: source,
    taskType: context.capabilities.canAssign && team ? 'team' : 'personal',
    priority: 'medium',
    dueDate: null,
    dateRange: null,
    assigneeSuggestions: responsible.map(item => item.name),
    teamSuggestions: team ? [team.name] : [],
    linkedEntitySuggestions: context.classes.map(item => item.name).slice(0, 8),
    subtasks: steps.map(item => item.title),
    reminderSuggestion: null,
    completionCriteria: '',
    followUpQuestion: null,
    reasoningSummary: approved ? `ההצעה מבוססת על דפוס מוסדי מאושר: ${approved.name}.` : 'ההצעה מבוססת על הצוות, התפקידים והכיתות במוסד.',
    assignmentPlan: {
      responsible: responsible.map(item => party(item, 'staff')),
      partners: partners.map(item => party(item, 'staff')),
      informed: [],
    },
    workPlanSteps: steps.map((step, index) => ({ id: `step_${index + 1}`, title: step.title, phase: step.phase || 'ביצוע', relativeDays: 0, suggestedParties: [] })),
    confidence: responsible.length || team ? 'medium' : 'low',
    domain: approved?.domain || baseline?.domain || '',
    playbookId: approved?.id || baseline?.id || '',
    commonDocuments: approved?.commonDocuments || baseline?.commonDocuments || [],
  };
}

export function validateTaskAgentProposal(proposal, context) {
  const staff = new Map(context.staff.map(item => [item.id, item]));
  const teams = new Map(context.teams.map(item => [item.id, item]));
  const cleanParties = value => (Array.isArray(value) ? value : []).map(item => {
    const found = item?.source === 'team' ? teams.get(item.id) : staff.get(item?.id);
    return found ? party(found, item.source === 'team' ? 'team' : 'staff') : null;
  }).filter(Boolean).slice(0, 50);
  const assignmentPlan = {
    responsible: cleanParties(proposal.assignmentPlan?.responsible),
    partners: cleanParties(proposal.assignmentPlan?.partners),
    informed: cleanParties(proposal.assignmentPlan?.informed),
  };
  if (!assignmentPlan.responsible.length) {
    const suggestions = (Array.isArray(proposal.assigneeSuggestions) ? proposal.assigneeSuggestions : []).map(item => lower(item));
    assignmentPlan.responsible = context.staff.filter(item => suggestions.some(suggestion => {
      const name = lower(item.name);
      const title = lower(item.jobTitle);
      return suggestion && (name.includes(suggestion) || suggestion.includes(name) || (title && (title.includes(suggestion) || suggestion.includes(title))));
    })).slice(0, 3).map(item => party(item, 'staff'));
  }
  return {
    ...proposal,
    assignmentPlan,
    workPlanSteps: (Array.isArray(proposal.workPlanSteps) ? proposal.workPlanSteps : []).slice(0, 30).map((step, index) => ({
      ...step,
      id: clean(step.id, 60) || `step_${index + 1}`,
      title: clean(step.title, 180),
      suggestedParties: cleanParties(step.suggestedParties),
    })).filter(step => step.title),
  };
}

export async function saveTaskAgentSession({ actor, schoolId, request, proposal, capabilities }) {
  const ref = adminDb.collection(`schools/${schoolId}/taskAgentSessions`).doc();
  await ref.set({
    schoolId,
    actorId: actor.uid,
    normalizedIntent: clean(request, 500),
    proposal,
    capabilities,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return ref.id;
}
