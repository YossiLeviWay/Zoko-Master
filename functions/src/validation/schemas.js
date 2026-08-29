import { z } from 'zod';
import { PERMISSION_KEYS } from '../config.js';

const id = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const email = z.string().trim().toLowerCase().email().max(254);
const shortText = z.string().trim().max(120);
const role = z.enum(['viewer', 'editor', 'principal', 'institution_manager', 'global_admin']);
const permissionsShape = Object.fromEntries(PERMISSION_KEYS.map(key => [key, z.boolean().optional()]));
const permissions = z.object(permissionsShape).strict();
const accessScope = z.discriminatedUnion('type', [
  z.object({ type: z.literal('school'), classIds: z.array(id).max(100).default([]) }).strict(),
  z.object({ type: z.literal('classes'), classIds: z.array(id).min(1).max(100) }).strict(),
  z.object({ type: z.literal('self'), values: z.array(id).max(1).optional().default([]) }).strict(),
  z.object({ type: z.enum(['grades', 'tracks', 'teams', 'resources']), values: z.array(id).min(1).max(100) }).strict(),
]);

export const createStaffSchema = z.object({
  email,
  fullName: shortText.min(1),
  phone: z.string().trim().max(32).optional().default(''),
  jobTitle: shortText.optional().default(''),
  role: role.refine(value => value !== 'global_admin'),
  schoolId: id,
  avatarStyle: z.string().trim().max(32).optional().default('default'),
}).strict();

export const updateStaffSchema = z.object({
  userId: id,
  schoolId: id,
  fullName: shortText.min(1).optional(),
  email: email.optional(),
  phone: z.string().trim().max(32).optional(),
  jobTitle: shortText.optional(),
  customRoleIds: z.array(id).max(50).optional(),
  teamIds: z.array(id).max(50).optional(),
  permissions: permissions.optional(),
}).strict();

export const deleteStaffSchema = z.object({
  userId: id,
  schoolId: id,
  confirmDelete: z.literal(true),
}).strict();

export const setRoleSchema = z.object({
  userId: id,
  schoolId: id,
  role,
  assignAsPrincipal: z.boolean().optional().default(false),
}).strict();

export const membershipSchema = z.object({
  userId: id,
  schoolId: id,
  pendingOnly: z.boolean().optional().default(false),
}).strict();

export const passwordResetSchema = z.object({
  userId: id,
  schoolId: id,
}).strict();

export const staffInvitationSchema = z.object({
  schoolId: id,
  fullName: shortText.min(1),
  email,
  role: z.enum(['viewer', 'editor']),
  customRoleIds: z.array(id).max(50).optional().default([]),
  teamIds: z.array(id).max(50).optional().default([]),
  classIds: z.array(id).max(100).optional().default([]),
  permissions: permissions.optional().default({}),
  message: z.string().trim().max(1000).optional().default(''),
  sourceJoinRequestId: id.optional(),
}).strict();

export const invitationActionSchema = z.object({
  schoolId: id,
  invitationId: id,
  action: z.enum(['resend', 'revoke']),
}).strict();

export const acceptInvitationSchema = z.object({
  invitationId: id,
  token: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/),
  password: z.string().min(12).max(128),
  fullName: shortText.min(1),
}).strict();

export const joinRequestSchema = z.object({
  schoolId: id,
  fullName: shortText.min(1),
  email,
  message: z.string().trim().max(1000).optional().default(''),
}).strict();

export const reviewJoinRequestSchema = z.object({
  schoolId: id,
  requestId: id,
  action: z.enum(['invite', 'reject', 'resolved']),
  role: z.enum(['viewer', 'editor']).optional(),
  customRoleIds: z.array(id).max(50).optional().default([]),
  teamIds: z.array(id).max(50).optional().default([]),
  classIds: z.array(id).max(100).optional().default([]),
  permissions: permissions.optional().default({}),
  rejectionReason: z.string().trim().max(500).optional().default(''),
}).strict();

export const publicPasswordResetSchema = z.object({
  schoolId: id,
  email,
}).strict();

const taskDetails = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional().default(''),
  dueDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
};

const unifiedTaskStepSchema = z.object({
  id: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(180),
  dueDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
  status: z.enum(['todo', 'in_progress', 'done']).optional().default('todo'),
  responsibleIds: z.array(id).max(10).optional().default([]).transform(values => [...new Set(values)]),
  teamId: z.union([id, z.literal('')]).optional().default(''),
  dependencyStepId: z.string().trim().max(60).optional().default(''),
  order: z.number().int().min(0).max(29),
}).strict();

export const taskCollaboratorInvitationSchema = z.object({
  schoolId: id,
  personalTaskId: id,
  recipientIds: z.array(id).min(1).max(20).transform(values => [...new Set(values)]),
  message: z.string().trim().max(1000).optional().default(''),
}).strict();

export const taskInvitationResponseSchema = z.object({
  schoolId: id,
  invitationId: id,
  action: z.enum(['accept', 'decline', 'cancel']),
  response: z.string().trim().max(1000).optional().default(''),
}).strict();

