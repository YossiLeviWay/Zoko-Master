import { z } from 'zod';
import { ALL_PERMISSION_KEYS } from '../permissionCatalog.js';
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const permissions = z.record(z.string().refine(key => ALL_PERMISSION_KEYS.includes(key)), z.boolean()).refine(value => !Object.keys(value).some(key => key.startsWith('forum.')), 'Forum access uses its separate approval process');
export const accessProfileSchema = z.object({
  version: z.literal(1), presetId: z.enum(['teacher', 'homeroom', 'leadership', 'custom']),
  school: permissions, assigned: permissions, homeroom: permissions,
  classes: z.record(id, permissions).refine(value => Object.keys(value).length <= 100),
}).strict();
