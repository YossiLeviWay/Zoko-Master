import { DIRECT_PERMISSION_DEFINITIONS } from './permissionCatalog.js';

// Display groups never grant capabilities. Every grant is an explicit key.
export const ACCESS_DOMAINS = Object.freeze([
  { id: 'work', label: 'עבודה שוטפת', groups: ['tasks', 'initiatives', 'calendar', 'categories', 'holidays'] },
  { id: 'students', label: 'תלמידים ופדגוגיה', groups: ['academicYears', 'classes', 'students', 'grades', 'gradebooks', 'outcomes', 'personalFile', 'cv', 'cvTemplates', 'attendance', 'data_mapping'] },
  { id: 'staff', label: 'סגל וצוותים', groups: ['staff', 'teams'] },
  { id: 'content', label: 'תוכן ותקשורת', groups: ['files', 'contacts', 'messages', 'communications', 'collectiveBrain', 'support'] },
  { id: 'management', label: 'ניהול', groups: ['institution', 'roles', 'permissions', 'schools', 'settings'] },
]);
const BASIC = ['calendar.view', 'tasks.viewOwn', 'tasks.viewTeam', 'tasks.create', 'tasks.inviteCollaborators', 'tasks.useAssistant'];
export const ACCESS_PRESETS = Object.freeze([
  { id: 'teacher', label: 'מורה מקצועי', description: 'עבודה שוטפת ותכנים ששיתפו איתו', school: BASIC, homeroom: [] },
  { id: 'homeroom', label: 'מחנך', description: 'תלמידים, נוכחות ומיפויים בכיתות החינוך שלו', school: BASIC,
    homeroom: ['classes.view', 'students.view', 'students.update', 'attendance_view', 'attendance_edit', 'grades.view', 'grades.edit'] },
  { id: 'leadership', label: 'חבר הנהלה', description: 'גישה לפי תחומי אחריות שתבחרו', school: BASIC, homeroom: [] },
]);
const BASIC_ACTIONS = Object.freeze({
  'calendar.view': 'view', 'calendar.create': 'create', 'calendar.edit': 'edit',
  'classes.view': 'view', 'classes.create': 'create', 'classes.update': 'edit',
  'students.view': 'view', 'students.create': 'create', 'students.update': 'edit',
  'grades.view': 'view', 'grades.edit': 'edit',
  attendance_view: 'view', attendance_create: 'create', attendance_edit: 'edit',
  'files.view': 'view', 'files.create': 'create', 'files.edit': 'edit',
  'staff.view': 'view', 'staff.edit': 'edit',
  'contacts.view': 'view', 'contacts.create': 'create', 'contacts.edit': 'edit',
  'initiatives.view': 'view', 'initiatives.create': 'create', 'initiatives.edit': 'edit',
  'tasks.viewOwn': 'view', 'tasks.create': 'create',
});
export const ACCESS_DEFINITIONS = Object.freeze(DIRECT_PERMISSION_DEFINITIONS.map(def => {
  const prefix = def.key.startsWith('data_mapping') ? 'data_mapping' : def.key.split(/[._]/)[0];
  return { ...def, domain: ACCESS_DOMAINS.find(domain => domain.groups.includes(prefix))?.id || 'management',
    action: BASIC_ACTIONS[def.key] || 'advanced', separateApproval: prefix === 'forum' };
}));
export function permissionPatch(key, enabled) {
  const definition = ACCESS_DEFINITIONS.find(item => item.key === key);
  return Object.fromEntries((definition?.keys || [key]).map(alias => [alias, enabled]));
}
export function permissionMap(keys) {
  return Object.assign({}, ...keys.map(key => permissionPatch(key, true)));
}
export function emptyAccessProfile() {
  return { version: 1, presetId: 'custom', school: {}, assigned: {}, homeroom: {}, classes: {} };
}
export function presetProfile(id) {
  const preset = ACCESS_PRESETS.find(item => item.id === id);
  if (!preset) return emptyAccessProfile();
  return { ...emptyAccessProfile(), presetId: id, school: permissionMap(preset.school), homeroom: permissionMap(preset.homeroom) };
}
export function profileGrants(profile, classes = [], userId = '') {
  if (!profile) return [];
  const grants = [];
  const add = (permissions, scope) => Object.entries(permissions || {}).forEach(([capability, enabled]) => {
    if (enabled === true) grants.push({ capability, scope, source: 'access-profile', reason: 'explicit-profile-grant' });
  });
  add(profile.school, { type: 'school' });
  const active = classes.filter(item => item.status !== 'archived');
  add(profile.assigned, { type: 'classes', classIds: active.filter(item => item.teacherId === userId || item.staffIds?.includes(userId)).map(item => item.id) });
  add(profile.homeroom, { type: 'classes', classIds: active.filter(item => item.teacherId === userId).map(item => item.id) });
  Object.entries(profile.classes || {}).forEach(([classId, permissions]) => add(permissions, { type: 'classes', classIds: [classId] }));
  return grants.filter(grant => grant.scope.type === 'school' || grant.scope.classIds.length);
}
export function profileChanges(before, after) {
  const flatten = profile => new Set([
    ...['school', 'assigned', 'homeroom'].flatMap(scope => Object.entries(profile?.[scope] || {}).filter(([, value]) => value).map(([key]) => `${scope}:${key}`)),
    ...Object.entries(profile?.classes || {}).flatMap(([id, perms]) => Object.entries(perms).filter(([, value]) => value).map(([key]) => `${id}:${key}`)),
  ]);
  const old = flatten(before), next = flatten(after);
  return { added: [...next].filter(key => !old.has(key)), removed: [...old].filter(key => !next.has(key)) };
}

export function cleanAccessProfile(profile) {
  const positive = map => Object.fromEntries(Object.entries(map || {}).filter(([, enabled]) => enabled === true));
  return { ...profile, school: positive(profile.school), homeroom: positive(profile.homeroom), assigned: positive(profile.assigned), classes: Object.fromEntries(Object.entries(profile.classes || {}).map(([id, map]) => [id, positive(map)])) };
}