export const mandatoryTaskSchema = z.object({
  schoolId: id,
  recipientIds: z.array(id).min(1).max(50).transform(values => [...new Set(values)]),
  startDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
  endDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
  reminderAt: z.string().trim().max(40).optional().default(''),
  completionCriteria: z.string().trim().max(1000).optional().default(''),
  workPlanSteps: z.array(unifiedTaskStepSchema).max(30).optional().default([]),
  ...taskDetails,
}).strict();

export const zokiTaskActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  task: z.object({
    scope: z.enum(['personal', 'assigned', 'team']),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).optional().default(''),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
    dueDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
    startDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
    endDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
    completionCriteria: z.string().trim().max(1000).optional().default(''),
    workPlanSteps: z.array(unifiedTaskStepSchema).max(30).optional().default([]),
    assigneeIds: z.array(id).max(1).optional().default([]).transform(values => [...new Set(values)]),
    teamId: z.union([id, z.literal('')]).optional().default(''),
    agentSessionId: z.string().trim().max(128).optional().default(''),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.task.scope === 'assigned' && value.task.assigneeIds.length !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['task', 'assigneeIds'], message: 'assigned task requires one recipient' });
  }
  if (value.task.scope === 'team' && !value.task.teamId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['task', 'teamId'], message: 'team task requires a team' });
  }
  if (value.task.scope === 'personal' && (value.task.assigneeIds.length || value.task.teamId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['task'], message: 'personal task cannot include an assignment' });
  }
});

export const zokiTaskStatusActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  taskId: id,
  storageMode: z.enum(['personal', 'nested', 'legacy']),
  status: z.enum(['todo', 'in_progress', 'done']),
  expectedStatus: z.enum(['todo', 'in_progress', 'done', 'completed']),
}).strict();

export const zokiTaskAssignmentActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  taskId: id,
  storageMode: z.enum(['nested', 'legacy']),
  userId: id,
  action: z.enum(['add', 'remove']),
  expectedCurrentlyAssigned: z.boolean(),
  expectedAssigneeIds: z.array(id).max(50).transform(values => [...new Set(values)].sort()),
}).strict();

const zokiTaskDetails = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000),
  priority: z.enum(['low', 'medium', 'high']),
  dueDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]),
}).strict();

export const zokiTaskDetailsActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  taskId: id,
  storageMode: z.enum(['personal', 'nested', 'legacy']),
  expected: zokiTaskDetails,
  task: zokiTaskDetails,
}).strict();

const gradeScore = z.union([
  z.number().min(0).max(100),
  z.string().trim().regex(/^\d{1,3}(?:\.\d{1,2})?$/u).refine(value => Number(value) <= 100),
]);

export const zokiGradeActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  gradebookId: id,
  studentId: id,
  subjectId: id,
  componentId: id,
  score: gradeScore.transform(Number),
  expectedPreviousScore: gradeScore.nullable(),
}).strict();

export const zokiStudentTransferActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  studentId: id,
  targetClassId: id,
  expectedCurrentClassId: z.union([id, z.literal('')]),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  reason: z.string().trim().max(500).optional().default(''),
}).strict();

export const zokiRoleAssignmentActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  userId: id,
  roleId: id,
  action: z.enum(['assign', 'remove']),
  expectedCurrentlyAssigned: z.boolean(),
}).strict();

export const zokiDirectPermissionActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  userId: id,
  permissionKey: z.enum(PERMISSION_KEYS),
  action: z.enum(['grant', 'revoke']),
  expectedCurrentlyEnabled: z.boolean(),
}).strict();

export const zokiResourceAccessActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  userId: id,
  resourceType: z.enum(['file', 'folder']),
  resourceId: id,
  action: z.enum(['grant', 'deny', 'remove']),
  accessLevel: z.enum(['view', 'comment', 'edit', 'manage']),
  expectedDirectState: z.enum(['none', 'grant:view', 'grant:comment', 'grant:edit', 'grant:manage', 'deny']),
}).strict();

export const zokiResourceRenameActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  resourceType: z.enum(['file', 'folder']),
  resourceId: id,
  expectedName: z.string().trim().min(1).max(160),
  newName: z.string().trim().min(1).max(160).refine(value => !/[\\/\u0000-\u001f]/u.test(value) && !['.', '..'].includes(value)),
}).strict().refine(value => value.expectedName !== value.newName, {
  path: ['newName'], message: 'New resource name must be different',
});

export const zokiResourceCreateActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  kind: z.enum(['folder', 'document', 'spreadsheet']),
  name: z.string().trim().min(1).max(160).refine(value => !/[\\/\u0000-\u001f]/u.test(value) && !['.', '..'].includes(value)),
  folderId: z.union([id, z.literal('')]).optional().default(''),
  visibility: z.enum(['all', 'principal_only']).optional().default('all'),
}).strict().superRefine((value, context) => {
  if (value.kind === 'folder' && value.folderId) {
    context.addIssue({ code: 'custom', path: ['folderId'], message: 'Folders are created at root' });
  }
  if (value.kind !== 'folder' && !value.folderId) {
    context.addIssue({ code: 'custom', path: ['folderId'], message: 'Files require a folder' });
  }
  if (value.kind !== 'folder' && value.visibility !== 'all') {
    context.addIssue({ code: 'custom', path: ['visibility'], message: 'File visibility comes from its folder' });
  }
});

