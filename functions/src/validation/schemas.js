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
  ...taskDetails,
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
  type: z.enum(['calendar', 'staff', 'file', 'message', 'permission', 'system', 'task']),
  link: z.string().trim().max(200).regex(/^\/[A-Za-z0-9/_?=&.-]*$/).optional().default(''),
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
}).strict();
export const deleteSchoolSchema = z.object({
  schoolId: id,
  confirmDelete: z.literal(true),
}).strict();
