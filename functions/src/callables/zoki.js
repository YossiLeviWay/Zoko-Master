import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { CALLABLE_OPTIONS } from '../config.js';
import { isPrincipalFor, requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { loadZokiContext, loadZokiTaskGuidance } from '../services/zokiContext.js';
import { GEMINI_API_KEY, GEMINI_ZOKI_MODEL, requestGeminiZokiAnswer, requestGeminiZokiFileText } from '../services/geminiZoki.js';

const historyItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(5000),
}).strict();
const inputSchema = z.object({
  schoolId: z.string().trim().min(1).max(128),
  question: z.string().trim().min(2).max(2000),
  history: z.array(historyItemSchema).max(8).optional().default([]),
}).strict();
const schoolInputSchema = z.object({ schoolId: z.string().trim().min(1).max(128) }).strict();
const conversationMessageSchema = z.object({
  id: z.string().trim().min(1).max(128),
  role: z.enum(['user', 'zoki']),
  text: z.string().max(5000).default(''),
  error: z.boolean().optional(),
}).passthrough();
const conversationStateSchema = z.object({
  messages: z.array(conversationMessageSchema).max(60),
  pendingTask: z.unknown().nullable().optional(),
  taskActionResult: z.unknown().nullable().optional(),
  taskAgentTurn: z.unknown().nullable().optional(),
}).strict();
const conversationInputSchema = z.discriminatedUnion('operation', [
  z.object({ schoolId: z.string().trim().min(1).max(128), operation: z.literal('load') }).strict(),
  z.object({ schoolId: z.string().trim().min(1).max(128), operation: z.literal('save'), state: conversationStateSchema }).strict(),
  z.object({ schoolId: z.string().trim().min(1).max(128), operation: z.literal('end') }).strict(),
]);
const brainAudienceSchema = z.object({
  type: z.enum(['school', 'roles', 'users']),
  roleIds: z.array(z.string().trim().min(1).max(128)).max(50).default([]),
  userIds: z.array(z.string().trim().min(1).max(128)).max(50).default([]),
}).strict();
const brainEntrySchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(6000),
  category: z.string().trim().max(80).default(''),
  validUntil: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)]).default(''),
  status: z.enum(['draft', 'published']),
  audience: brainAudienceSchema,
}).strict();
const saveBrainSchema = z.object({
  schoolId: z.string().trim().min(1).max(128),
  instructions: z.string().trim().max(8000).default(''),
  entries: z.array(brainEntrySchema).max(100),
}).strict();

function authorizeSchool(actor, schoolId) {
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(schoolId))) throw permissionDenied();
}

function safeGradeAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'grade_update' || !context.capabilities?.canEditGrades) return null;
  if (!/(?:הזן|הכנס|עדכן|שנה|קבע|תן|רשום|להזין|להכניס|לעדכן|לשנות|לקבוע|לרשום)/u.test(question)) return null;
  if (!sourceIds.includes(action.sourceId)) return null;
  const source = context.sources.find(item => item.id === action.sourceId && item.type === 'grade');
  if (!source) return null;
  const subject = (Array.isArray(source.fields?.subjects) ? source.fields.subjects : []).find(item => item?.id === action.subjectId);
  const component = (Array.isArray(subject?.components) ? subject.components : []).find(item => item?.id === action.componentId);
  const score = Number(action.score);
  if (!subject || !component || !Number.isFinite(score) || score < 0 || score > 100) return null;
  const previousValue = source.fields?.scores?.[subject.id]?.[component.id];
  const previousScore = previousValue === '' || previousValue === null || previousValue === undefined ? null : Number(previousValue);
  if (previousScore !== null && !Number.isFinite(previousScore)) return null;
  return {
    type: 'grade_update',
    gradebookId: source.fields.gradebookId,
    studentId: source.fields.studentId,
    studentName: source.fields.studentName,
    className: source.fields.className,
    subjectId: subject.id,
    subjectName: subject.name || '',
    componentId: component.id,
    componentName: component.name || '',
    previousScore,
    score,
  };
}

function safeTaskStatusAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'task_status_change' || !context.capabilities?.canChangeTaskStatus) return null;
  if (!/(?:סמן|סמני|עדכן|עדכני|העבר|העבירי|התחל|התחילי|השלם|השלימי|סיים|סיימי|פתח|פתחי|להתחיל|להשלים|לסיים|לפתוח)/u.test(question)) return null;
  if (!sourceIds.includes(action.taskSourceId) || !['todo', 'in_progress', 'done'].includes(action.status)) return null;
  const task = context.sources.find(item => item.id === action.taskSourceId
    && ['task', 'personal_task'].includes(item.type) && item.fields?.canUpdateStatus === true);
  if (!task?.fields?.id || !['personal', 'nested', 'legacy'].includes(task.fields.storageMode)) return null;
  const currentStatus = task.fields.status === 'completed' ? 'completed' : ['todo', 'in_progress', 'done'].includes(task.fields.status) ? task.fields.status : 'todo';
  if ((currentStatus === 'completed' ? 'done' : currentStatus) === action.status) return null;
  return {
    type: 'task_status_change', taskId: task.fields.id, taskTitle: task.fields.title || task.label || '',
    storageMode: task.fields.storageMode, expectedStatus: currentStatus, status: action.status,
  };
}

function safeTaskAssignmentAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'task_assignment_change' || !context.capabilities?.canChangeTaskAssignment) return null;
  if (!/(?:הקצה|הקצי|שייך|שייכי|הוסף|הוסיפי|צרף|צרפי|הסר|הסירי|בטל|בטלי|להקצות|לשייך|להוסיף|לצרף|להסיר|לבטל)/u.test(question)) return null;
  if (!sourceIds.includes(action.taskSourceId) || !sourceIds.includes(action.staffSourceId)
    || !['add', 'remove'].includes(action.operation)) return null;
  const task = context.sources.find(item => item.id === action.taskSourceId && item.type === 'task');
  const staff = context.sources.find(item => item.id === action.staffSourceId && item.type === 'staff');
  if (!task?.fields?.id || !staff?.fields?.id || !['nested', 'legacy'].includes(task.fields.storageMode)) return null;
  if ((action.operation === 'add' && task.fields.canAssignStaff !== true)
    || (action.operation === 'remove' && task.fields.canRemoveAssignee !== true)) return null;
  const assigneeIds = Array.isArray(task.fields.assigneeIds) ? [...new Set(task.fields.assigneeIds)].sort() : [];
  const currentlyAssigned = assigneeIds.includes(staff.fields.id);
  if ((action.operation === 'add' && currentlyAssigned) || (action.operation === 'remove' && !currentlyAssigned)) return null;
  return {
    type: 'task_assignment_change', taskId: task.fields.id, taskTitle: task.fields.title || task.label || '',
    storageMode: task.fields.storageMode, userId: staff.fields.id, staffName: staff.fields.name || '',
    operation: action.operation, expectedCurrentlyAssigned: currentlyAssigned, expectedAssigneeIds: assigneeIds,
  };
}

function safeTaskDetailsAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'task_details_update' || !context.capabilities?.canEditTaskDetails) return null;
  if (!/(?:עדכן|עדכני|שנה|שני|ערוך|ערכי|דחה|דחי|הקדם|הקדימי|לעדכן|לשנות|לערוך|לדחות|להקדים)/u.test(question)) return null;
  if (!sourceIds.includes(action.taskSourceId)) return null;
  const source = context.sources.find(item => item.id === action.taskSourceId
    && ['task', 'personal_task'].includes(item.type) && item.fields?.canEditDetails === true);
  if (!source?.fields?.id || !['personal', 'nested', 'legacy'].includes(source.fields.storageMode)) return null;
  const expected = {
    title: String(source.fields.title || '').trim().slice(0, 200),
    description: String(source.fields.description || '').trim().slice(0, 5000),
    priority: ['low', 'medium', 'high'].includes(source.fields.priority) ? source.fields.priority : 'medium',
    dueDate: /^\d{4}-\d{2}-\d{2}$/u.test(source.fields.dueDate || '') ? source.fields.dueDate : '',
  };
  const next = {
    title: String(action.title || '').trim().slice(0, 200),
    description: String(action.description || '').trim().slice(0, 5000),
    priority: ['low', 'medium', 'high'].includes(action.priority) ? action.priority : expected.priority,
    dueDate: String(action.dueDate || '').trim(),
  };
  if (!next.title || (next.dueDate && !/^\d{4}-\d{2}-\d{2}$/u.test(next.dueDate))) return null;
  const changedFields = Object.keys(expected).filter(key => expected[key] !== next[key]);
  if (!changedFields.length) return null;
  const explicitlyNamed = {
    title: /(?:כותרת|שם המשימה|שם המטלה)/u.test(question),
    description: /תיאור/u.test(question),
    priority: /(?:עדיפות|דחוף|דחיפות)/u.test(question),
    dueDate: /(?:תאריך|מועד|יעד|דחה|דחי|הקדם|הקדימי)/u.test(question),
  };
  if (changedFields.some(field => !explicitlyNamed[field])) return null;
  return {
    type: 'task_details_update', taskId: source.fields.id, taskTitle: expected.title,
    storageMode: source.fields.storageMode, expected, task: next, changedFields,
  };
}

function safeStudentTransferAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'student_transfer' || !context.capabilities?.canTransferStudents) return null;
  if (!/(?:העבר|העביר|שבץ|שבצי|שינוי שיבוץ|מעבר|העברה)/u.test(question)) return null;
  if (!sourceIds.includes(action.studentSourceId) || !sourceIds.includes(action.targetClassSourceId)) return null;
  const studentSource = context.sources.find(item => item.id === action.studentSourceId && item.type === 'student');
  const classSource = context.sources.find(item => item.id === action.targetClassSourceId && item.type === 'class');
  const effectiveDate = String(action.effectiveDate || '').trim();
  if (!studentSource || !classSource || !/^\d{4}-\d{2}-\d{2}$/u.test(effectiveDate)) return null;
  if (!studentSource.fields?.id || !classSource.fields?.id || studentSource.fields.classId === classSource.fields.id) return null;
  return {
    type: 'student_transfer',
    studentId: studentSource.fields.id,
    studentName: studentSource.fields.fullName,
    expectedCurrentClassId: studentSource.fields.classId || '',
    currentClassName: studentSource.fields.className || '',
    targetClassId: classSource.fields.id,
    targetClassName: classSource.fields.name || '',
    targetGradeLevel: classSource.fields.gradeLevel || '',
    effectiveDate,
    reason: String(action.reason || '').trim().slice(0, 500),
  };
}

function safeRoleAssignmentAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'role_assignment' || !context.capabilities?.canAssignRoles) return null;
  if (!/(?:תן|תני|הקצה|הקצי|שייך|שייכי|הוסף|הוסיפי|הסר|הסירי|בטל|בטלי|לתת|להקצות|לשייך|להוסיף|להסיר|לבטל)/u.test(question)) return null;
  if (!sourceIds.includes(action.staffSourceId) || !sourceIds.includes(action.roleSourceId)) return null;
  const staffSource = context.sources.find(item => item.id === action.staffSourceId && item.type === 'staff');
  const roleSource = context.sources.find(item => item.id === action.roleSourceId && item.type === 'role');
  if (!staffSource?.fields?.id || !roleSource?.fields?.id || !['assign', 'remove'].includes(action.operation)) return null;
  const currentlyAssigned = Array.isArray(staffSource.fields.roleIds)
    && staffSource.fields.roleIds.includes(roleSource.fields.id);
  if ((action.operation === 'assign' && currentlyAssigned)
    || (action.operation === 'remove' && !currentlyAssigned)) return null;
  return {
    type: 'role_assignment',
    userId: staffSource.fields.id,
    staffName: staffSource.fields.name || '',
    roleId: roleSource.fields.id,
    roleName: roleSource.fields.name || '',
    operation: action.operation,
    expectedCurrentlyAssigned: currentlyAssigned,
  };
}

function safeDirectPermissionAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'direct_permission_change'
    || !context.capabilities?.canManageDirectPermissions) return null;
  if (/(?:קובץ|מסמך|תיקי(?:יה|יה))/u.test(question)) return null;
  if (!/(?:תן|תני|אפשר|אפשרי|הענק|העניקי|הוסף|הוסיפי|הסר|הסירי|בטל|בטלי|חסום|חסמי|לתת|לאפשר|להעניק|להוסיף|להסיר|לבטל|לחסום)/u.test(question)) return null;
  if (!sourceIds.includes(action.staffSourceId) || !sourceIds.includes(action.permissionSourceId)) return null;
  const staffSource = context.sources.find(item => item.id === action.staffSourceId && item.type === 'staff');
  const permissionSource = context.sources.find(item => item.id === action.permissionSourceId && item.type === 'permission');
  if (!staffSource?.fields?.id || !permissionSource?.fields?.key
    || !['grant', 'revoke'].includes(action.operation)
    || ['principal', 'institution_manager', 'global_admin', 'platform_admin'].includes(staffSource.fields.systemRole)) return null;
  const enabledPermissions = Array.isArray(staffSource.fields.enabledPermissions)
    ? staffSource.fields.enabledPermissions : [];
  const permissionKeys = Array.isArray(permissionSource.fields.keys)
    ? permissionSource.fields.keys : [permissionSource.fields.key];
  const currentlyEnabled = permissionKeys.some(key => enabledPermissions.includes(key));
  if ((action.operation === 'grant' && currentlyEnabled)
    || (action.operation === 'revoke' && !currentlyEnabled)) return null;
  return {
    type: 'direct_permission_change',
    userId: staffSource.fields.id,
    staffName: staffSource.fields.name || '',
    permissionKey: permissionSource.fields.key,
    permissionName: permissionSource.fields.name || permissionSource.label || '',
    permissionGroup: permissionSource.fields.group || '',
    operation: action.operation,
    expectedCurrentlyEnabled: currentlyEnabled,
  };
}

function directResourceState(resourceSource, userId) {
  const entries = (Array.isArray(resourceSource?.fields?.directUserAccess)
    ? resourceSource.fields.directUserAccess : []).filter(item => item.userId === userId);
  if (!entries.length) return 'none';
  if (entries.some(item => item.explicitDeny === true)) return 'deny';
  const levels = ['view', 'comment', 'edit', 'manage'];
  const highest = entries.reduce((current, item) => (
    levels.indexOf(item.accessLevel) > levels.indexOf(current) ? item.accessLevel : current
  ), 'view');
  return `grant:${highest}`;
}

function safeResourceAccessAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'resource_access_change'
    || !context.capabilities?.canManageResourcePermissions) return null;
  if (!/(?:תן|תני|אפשר|אפשרי|הענק|העניקי|הסר|הסירי|בטל|בטלי|חסום|חסמי|מנע|מנעי|לתת|לאפשר|להעניק|להסיר|לבטל|לחסום|למנוע)/u.test(question)) return null;
  if (!sourceIds.includes(action.staffSourceId) || !sourceIds.includes(action.resourceSourceId)) return null;
  const staffSource = context.sources.find(item => item.id === action.staffSourceId && item.type === 'staff');
  const resourceSource = context.sources.find(item => item.id === action.resourceSourceId
    && ['file', 'folder'].includes(item.type));
  const accessLevel = ['view', 'comment', 'edit', 'manage'].includes(action.accessLevel)
    ? action.accessLevel : 'view';
  if (!staffSource?.fields?.id || !resourceSource?.fields?.id
    || !['grant', 'deny', 'remove'].includes(action.operation)
    || ['principal', 'institution_manager', 'global_admin', 'platform_admin'].includes(staffSource.fields.systemRole)) return null;
  const currentState = directResourceState(resourceSource, staffSource.fields.id);
  const requestedState = action.operation === 'grant' ? `grant:${accessLevel}`
    : action.operation === 'deny' ? 'deny' : 'none';
  if (currentState === requestedState || (action.operation === 'remove' && currentState === 'none')) return null;
  return {
    type: 'resource_access_change',
    userId: staffSource.fields.id,
    staffName: staffSource.fields.name || '',
    resourceType: resourceSource.type,
    resourceId: resourceSource.fields.id,
    resourceName: resourceSource.fields.name || resourceSource.label || '',
    operation: action.operation,
    accessLevel,
    expectedDirectState: currentState,
  };
}

function safeResourceMutationAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || !['resource_rename', 'resource_trash', 'resource_restore'].includes(action.type)) return null;
  if (!sourceIds.includes(action.resourceSourceId)) return null;
  const resource = context.sources.find(item => item.id === action.resourceSourceId
    && ['file', 'folder'].includes(item.type));
  if (!resource?.fields?.id) return null;
  if (action.type === 'resource_rename') {
    if (resource.fields.trashed) return null;
    if (!context.capabilities?.canRenameResources || resource.fields.canRename !== true) return null;
    if (!/(?:שנה|שני|עדכן|עדכני|החלף|החליפי|לשנות|להחליף).{0,100}(?:שם)|(?:שם).{0,100}(?:שנה|שני|לשנות|להחליף)/u.test(question)) return null;
    const newName = String(action.newName || '').trim().slice(0, 160);
    if (!newName || newName === resource.fields.name || /[\\/\u0000-\u001f]/u.test(newName) || ['.', '..'].includes(newName)) return null;
    return {
      type: action.type, resourceType: resource.type, resourceId: resource.fields.id,
      currentName: resource.fields.name || resource.label || '', newName,
    };
  }
  if (action.type === 'resource_restore') {
    if (!context.capabilities?.canRestoreResources || resource.fields.canRestore !== true || !resource.fields.trashed) return null;
    if (!/(?:שחזר|שחזרי|החזר|החזירי|לשחזר|להחזיר)/u.test(question)) return null;
    return {
      type: action.type, resourceType: resource.type, resourceId: resource.fields.id,
      resourceName: resource.fields.name || resource.label || '',
    };
  }
  if (resource.fields.trashed) return null;
  if (!context.capabilities?.canTrashResources || resource.fields.canTrash !== true) return null;
  if (/(?:גישה|הרשאה|הרשאות)/u.test(question)) return null;
  if (!/(?:מחק|מחקי|למחוק|לסל המחזור|העבר|העבירי)/u.test(question)) return null;
  return {
    type: action.type, resourceType: resource.type, resourceId: resource.fields.id,
    resourceName: resource.fields.name || resource.label || '',
  };
}

function safeResourceMoveAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'resource_move' || !context.capabilities?.canMoveResources) return null;
  if (!/(?:העבר|העבירי|הזז|הזיזי|להעביר|להזיז)/u.test(question) || /(?:לסל|למחזור)/u.test(question)) return null;
  if (!sourceIds.includes(action.fileSourceId) || !sourceIds.includes(action.targetFolderSourceId)) return null;
  const file = context.sources.find(item => item.id === action.fileSourceId
    && item.type === 'file' && item.fields?.canMove === true && !item.fields?.trashed);
  const folder = context.sources.find(item => item.id === action.targetFolderSourceId
    && item.type === 'folder' && item.fields?.canMoveInto === true && !item.fields?.trashed);
  if (!file?.fields?.id || !folder?.fields?.id || file.fields.folderId === folder.fields.id) return null;
  return {
    type: action.type, fileId: file.fields.id, fileName: file.fields.name || file.label || '',
    expectedFolderId: file.fields.folderId || '', currentFolderName: file.fields.folderName || '',
    targetFolderId: folder.fields.id, targetFolderName: folder.fields.name || folder.label || '',
  };
}

function safeResourceCreateAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'resource_create' || !context.capabilities?.canCreateResources) return null;
  if (!/(?:צור|צרי|פתח|פתחי|הוסף|הוסיפי|ליצור|לפתוח|להוסיף)/u.test(question)) return null;
  if (!sourceIds.includes(action.configSourceId)) return null;
  const config = context.sources.find(item => item.id === action.configSourceId && item.type === 'file_create_config');
  if (!config || !['folder', 'document', 'spreadsheet'].includes(action.kind)) return null;
  const name = String(action.name || '').trim().slice(0, 160);
  if (!name || /[\\/\u0000-\u001f]/u.test(name) || ['.', '..'].includes(name)) return null;
  if (action.kind === 'folder') {
    const visibility = action.visibility === 'principal_only' ? 'principal_only' : 'all';
    return {
      type: action.type, kind: action.kind, name, folderId: '', folderName: '', visibility,
    };
  }
  if (!sourceIds.includes(action.folderSourceId)) return null;
  const folder = context.sources.find(item => item.id === action.folderSourceId
    && item.type === 'folder' && item.fields?.canCreateWithin === true && !item.fields?.trashed);
  if (!folder?.fields?.id) return null;
  return {
    type: action.type, kind: action.kind, name, folderId: folder.fields.id,
    folderName: folder.fields.name || folder.label || '', visibility: 'all',
  };
}

function safeStudentTrackAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'student_track_change' || !context.capabilities?.canManageStudentTracks) return null;
  if (!/(?:הוסף|הוסיפי|שייך|שייכי|העבר|העביר|הסר|הסירי|להוסיף|לשייך|להעביר|להסיר)/u.test(question)) return null;
  if (!sourceIds.includes(action.studentSourceId) || !sourceIds.includes(action.trackSourceId)) return null;
  const studentSource = context.sources.find(item => item.id === action.studentSourceId && item.type === 'student');
  const trackSource = context.sources.find(item => item.id === action.trackSourceId && item.type === 'track');
  if (!studentSource?.fields?.id || !trackSource?.fields?.id || !['add', 'remove'].includes(action.operation)) return null;
  const currentlyAssigned = Array.isArray(studentSource.fields.trackIds)
    && studentSource.fields.trackIds.includes(trackSource.fields.id);
  if ((action.operation === 'add' && currentlyAssigned)
    || (action.operation === 'remove' && !currentlyAssigned)) return null;
  return {
    type: 'student_track_change',
    studentId: studentSource.fields.id,
    studentName: studentSource.fields.fullName || '',
    trackId: trackSource.fields.id,
    trackName: trackSource.fields.name || '',
    operation: action.operation,
    expectedCurrentlyAssigned: currentlyAssigned,
  };
}

function safeAttendanceAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'attendance_update' || !context.capabilities?.canEditAttendance) return null;
  if (!/(?:סמן|סמני|עדכן|עדכני|רשום|רשמי|קבע|קבעי|לסמן|לעדכן|לרשום|לקבוע)/u.test(question)) return null;
  if (!sourceIds.includes(action.attendanceSourceId)) return null;
  const attendanceSource = context.sources.find(item => item.id === action.attendanceSourceId && item.type === 'attendance');
  const dateKey = String(action.dateKey || '').trim();
  if (!attendanceSource?.fields?.fileId || !attendanceSource.fields.studentId || !/^\d{4}-\d{2}-\d{2}$/u.test(dateKey)) return null;
  const day = attendanceSource.fields.requestedDay;
  if (!day || day.dateKey !== dateKey || day.blocked || day.scheduled === false) return null;
  const legend = Array.isArray(attendanceSource.fields.legend) ? attendanceSource.fields.legend : [];
  const status = legend.find(item => item.id === action.statusId && item.active !== false && item.type === 'status');
  if (!status) return null;
  const record = (Array.isArray(attendanceSource.fields.records) ? attendanceSource.fields.records : [])
    .find(item => item.dateKey === dateKey);
  const previousStatusId = record?.primaryStatusId || '';
  if (previousStatusId === status.id) return null;
  const previousStatus = legend.find(item => item.id === previousStatusId);
  return {
    type: 'attendance_update',
    fileId: attendanceSource.fields.fileId,
    sheetName: attendanceSource.fields.sheetName || '',
    studentId: attendanceSource.fields.studentId,
    studentName: attendanceSource.fields.studentName || '',
    dateKey,
    statusId: status.id,
    statusLabel: status.label || status.shortCode || '',
    expectedPreviousStatusId: previousStatusId,
    previousStatusLabel: previousStatus?.label || previousStatus?.shortCode || '',
  };
}

function safeStudentNoteAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'student_note_create' || !context.capabilities?.canAddStudentNotes) return null;
  if (!/(?:הוסף|הוסיפי|כתוב|כתבי|רשום|רשמי|צור|צרי|שמור|שמרי|להוסיף|לכתוב|לרשום|ליצור|לשמור)/u.test(question)) return null;
  if (!sourceIds.includes(action.studentSourceId)) return null;
  const studentSource = context.sources.find(item => item.id === action.studentSourceId && item.type === 'student');
  const content = String(action.content || '').trim().slice(0, 2000);
  if (!studentSource?.fields?.id || !studentSource.fields.classId || !content) return null;
  const noteType = ['general', 'academic', 'behavior', 'welfare'].includes(action.noteType) ? action.noteType : 'general';
  const visibility = action.visibility === 'school_admin' ? 'school_admin' : 'class_staff';
  return {
    type: 'student_note_create',
    studentId: studentSource.fields.id,
    studentName: studentSource.fields.fullName || '',
    expectedClassId: studentSource.fields.classId,
    className: studentSource.fields.className || '',
    content,
    noteType,
    visibility,
  };
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function safeCalendarEventAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'calendar_event_create' || !context.capabilities?.canCreateCalendarEvent) return null;
  if (!/(?:צור|צרי|הוסף|הוסיפי|קבע|קבעי|פתח|פתחי|שמור|שמרי|ליצור|להוסיף|לקבוע|לפתוח|לשמור)/u.test(question)) return null;
  if (!sourceIds.includes(action.configSourceId)) return null;
  const config = context.sources.find(item => item.id === action.configSourceId && item.type === 'calendar_config');
  if (!config) return null;
  const title = String(action.title || '').trim().slice(0, 160);
  const description = String(action.description || '').trim().slice(0, 2000);
  const date = String(action.date || '').trim();
  const time = String(action.time || '').trim();
  const categories = Array.isArray(config.fields?.categories) ? config.fields.categories : [];
  const colors = Array.isArray(config.fields?.colors) ? config.fields.colors : [];
  const teams = Array.isArray(config.fields?.teams) ? config.fields.teams : [];
  const teamIds = new Set(teams.map(item => item.id));
  const visibleTo = action.visibleTo === 'all'
    ? 'all' : [...new Set(Array.isArray(action.visibleTo) ? action.visibleTo : [])];
  const editableBy = [...new Set(Array.isArray(action.editableBy) ? action.editableBy : [])];
  if (!title || !validDateKey(date) || (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time))) return null;
  if (!categories.includes(action.category) || !colors.includes(action.color)) return null;
  if ((visibleTo !== 'all' && (!visibleTo.length || visibleTo.some(id => !teamIds.has(id))))
    || editableBy.some(id => !teamIds.has(id))) return null;
  const teamNames = new Map(teams.map(item => [item.id, item.name || '']));
  return {
    type: 'calendar_event_create', title, description, date, time,
    category: action.category, color: action.color, visibleTo, editableBy,
    visibleToLabels: visibleTo === 'all' ? ['כולם'] : visibleTo.map(id => teamNames.get(id)).filter(Boolean),
    editableByLabels: editableBy.map(id => teamNames.get(id)).filter(Boolean),
  };
}

function calendarActionValues(action, config) {
  const title = String(action.title || '').trim().slice(0, 160);
  const description = String(action.description || '').trim().slice(0, 2000);
  const date = String(action.date || '').trim();
  const time = String(action.time || '').trim();
  const categories = Array.isArray(config.fields?.categories) ? config.fields.categories : [];
  const colors = Array.isArray(config.fields?.colors) ? config.fields.colors : [];
  const teams = Array.isArray(config.fields?.teams) ? config.fields.teams : [];
  const teamIds = new Set(teams.map(item => item.id));
  const visibleTo = action.visibleTo === 'all'
    ? 'all' : [...new Set(Array.isArray(action.visibleTo) ? action.visibleTo : [])];
  const editableBy = [...new Set(Array.isArray(action.editableBy) ? action.editableBy : [])];
  if (!title || !validDateKey(date) || (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time))) return null;
  if (!categories.includes(action.category) || !colors.includes(action.color)) return null;
  if ((visibleTo !== 'all' && (!visibleTo.length || visibleTo.some(id => !teamIds.has(id))))
    || editableBy.some(id => !teamIds.has(id))) return null;
  const teamNames = new Map(teams.map(item => [item.id, item.name || '']));
  return {
    title, description, date, time, category: action.category, color: action.color, visibleTo, editableBy,
    visibleToLabels: visibleTo === 'all' ? ['כולם'] : visibleTo.map(id => teamNames.get(id)).filter(Boolean),
    editableByLabels: editableBy.map(id => teamNames.get(id)).filter(Boolean),
  };
}

function safeCalendarEventMutationAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || !context.capabilities?.canEditCalendarEvent) return null;
  if (!['calendar_event_update', 'calendar_event_cancel'].includes(action.type)) return null;
  if (!sourceIds.includes(action.eventSourceId)) return null;
  const event = context.sources.find(item => item.id === action.eventSourceId
    && item.type === 'calendar_event' && item.fields?.canEdit === true);
  if (!event?.fields?.id || !event.fields.version) return null;
  if (action.type === 'calendar_event_cancel') {
    if (!/(?:בטל|בטלי|מחק|מחקי|הסר|הסירי|לבטל|למחוק|להסיר)/u.test(question)) return null;
    return {
      type: action.type, eventId: event.fields.id, eventName: event.fields.title || event.label || '',
      date: event.fields.date || '', time: event.fields.time || '', expectedVersion: event.fields.version,
    };
  }
  if (!/(?:עדכן|עדכני|שנה|שני|הזז|הזיזי|דחה|דחי|הקדם|הקדימי|ערוך|ערכי|לעדכן|לשנות|להזיז|לדחות|להקדים|לערוך)/u.test(question)) return null;
  if (!sourceIds.includes(action.configSourceId)) return null;
  const config = context.sources.find(item => item.id === action.configSourceId && item.type === 'calendar_config');
  const values = config && calendarActionValues(action, config);
  if (!values) return null;
  const current = event.fields;
  const unchanged = ['title', 'description', 'date', 'time', 'category', 'color']
    .every(key => current[key] === values[key])
    && JSON.stringify(current.visibleTo) === JSON.stringify(values.visibleTo)
    && JSON.stringify(current.editableBy || []) === JSON.stringify(values.editableBy);
  if (unchanged) return null;
  return {
    type: action.type, eventId: current.id, eventName: current.title || event.label || '',
    expectedVersion: current.version, previousDate: current.date || '', previousTime: current.time || '',
    ...values,
  };
}

const CONTACT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function safeContactAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'contact_create') return null;
  if (!/(?:צור|צרי|הוסף|הוסיפי|שמור|שמרי|ליצור|להוסיף|לשמור)/u.test(question)) return null;
  if (!sourceIds.includes(action.configSourceId)) return null;
  const config = context.sources.find(item => item.id === action.configSourceId && item.type === 'contact_config');
  if (!config) return null;
  const scope = action.scope === 'institutional' ? 'institutional' : 'private';
  if ((scope === 'private' && !context.capabilities?.canCreatePrivateContact)
    || (scope === 'institutional' && !context.capabilities?.canCreateInstitutionalContact)) return null;
  if (!(Array.isArray(config.fields?.scopes) ? config.fields.scopes : []).includes(scope)) return null;
  const fullName = String(action.fullName || '').trim().slice(0, 160);
  const organization = String(action.organization || '').trim().slice(0, 160);
  const jobTitle = String(action.jobTitle || '').trim().slice(0, 120);
  const primaryEmail = String(action.primaryEmail || '').trim().toLowerCase().replace(/\s+/gu, '').slice(0, 320);
  const additionalEmails = [...new Set((Array.isArray(action.additionalEmails) ? action.additionalEmails : [])
    .map(value => String(value || '').trim().toLowerCase().replace(/\s+/gu, '')).filter(Boolean))].slice(0, 9);
  const phone = String(action.phone || '').trim().slice(0, 40);
  const category = String(action.category || '').trim().slice(0, 80);
  const tags = [...new Set((Array.isArray(action.tags) ? action.tags : []).map(value => String(value || '').trim().slice(0, 50)).filter(Boolean))].slice(0, 20);
  const notes = String(action.notes || '').trim().slice(0, 2000);
  const visibility = action.visibility === 'responsible_staff' ? 'responsible_staff' : 'institution';
  const staff = Array.isArray(config.fields?.responsibleStaff) ? config.fields.responsibleStaff : [];
  const staffNames = new Map(staff.map(item => [item.id, item.name || '']));
  const ownerStaffIds = [...new Set(Array.isArray(action.ownerStaffIds) ? action.ownerStaffIds : [])];
  if (!fullName || !CONTACT_EMAIL_PATTERN.test(primaryEmail)
    || additionalEmails.some(email => !CONTACT_EMAIL_PATTERN.test(email))
    || (scope === 'institutional' && !organization && !category)
    || (scope === 'private' && ownerStaffIds.length)
    || ownerStaffIds.some(id => !staffNames.has(id))) return null;
  return {
    type: 'contact_create', scope, fullName, organization, jobTitle, primaryEmail,
    additionalEmails, phone, category, tags, notes, visibility, ownerStaffIds,
    ownerStaffLabels: ownerStaffIds.map(id => staffNames.get(id)).filter(Boolean),
  };
}

function safeTeamMembershipAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'team_membership_change' || !context.capabilities?.canManageTeamMembership) return null;
  if (!/(?:הוסף|הוסיפי|צרף|צרפי|שייך|שייכי|הסר|הסירי|הוצא|הוציאי|להוסיף|לצרף|לשייך|להסיר|להוציא)/u.test(question)) return null;
  if (!sourceIds.includes(action.staffSourceId) || !sourceIds.includes(action.teamSourceId)) return null;
  const staffSource = context.sources.find(item => item.id === action.staffSourceId && item.type === 'staff');
  const teamSource = context.sources.find(item => item.id === action.teamSourceId && item.type === 'team');
  if (!staffSource?.fields?.id || !teamSource?.fields?.id || teamSource.fields.canManage !== true
    || !['add', 'remove'].includes(action.operation)) return null;
  const currentlyMember = (Array.isArray(teamSource.fields.memberIds) ? teamSource.fields.memberIds : [])
    .includes(staffSource.fields.id);
  if ((action.operation === 'add' && currentlyMember) || (action.operation === 'remove' && !currentlyMember)) return null;
  return {
    type: 'team_membership_change', userId: staffSource.fields.id,
    staffName: staffSource.fields.name || '', teamId: teamSource.fields.id,
    teamName: teamSource.fields.name || '', operation: action.operation,
    expectedCurrentlyMember: currentlyMember,
  };
}

function safeTeamCreateAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'team_create' || !context.capabilities?.canCreateTeam) return null;
  if (!/(?:צור|צרי|פתח|פתחי|הקם|הקימי|ליצור|לפתוח|להקים)/u.test(question)) return null;
  if (!sourceIds.includes(action.configSourceId)) return null;
  const config = context.sources.find(item => item.id === action.configSourceId && item.type === 'team_config');
  if (!config) return null;
  const name = String(action.name || '').trim().slice(0, 120);
  const normalizedName = name.toLocaleLowerCase('he-IL');
  const existingNames = Array.isArray(config.fields?.existingNames) ? config.fields.existingNames : [];
  if (name.length < 2 || existingNames.some(value => String(value || '').trim().toLocaleLowerCase('he-IL') === normalizedName)) return null;
  const memberSourceIds = [...new Set(Array.isArray(action.memberSourceIds) ? action.memberSourceIds : [])].slice(0, 7);
  if (memberSourceIds.some(id => !sourceIds.includes(id))) return null;
  const members = memberSourceIds.map(id => context.sources.find(item => item.id === id && item.type === 'staff'));
  if (members.some(item => !item?.fields?.id)) return null;
  const cleanList = value => [...new Set((Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim().slice(0, 120)).filter(Boolean))].slice(0, 20);
  return {
    type: 'team_create', name, description: String(action.description || '').trim().slice(0, 500),
    responsibilityAreas: cleanList(action.responsibilityAreas), keywords: cleanList(action.keywords),
    aliases: cleanList(action.aliases), supportingRoles: cleanList(action.supportingRoles),
    typicalTaskTypes: cleanList(action.typicalTaskTypes),
    memberIds: members.map(item => item.fields.id),
    memberLabels: members.map(item => item.fields.name || '').filter(Boolean),
  };
}

function safeTeamManagerAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'team_manager_change' || !context.capabilities?.canManageTeamManagers) return null;
  if (!/(?:מנה|מני|הפוך|הפכי|קבע|קבעי|הסר|הסירי|למנות|להפוך|לקבוע|להסיר)/u.test(question)) return null;
  if (!sourceIds.includes(action.staffSourceId) || !sourceIds.includes(action.teamSourceId)) return null;
  const staffSource = context.sources.find(item => item.id === action.staffSourceId && item.type === 'staff');
  const teamSource = context.sources.find(item => item.id === action.teamSourceId && item.type === 'team');
  if (!staffSource?.fields?.id || !teamSource?.fields?.id || teamSource.fields.canManage !== true
    || !['assign', 'remove'].includes(action.operation)) return null;
  const memberIds = Array.isArray(teamSource.fields.memberIds) ? teamSource.fields.memberIds : [];
  const managerIds = Array.isArray(teamSource.fields.managerIds) ? teamSource.fields.managerIds : [];
  const userId = staffSource.fields.id;
  const currentlyManager = managerIds.includes(userId);
  if (!memberIds.includes(userId)
    || (action.operation === 'assign' && currentlyManager)
    || (action.operation === 'remove' && (!currentlyManager || managerIds.length <= 1))) return null;
  return {
    type: 'team_manager_change', userId, staffName: staffSource.fields.name || '',
    teamId: teamSource.fields.id, teamName: teamSource.fields.name || '',
    operation: action.operation, expectedCurrentlyManager: currentlyManager,
  };
}

function safeActionProposal(args) {
  return safeTaskDetailsAction(args) || safeTaskAssignmentAction(args) || safeTaskStatusAction(args) || safeGradeAction(args) || safeStudentTransferAction(args) || safeRoleAssignmentAction(args)
    || safeResourceCreateAction(args) || safeResourceMoveAction(args)
    || safeResourceMutationAction(args) || safeResourceAccessAction(args) || safeDirectPermissionAction(args)
    || safeStudentTrackAction(args) || safeAttendanceAction(args) || safeStudentNoteAction(args)
    || safeCalendarEventMutationAction(args) || safeCalendarEventAction(args)
    || safeContactAction(args) || safeTeamMembershipAction(args)
    || safeTeamCreateAction(args) || safeTeamManagerAction(args);
}

export async function askZokiHandler(request, dependencies = {}) {
  const actor = await requireActor(request);
  const input = inputSchema.parse(request.data);
  authorizeSchool(actor, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'zoki.ask', limit: 20, windowSeconds: 300 });
  const apiKey = dependencies.apiKey ?? GEMINI_API_KEY.value();
  const model = dependencies.model || GEMINI_ZOKI_MODEL.value();
  const recentUserQuestions = input.history.filter(item => item.role === 'user').slice(-3).map(item => item.text);
  const retrievalQuestion = [...recentUserQuestions, input.question].join('\n');
  const context = await loadZokiContext({
    actor, schoolId: input.schoolId, question: retrievalQuestion,
    imageTextExtractor: args => requestGeminiZokiFileText({
      ...args, apiKey, model, fetchImpl: dependencies.fileFetchImpl || dependencies.fetchImpl,
    }),
  });
  const generated = await requestGeminiZokiAnswer({
    apiKey, model,
    fetchImpl: dependencies.fetchImpl, question: input.question, history: input.history, context,
  });
  const allowedIds = new Set(context.sources.map(item => item.id));
  const sourceIds = [...new Set((generated.sourceIds || []).filter(id => allowedIds.has(id)))].slice(0, 8);
  const actionProposal = safeActionProposal({ generated, context, question: input.question, sourceIds });
  await writeAuditLog({
    actorUid: actor.uid,
    actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.ask',
    targetType: 'zoki',
    schoolId: input.schoolId,
    metadata: {
      questionLength: input.question.length,
      historyItemCount: input.history.length,
      authorizedSourceCount: context.sources.length,
      citedSourceCount: sourceIds.length,
      deniedAreaCount: context.denied.length,
      sourceTypes: [...new Set(context.sources.map(item => item.type))].slice(0, 20).join(','),
      proposedAction: actionProposal?.type || '',
    },
  });
  return {
    answer: String(generated.answer || '').slice(0, 5000), followUpQuestion: generated.followUpQuestion || null,
    sources: context.sources.filter(item => sourceIds.includes(item.id)).map(item => ({ id: item.id, type: item.type, label: item.label, route: item.route })),
    capabilities: context.capabilities,
    actionProposal,
  };
}