export const zokiResourceMoveActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  fileId: id,
  expectedName: z.string().trim().min(1).max(160),
  expectedFolderId: z.union([id, z.literal('')]),
  targetFolderId: id,
}).strict().refine(value => value.expectedFolderId !== value.targetFolderId, {
  path: ['targetFolderId'], message: 'Target folder must be different',
});

export const zokiStudentTrackActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  studentId: id,
  trackId: id,
  action: z.enum(['add', 'remove']),
  expectedCurrentlyAssigned: z.boolean(),
}).strict();

export const zokiAttendanceActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  fileId: id,
  studentId: id,
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  statusId: id,
  expectedPreviousStatusId: z.union([id, z.literal('')]),
}).strict();

export const zokiStudentNoteActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  studentId: id,
  expectedClassId: id,
  content: z.string().trim().min(1).max(2000),
  type: z.enum(['general', 'academic', 'behavior', 'welfare']),
  visibility: z.enum(['class_staff', 'school_admin']),
}).strict();

export const zokiCalendarEventActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional().default(''),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  time: z.union([z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u), z.literal('')]).optional().default(''),
  category: z.string().trim().min(1).max(80),
  color: z.enum(['#fecdd3', '#fed7aa', '#fef08a', '#bbf7d0', '#99f6e4', '#bae6fd', '#c4b5fd', '#e9d5ff', '#eadfe2', '#ffffff']),
  visibleTo: z.union([z.literal('all'), z.array(id).min(1).max(50).transform(values => [...new Set(values)])]),
  editableBy: z.array(id).max(50).optional().default([]).transform(values => [...new Set(values)]),
}).strict();

export const zokiCalendarEventUpdateActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  eventId: id,
  expectedVersion: z.string().regex(/^[a-f0-9]{32}$/u),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional().default(''),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  time: z.union([z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u), z.literal('')]).optional().default(''),
  category: z.string().trim().min(1).max(80),
  color: z.enum(['#fecdd3', '#fed7aa', '#fef08a', '#bbf7d0', '#99f6e4', '#bae6fd', '#c4b5fd', '#e9d5ff', '#eadfe2', '#ffffff']),
  visibleTo: z.union([z.literal('all'), z.array(id).min(1).max(50).transform(values => [...new Set(values)])]),
  editableBy: z.array(id).max(50).optional().default([]).transform(values => [...new Set(values)]),
}).strict();

export const zokiCalendarEventCancelActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  eventId: id,
  expectedVersion: z.string().regex(/^[a-f0-9]{32}$/u),
}).strict();

export const zokiContactActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  scope: z.enum(['private', 'institutional']),
  fullName: z.string().trim().min(1).max(160),
  organization: z.string().trim().max(160).optional().default(''),
  jobTitle: z.string().trim().max(120).optional().default(''),
  primaryEmail: z.string().trim().email().max(320),
  additionalEmails: z.array(z.string().trim().email().max(320)).max(9).optional().default([])
    .transform(values => [...new Set(values.map(value => value.toLowerCase()))]),
  phone: z.string().trim().max(40).optional().default(''),
  category: z.string().trim().max(80).optional().default(''),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional().default([])
    .transform(values => [...new Set(values)]),
  notes: z.string().trim().max(2000).optional().default(''),
  visibility: z.enum(['institution', 'responsible_staff']).optional().default('institution'),
  ownerStaffIds: z.array(id).max(50).optional().default([]).transform(values => [...new Set(values)]),
}).strict().superRefine((value, context) => {
  if (value.scope === 'institutional' && !value.organization && !value.category) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['organization'], message: 'institutional contact requires organization or category' });
  }
  if (value.scope === 'private' && value.ownerStaffIds.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['ownerStaffIds'], message: 'private contact cannot assign responsible staff' });
  }
});

export const zokiTeamMembershipActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  userId: id,
  teamId: id,
  action: z.enum(['add', 'remove']),
  expectedCurrentlyMember: z.boolean(),
}).strict();

export const zokiTeamManagerActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  userId: id,
  teamId: id,
  action: z.enum(['assign', 'remove']),
  expectedCurrentlyManager: z.boolean(),
}).strict();

const zokiTeamList = z.array(z.string().trim().min(1).max(120)).max(20)
  .optional().default([]).transform(values => [...new Set(values)]);

export const zokiTeamCreateActionSchema = z.object({
  schoolId: id,
  requestId: id,
  confirm: z.literal(true),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().default(''),
  responsibilityAreas: zokiTeamList,
  keywords: zokiTeamList,
  aliases: zokiTeamList,
  supportingRoles: zokiTeamList,
  typicalTaskTypes: zokiTeamList,
  memberIds: z.array(id).max(7).optional().default([]).transform(values => [...new Set(values)]),
}).strict();

export const activeSchoolSchema = z.object({ schoolId: id }).strict();

export const teamMembershipSchema = z.object({
  userId: id,
  schoolId: id,
  teamId: id,
  action: z.enum(['add', 'remove']),
}).strict();

