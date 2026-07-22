import { z } from 'zod';
import { PERMISSION_KEYS } from '../config.js';

const id = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const email = z.string().trim().toLowerCase().email().max(254);
const shortText = z.string().trim().max(120);
const role = z.enum(['viewer', 'editor', 'principal', 'global_admin']);
const permissionsShape = Object.fromEntries(PERMISSION_KEYS.map(key => [key, z.boolean().optional()]));
const permissions = z.object(permissionsShape).strict();

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

export const teamMembershipSchema = z.object({
  userId: id,
  schoolId: id,
  teamId: id,
  action: z.enum(['add', 'remove']),
}).strict();

export const notificationSchema = z.object({
  schoolId: id,
  userIds: z.array(id).min(1).max(50).transform(values => [...new Set(values)]),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(500).optional().default(''),
  type: z.enum(['calendar', 'staff', 'file', 'message', 'permission', 'system', 'task']),
  link: z.string().trim().max(200).regex(/^\/[A-Za-z0-9/_?=&.-]*$/).optional().default(''),
}).strict();