export async function getZokiTaskGuidanceHandler(request) {
  const actor = await requireActor(request);
  const input = schoolInputSchema.parse(request.data);
  authorizeSchool(actor, input.schoolId);
  return loadZokiTaskGuidance({ actor, schoolId: input.schoolId });
}

export async function syncZokiConversationHandler(request) {
  const actor = await requireActor(request);
  const input = conversationInputSchema.parse(request.data);
  authorizeSchool(actor, input.schoolId);
  const ref = adminDb.doc(`schools/${input.schoolId}/zokiConversations/${actor.uid}`);
  if (input.operation === 'load') {
    const snapshot = await ref.get();
    return { state: snapshot.exists ? (snapshot.data().state || null) : null };
  }
  if (input.operation === 'end') {
    await ref.delete();
    return { ended: true };
  }
  const serialized = JSON.stringify(input.state);
  if (Buffer.byteLength(serialized, 'utf8') > 350_000) throw permissionDenied();
  await ref.set({
    schoolId: input.schoolId,
    userId: actor.uid,
    state: JSON.parse(serialized),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { saved: true };
}

async function validateBrainAudience(schoolId, entries) {
  const roleIds = [...new Set(entries.flatMap(entry => entry.audience.type === 'roles' ? entry.audience.roleIds : []))];
  const userIds = [...new Set(entries.flatMap(entry => entry.audience.type === 'users' ? entry.audience.userIds : []))];
  if (entries.some(entry => (entry.audience.type === 'roles' && entry.audience.roleIds.length === 0)
    || (entry.audience.type === 'users' && entry.audience.userIds.length === 0))) throw permissionDenied();
  if (roleIds.length) {
    const [nested, legacy] = await Promise.all([
      adminDb.getAll(...roleIds.map(id => adminDb.doc(`schools/${schoolId}/roleDefinitions/${id}`))),
      adminDb.getAll(...roleIds.map(id => adminDb.doc(`roles_${schoolId}/${id}`))),
    ]);
    if (roleIds.some((id, index) => !(nested[index].exists || (legacy[index].exists && (!legacy[index].data().schoolId || legacy[index].data().schoolId === schoolId))))) throw permissionDenied();
  }
  if (userIds.length) {
    const users = await adminDb.getAll(...userIds.map(id => adminDb.doc(`users/${id}`)));
    if (users.some(snapshot => {
      if (!snapshot.exists) return true;
      const data = snapshot.data();
      return data.schoolId !== schoolId && !(Array.isArray(data.schoolIds) && data.schoolIds.includes(schoolId));
    })) throw permissionDenied();
  }
}

export async function saveZokiBrainHandler(request) {
  const actor = await requireActor(request);
  const input = saveBrainSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !isPrincipalFor(actor, input.schoolId))) throw permissionDenied();
  if (new Set(input.entries.map(entry => entry.id)).size !== input.entries.length) throw permissionDenied();
  await validateBrainAudience(input.schoolId, input.entries);
  const ref = adminDb.doc(`schools/${input.schoolId}/settings/zoki_brain`);
  const previous = await ref.get();
  const publishedCount = input.entries.filter(entry => entry.status === 'published').length;
  await ref.set({
    schoolId: input.schoolId,
    instructions: input.instructions,
    entries: input.entries,
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
    revision: FieldValue.increment(1),
  }, { merge: true });
  await writeAuditLog({
    actorUid: actor.uid,
    actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.brain.update',
    targetType: 'zokiBrain',
    targetId: 'zoki_brain',
    schoolId: input.schoolId,
    before: { entryCount: Array.isArray(previous.data()?.entries) ? previous.data().entries.length : 0 },
    after: { entryCount: input.entries.length, publishedCount },
    metadata: { instructionsChanged: previous.data()?.instructions !== input.instructions },
  });
  return { entries: input.entries, entryCount: input.entries.length, publishedCount };
}

export const askZoki = onCall({ ...CALLABLE_OPTIONS, timeoutSeconds: 60, secrets: [GEMINI_API_KEY] }, async request => {
  try { return await askZokiHandler(request); }
  catch (error) { logger.error('Zoki request failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const getZokiTaskGuidance = onCall(CALLABLE_OPTIONS, async request => {
  try { return await getZokiTaskGuidanceHandler(request); }
  catch (error) { logger.error('Zoki task guidance request failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const saveZokiBrain = onCall(CALLABLE_OPTIONS, async request => {
  try { return await saveZokiBrainHandler(request); }
  catch (error) { logger.error('Zoki brain update failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});
export const syncZokiConversation = onCall(CALLABLE_OPTIONS, async request => {
  try { return await syncZokiConversationHandler(request); }
  catch (error) { logger.error('Zoki conversation sync failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});