const roleDetails = {
  schoolId: id,
  name: shortText.min(1),
  description: z.string().trim().max(500).optional().default(''),
  permissions,
  delegatedPermissionKeys: z.array(z.enum(PERMISSION_KEYS)).max(PERMISSION_KEYS.length)
    .transform(values => [...new Set(values)]).optional().default([]),
  accessScope: accessScope.optional().default({ type: 'school', classIds: [] }),
  icon: z.string().trim().max(40).optional().default('shield'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().default('#2563eb'),
  delegable: z.boolean().optional().default(true),
  assignableBy: z.array(id).max(100).optional().default([]),
  defaultForInvites: z.boolean().optional().default(false),
  responsibilityAreas: z.array(z.string().trim().min(1).max(120)).max(20).optional().default([]),
  relatedTeamIds: z.array(id).max(50).optional().default([]),
  relatedGrades: z.array(z.string().trim().min(1).max(20)).max(20).optional().default([]),
  commonTaskTypes: z.array(z.string().trim().min(1).max(120)).max(20).optional().default([]),
};

export const createCustomRoleSchema = z.object(roleDetails).strict();
export const updateCustomRoleSchema = z.object({ roleId: id, ...roleDetails }).strict();
export const roleIdSchema = z.object({ schoolId: id, roleId: id }).strict();
export const cloneCustomRoleSchema = z.object({
  schoolId: id,
  roleId: id,
  name: shortText.min(1),
}).strict();
export const assignCustomRoleSchema = z.object({
  schoolId: id,
  roleId: id,
  userId: id,
  action: z.enum(['assign', 'remove']),
  confirmSensitiveChange: z.literal(true),
}).strict();

export const resourceAclSchema = z.object({
  schoolId: id,
  aclId: id.optional(),
  resourceType: z.enum(['file', 'folder', 'task', 'team', 'student']),
  resourceId: id,
  principalType: z.enum(['user', 'team', 'role', 'class']),
  principalId: id,
  accessLevel: z.enum(['view', 'comment', 'edit', 'manage']).optional().default('view'),
  explicitDeny: z.boolean().optional().default(false),
  inherit: z.boolean().optional().default(true),
  expiresAt: z.string().datetime().nullable().optional().default(null),
}).strict();

export const removeResourceAclSchema = z.object({ schoolId: id, aclId: id }).strict();

export const permissionDelegationSchema = z.object({
  schoolId: id,
  delegationId: id.optional(),
  delegateUserId: id,
  assignableRoleIds: z.array(id).min(1).max(100),
  maximumPermissions: z.array(z.enum(PERMISSION_KEYS)).max(PERMISSION_KEYS.length),
  expiresAt: z.string().datetime().nullable().optional().default(null),
  active: z.boolean().optional().default(true),
}).strict();

export const permissionPreviewSchema = z.object({
  schoolId: id,
  targetUserId: id,
}).strict();

export const previewAccessSchema = z.object({
  schoolId: id,
  sessionId: id,
  capability: z.enum(PERMISSION_KEYS),
  resourceType: z.enum(['file', 'folder', 'task', 'team', 'student']).optional(),
  resourceId: id.optional(),
  accessLevel: z.enum(['view', 'comment', 'edit', 'manage']).optional().default('view'),
  resource: z.object({
    classId: id.optional(), gradeId: id.optional(), trackId: id.optional(), teamId: id.optional(),
    ownerId: id.optional(), userId: id.optional(), resourceId: id.optional(),
    parentIds: z.array(id).max(10).optional().default([]),
  }).strict().optional().default({ parentIds: [] }),
}).strict().refine(value => Boolean(value.resourceType) === Boolean(value.resourceId), {
  message: 'resourceType and resourceId must be supplied together',
});

const importStudent = z.object({
  rowId: id,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  idNumber: z.string().trim().min(1).max(32),
  classId: id,
  academicYearId: id,
  academicYear: z.string().trim().min(1).max(30),
  status: z.enum(['active', 'inactive', 'graduated', 'withdrawn', 'dropout']).default('active'),
  gradeLevel: z.string().trim().max(30).optional().default(''),
  trackIds: z.array(id).max(20).optional().default([]),
  programTypes: z.array(z.string().trim().min(1).max(80)).max(20).optional().default([]),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional().default(''),
  phone: z.string().trim().max(32).optional().default(''),
  email: z.string().trim().toLowerCase().email().max(254).or(z.literal('')).optional().default(''),
  contactName: z.string().trim().max(120).optional().default(''),
  contactPhone: z.string().trim().max(32).optional().default(''),
  initialNote: z.string().trim().max(1000).optional().default(''),
  teacherId: id.optional(),
  joinedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional().default(''),
  duplicateAction: z.enum(['skip', 'update', 'review']).optional().default('review'),
}).strict();

export const bulkStudentImportSchema = z.object({
  requestId: id,
  students: z.array(importStudent).min(1).max(200),
}).strict();

export const permanentlyDeleteStudentSchema = z.object({
  schoolId: id,
  studentId: id,
  confirmation: z.literal('DELETE'),
}).strict();

const optionalText = max => z.string().trim().max(max).optional().default('');
const attachment = z.object({
  storagePath: z.string().trim().min(1).max(500),
  originalName: z.string().trim().min(1).max(180),
  contentType: z.string().trim().min(1).max(120),
  size: z.number().int().nonnegative().max(25 * 1024 * 1024),
}).strict();
const personalFileItemKind = z.enum([
  'documents', 'credentials', 'experiences', 'skills', 'recommendations',
]);
const personalFilePayload = z.object({
  title: optionalText(160),
  description: optionalText(3000),
  status: z.enum(['draft', 'pending_verification', 'verified', 'expired', 'archived', 'active']).optional().default('draft'),
  issuer: optionalText(160),
  field: optionalText(120),
  issueDate: optionalText(20),
  expiryDate: optionalText(20),
  credentialNumber: optionalText(120),
  workplace: optionalText(160),
  roleTitle: optionalText(160),
  startDate: optionalText(20),
  endDate: optionalText(20),
  isCurrent: z.boolean().optional().default(false),
  workload: optionalText(120),
  responsibilities: z.array(z.string().trim().min(1).max(500)).max(30).optional().default([]),
  achievements: z.array(z.string().trim().min(1).max(500)).max(30).optional().default([]),
  supervisorName: optionalText(160),
  recommendationLink: optionalText(500),
  recommenderName: optionalText(160),
  recommenderRole: optionalText(160),
  organization: optionalText(160),
  relationship: optionalText(160),
  workPeriod: optionalText(120),
  content: optionalText(5000),
  shortQuote: optionalText(600),
  contact: optionalText(254),
  recommendationDate: optionalText(20),
  cvVisibility: z.enum(['full', 'quote', 'name_only', 'hidden']).optional().default('hidden'),
  skillId: optionalText(128),
  category: z.enum(['hard', 'soft']).optional(),
  name: optionalText(160),
  proficiency: z.enum(['familiarity', 'learning', 'practical', 'independent', 'advanced']).optional(),
  assessmentSource: optionalText(160),
  evidence: optionalText(500),
  showInCv: z.boolean().optional().default(false),
  attachments: z.array(attachment).max(10).optional().default([]),
}).strict();

export const upsertPersonalFileItemSchema = z.object({
  schoolId: id,
  studentId: id,
  itemId: id.optional(),
  kind: personalFileItemKind,
  payload: personalFilePayload,
}).strict();

export const archivePersonalFileItemSchema = z.object({
  schoolId: id,
  studentId: id,
  itemId: id,
  kind: personalFileItemKind,
}).strict();

export const personalFileAccessSchema = z.object({
  schoolId: id,
  studentId: id,
  action: z.enum(['view', 'download']),
  kind: personalFileItemKind.optional(),
  itemId: id.optional(),
}).strict();

export const upsertSkillCatalogItemSchema = z.object({
  schoolId: id,
  skillId: id.optional(),
  name: shortText.min(1),
  category: z.enum(['hard', 'soft']),
  description: z.string().trim().max(1000).optional().default(''),
  status: z.enum(['active', 'archived']).optional().default('active'),
}).strict();

const cvSectionId = z.enum([
  'summary', 'education', 'experiences', 'practicalExperience', 'projects',
  'skills', 'credentials', 'recommendations', 'languages',
]);
const cvTextList = z.array(z.string().trim().min(1).max(800)).max(40).optional().default([]);
const cvEntry = z.object({
  sourceId: id.optional(),
  title: optionalText(180),
  subtitle: optionalText(180),
  organization: optionalText(180),
  period: optionalText(100),
  description: optionalText(3000),
  bullets: cvTextList,
  category: optionalText(80),
  level: optionalText(80),
  quote: optionalText(800),
  contact: optionalText(254),
  link: optionalText(500),
}).strict();
const cvSnapshot = z.object({
  personal: z.object({
    fullName: optionalText(180),
    professionalTitle: optionalText(180),
    phone: optionalText(40),
    email: optionalText(254),
    city: optionalText(120),
    birthDate: optionalText(20),
    professionalLink: optionalText(500),
    photoPath: optionalText(500),
  }).strict(),
  summary: optionalText(4000),
  education: z.array(cvEntry).max(20).default([]),
  experiences: z.array(cvEntry).max(40).default([]),
  practicalExperience: z.array(cvEntry).max(40).default([]),
  projects: z.array(cvEntry).max(40).default([]),
  skills: z.array(cvEntry).max(80).default([]),
  credentials: z.array(cvEntry).max(40).default([]),
  recommendations: z.array(cvEntry).max(30).default([]),
  languages: z.array(cvEntry).max(20).default([]),
  sectionOrder: z.array(cvSectionId).min(1).max(9)
    .transform(values => [...new Set(values)]),
  hiddenSections: z.array(cvSectionId).max(9)
    .transform(values => [...new Set(values)]).optional().default([]),
  design: z.object({
    templateId: id.optional().default('classic_professional'),
    templateName: shortText.optional().default('קלאסי מקצועי'),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#607D8B'),
    showPhoto: z.boolean().default(false),
    sidebarSections: z.array(cvSectionId).max(9).optional().default([
      'skills', 'credentials', 'education', 'languages',
    ]),
  }).strict(),
}).strict();

export const createCvDocumentSchema = z.object({
  schoolId: id,
  studentId: id,
  title: shortText.min(1),
  purpose: z.string().trim().max(500).optional().default(''),
  templateId: id.optional().default('classic_professional'),
  snapshot: cvSnapshot,
}).strict();

export const saveCvDraftSchema = z.object({
  schoolId: id,
  studentId: id,
  documentId: id,
  title: shortText.min(1),
  purpose: z.string().trim().max(500).optional().default(''),
  status: z.enum(['draft', 'ready']).default('draft'),
  snapshot: cvSnapshot,
}).strict();

export const cvDocumentActionSchema = z.object({
  schoolId: id,
  studentId: id,
  documentId: id,
  confirm: z.literal(true).optional(),
  title: shortText.min(1).optional(),
}).strict();

export const registerCvPdfSchema = z.object({
  schoolId: id,
  studentId: id,
  documentId: id,
  versionId: id,
  exportId: id,
  attachment,
}).strict();

export const cvAccessSchema = z.object({
  schoolId: id,
  studentId: id,
  documentId: id.optional(),
  action: z.enum(['view', 'download', 'preview']),
}).strict();

const templateBase = {
  schoolId: id,
  templateId: id.optional(),
  name: shortText.min(1),
  description: z.string().trim().max(1000).optional().default(''),
  scope: z.enum(['personal', 'school']).default('personal'),
  isDefault: z.boolean().optional().default(false),
};
const designTemplate = z.object({
  ...templateBase,
  type: z.literal('design'),
  design: z.object({
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    sectionOrder: z.array(cvSectionId).min(1).max(9).transform(values => [...new Set(values)]),
    sidebarSections: z.array(cvSectionId).max(9).transform(values => [...new Set(values)]),
    showPhotoDefault: z.boolean().default(false),
  }).strict(),
}).strict();
const contentTemplate = z.object({
  ...templateBase,
  type: z.literal('content'),
  content: z.object({
    summaryTemplate: optionalText(4000),
    educationText: optionalText(4000),
    experienceText: optionalText(4000),
    suggestedSkills: z.array(shortText.min(1)).max(50).transform(values => [...new Set(values)]),
  }).strict(),
}).strict();
export const upsertCvTemplateSchema = z.discriminatedUnion('type', [designTemplate, contentTemplate]);
export const cvTemplateActionSchema = z.object({
  schoolId: id,
  templateId: id,
  action: z.enum(['clone', 'archive']),
  name: shortText.min(1).optional(),
  confirm: z.literal(true),
}).strict();

export const bulkCvPreviewSchema = z.object({
  schoolId: id,
  classId: id,
  academicYearId: id,
  studentIds: z.array(id).min(1).max(50).transform(values => [...new Set(values)]),
}).strict();
export const bulkCvCreateSchema = bulkCvPreviewSchema.extend({
  templateId: id.default('classic_professional'),
  titlePrefix: shortText.min(1).default('קורות חיים'),
  requestId: id,
}).strict();

export const notificationSchema = z.object({
  schoolId: id,
  userIds: z.array(id).min(1).max(50).transform(values => [...new Set(values)]),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(500).optional().default(''),
  type: z.enum(['calendar', 'staff', 'file', 'message', 'permission', 'system', 'task', 'communication']),
  link: z.string().trim().max(200).regex(/^\/[A-Za-z0-9/_?=&.-]*$/).optional().default(''),
}).strict();

const communicationAgentContext = z.object({
  type: z.enum(['general', 'task', 'student', 'team', 'initiative', 'milestone', 'event', 'contact']),
  id,
  label: z.string().trim().min(1).max(300),
}).strict();

const communicationAgentContactRef = z.object({
  id,
  scope: z.enum(['private', 'institutional']),
}).strict();

const communicationAgentDraft = z.object({
  recipients: z.array(email).max(20).optional().default([]),
  cc: z.array(email).max(20).optional().default([]),
  bcc: z.array(email).max(20).optional().default([]),
  subject: z.string().trim().max(300).optional().default(''),
  body: z.string().trim().max(10000).optional().default(''),
  summary: z.string().trim().max(1000).optional().default(''),
  priority: z.enum(['low', 'normal', 'high']).optional().default('normal'),
  followUpAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().default(null),
  completionCriteria: z.string().trim().max(1000).optional().default(''),
}).strict();

export const communicationAgentRequestSchema = z.object({
  schoolId: id,
  request: z.string().trim().min(3).max(4000),
  operation: z.enum(['compose', 'shorten', 'expand', 'change_tone', 'suggest_next_action', 'summarize_history']).optional().default('compose'),
  language: z.enum(['he', 'ar', 'en']).optional().default('he'),
  style: z.enum(['respectful', 'direct', 'friendly', 'formal']).optional().default('respectful'),
  context: communicationAgentContext,
  contactRefs: z.array(communicationAgentContactRef).max(12).optional().default([]),
  assigneeIds: z.array(id).max(40).optional().default([]).transform(values => [...new Set(values)]),
  currentDraft: communicationAgentDraft.optional().default({
    recipients: [],
    cc: [],
    bcc: [],
    subject: '',
    body: '',
    summary: '',
    priority: 'normal',
    followUpAt: null,
    completionCriteria: '',
  }),
}).strict();

export const communicationAgentResultSchema = z.object({
  recipients: z.array(email).max(20),
  cc: z.array(email).max(20),
  bcc: z.array(email).max(20),
  subject: z.string().trim().max(300),
  body: z.string().trim().max(10000),
  summary: z.string().trim().max(1000),
  priority: z.enum(['low', 'normal', 'high']),
  followUpAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  completionCriteria: z.string().trim().max(1000),
  suggestedAssigneeId: id.nullable(),
  linkedEntities: z.array(z.object({
    type: z.enum(['general', 'task', 'student', 'team', 'initiative', 'milestone', 'event', 'contact']),
    id,
    label: z.string().trim().min(1).max(300),
  }).strict()).max(10),
  missingFields: z.array(z.string().trim().min(1).max(120)).max(12),
  suggestedNextAction: z.string().trim().max(500),
}).strict();

const schoolDetails = {
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  address: z.string().trim().max(250).optional().default(''),
  phone: z.string().trim().max(32).optional().default(''),
  institutionalEmail: z.union([email, z.literal('')]).optional().default(''),
  activeAcademicYearId: id,
  status: z.enum(['active', 'disabled']).optional().default('active'),
};

export const createSchoolSchema = z.object({
  ...schoolDetails,
  manager: z.object({ fullName: shortText.min(1), email }).strict(),
}).strict();
export const updateSchoolSchema = z.object({ schoolId: id, ...schoolDetails }).strict();
export const assignInstitutionManagerSchema = z.object({
  schoolId: id,
  fullName: shortText.min(1),
  email,
  reason: z.string().trim().min(5).max(500),
  replaceExisting: z.boolean().default(false),
}).strict();
export const deleteSchoolSchema = z.object({
  schoolId: id,
  confirmDelete: z.literal(true),
}).strict();

export const fileTrashActionSchema = z.object({
  schoolId: id,
  resourceType: z.enum(['file', 'folder']),
  resourceId: id,
  action: z.enum(['trash', 'restore', 'purge']),
  confirmPermanent: z.literal(true).optional(),
  requestId: id.optional(),
  expectedName: z.string().trim().min(1).max(160).optional(),
  source: z.literal('zoki').optional(),
}).strict().superRefine((value, context) => {
  if (value.action === 'purge' && value.confirmPermanent !== true) {
    context.addIssue({ code: 'custom', path: ['confirmPermanent'], message: 'Permanent deletion requires confirmation' });
  }
  if (value.source === 'zoki' && (!value.requestId || !value.expectedName || !['trash', 'restore'].includes(value.action))) {
    context.addIssue({ code: 'custom', path: ['source'], message: 'Zoki recycle action requires request, name and a recoverable action' });
  }
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nonNegativeNumber = z.number().finite().nonnegative();
const outcomeCriterion = z.lazy(() => z.discriminatedUnion('type', [
  z.object({ type: z.literal('subject_min'), subjectId: id, subjectName: shortText.optional().default(''), minimum: z.number().min(0).max(100) }).strict(),
  z.object({ type: z.literal('average_min'), minimum: z.number().min(0).max(100) }).strict(),
  z.object({ type: z.literal('units_min'), minimum: nonNegativeNumber.max(100) }).strict(),
  z.object({ type: z.literal('practical_complete') }).strict(),
  z.object({ type: z.literal('work_hours_min'), minimum: nonNegativeNumber.max(10000) }).strict(),
  z.object({ type: z.literal('attendance_min'), minimum: z.number().min(0).max(100) }).strict(),
  z.object({ type: z.literal('professional_exam_passed') }).strict(),
  z.object({ type: z.literal('evidence_uploaded') }).strict(),
  z.object({ type: z.literal('manual_approval') }).strict(),
  z.object({
    type: z.literal('group'),
    operator: z.enum(['AND', 'OR']),
    criteria: z.array(outcomeCriterion).min(1).max(30),
  }).strict(),
]));

export const classGraduationPreviewSchema = z.object({
  schoolId: id,
  classId: id,
  academicYearId: id,
  graduationDate: isoDate,
}).strict();

export const graduateClassSchema = classGraduationPreviewSchema.extend({
  requestId: id,
  confirmationText: z.string().trim().min(1).max(160),
}).strict();

export const restoreGraduateSchema = z.object({
  schoolId: id,
  studentId: id,
  targetAcademicYearId: id,
  targetClassId: id,
  effectiveDate: isoDate,
  reason: z.string().trim().min(5).max(500),
  requestId: id,
}).strict();

export const outcomeDefinitionSchema = z.object({
  schoolId: id,
  definitionId: id.optional(),
  name: shortText.min(1),
  description: z.string().trim().max(2000).optional().default(''),
  academicYearId: id,
  applicableGrades: z.array(shortText.min(1)).max(20).default([]),
  applicableTracks: z.array(id).max(50).default([]),
  applicablePrograms: z.array(shortText.min(1)).max(50).default([]),
  active: z.boolean().default(true),
  calculationMode: z.enum(['calculated', 'manual', 'combined']),
  criteria: z.array(outcomeCriterion).min(1).max(50),
  dropoutPolicy: z.enum(['exclude', 'include', 'separate']).default('exclude'),
  version: z.number().int().positive().optional(),
}).strict();

export const outcomeDefinitionActionSchema = z.object({
  schoolId: id,
  definitionId: id,
  action: z.enum(['clone', 'disable']),
  name: shortText.min(1).optional(),
}).strict();

export const classOutcomeTargetSchema = z.object({
  schoolId: id,
  classId: id,
  academicYearId: id,
  outcomeDefinitionId: id,
  targetPercentage: z.number().min(0).max(100),
  includedStudentIds: z.array(id).max(300).default([]),
  responsibleUserIds: z.array(id).max(30).default([]),
  targetDate: isoDate.or(z.literal('')).default(''),
  managementNote: z.string().trim().max(1000).default(''),
}).strict();

export const calculateClassOutcomesSchema = z.object({
  schoolId: id,
  classId: id,
  academicYearId: id,
  outcomeDefinitionIds: z.array(id).min(1).max(30),
  requestId: id,
}).strict();

export const manualOutcomeApprovalSchema = z.object({
  schoolId: id,
  resultId: id,
  studentId: id,
  classId: id,
  academicYearId: id,
  outcomeDefinitionId: id,
  approved: z.boolean(),
  reason: z.string().trim().min(5).max(500),
  requestId: id,
}).strict();

export const initializeOutcomeTemplatesSchema = z.object({
  schoolId: id,
  academicYearId: id,
}).strict();

export const forumAccessRequestSchema = z.object({
  schoolId: id,
  userId: id,
  requestedPermissions: z.array(z.enum([
    'forum.createThread', 'forum.reply', 'forum.editOwnPost', 'forum.deleteOwnPost',
    'forum.uploadAttachment', 'forum.createFolder', 'forum.editFolder', 'forum.pinThread',
    'forum.lockThread', 'forum.moderate',
  ])).min(1).max(12).transform(values => [...new Set(values)]),
  reason: z.string().trim().min(5).max(1000),
  expiresAt: z.string().datetime().optional(),
}).strict();

export const forumAccessReviewSchema = z.object({
  requestId: id,
  action: z.enum(['approve', 'reject', 'clarification']),
  approvedPermissions: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  reason: z.string().trim().min(3).max(1000),
  expiresAt: z.string().datetime().optional(),
}).strict();

export const forumMembershipRevokeSchema = z.object({
  membershipId: id,
  reason: z.string().trim().min(3).max(500),
}).strict();

export const forumFolderSchema = z.object({
  folderId: id.optional(),
  name: shortText.min(1),
  description: z.string().trim().max(1000).default(''),
}).strict();

export const forumThreadSchema = z.object({
  folderId: id,
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
  attachmentIds: z.array(id).max(10).default([]),
}).strict();

export const forumPostSchema = z.object({
  threadId: id,
  body: z.string().trim().min(1).max(10000),
  attachmentIds: z.array(id).max(10).default([]),
}).strict();

export const forumContentActionSchema = z.object({
  targetType: z.enum(['thread', 'post']),
  threadId: id,
  postId: id.optional(),
  action: z.enum(['edit', 'delete', 'pin', 'lock', 'report', 'follow']),
  body: z.string().trim().max(10000).optional(),
  reason: z.string().trim().max(1000).optional().default(''),
}).strict();

export const supportTicketSchema = z.object({
  schoolId: id,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(10).max(10000),
  issueType: z.enum(['technical', 'permissions', 'billing', 'security', 'other']),
  urgency: z.enum(['low', 'normal', 'high', 'critical']),
  attachmentIds: z.array(id).max(5).default([]),
  technicalContext: z.object({
    appVersion: z.string().trim().max(30).default(''),
    route: z.string().trim().max(200).default(''),
    browser: z.string().trim().max(200).default(''),
  }).strict().default({ appVersion: '', route: '', browser: '' }),
}).strict();

export const supportTicketUpdateSchema = z.object({
  ticketId: id,
  status: z.enum(['open', 'in_progress', 'waiting_for_school', 'resolved', 'closed']),
  response: z.string().trim().max(5000).default(''),
  reason: z.string().trim().min(3).max(500),
}).strict();

export const platformDirectoryQuerySchema = z.object({
  schoolId: id.optional(),
  limit: z.number().int().min(1).max(200).default(100),
}).strict();

export const platformStaffActionSchema = z.object({
  schoolId: id,
  userId: id,
  action: z.enum(['send_password_reset', 'revoke_sessions', 'disable_account', 'enable_account']),
  reason: z.string().trim().min(5).max(500),
  revokeSessions: z.boolean().default(false),
}).strict();

export const platformPermissionRepairSchema = z.object({
  schoolId: id,
  userId: id,
  customRoleIds: z.array(id).max(30),
  reason: z.string().trim().min(5).max(500),
}).strict();
