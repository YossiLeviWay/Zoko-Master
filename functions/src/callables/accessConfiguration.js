import { assignedClassesForUser } from '../services/accessClasses.js';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { accessProfileSchema } from '../validation/accessProfile.js';
import { emptyAccessProfile, profileGrants, cleanAccessProfile } from '../accessCatalog.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { requireActor, requireSchoolManager, requireTargetInSchool, assertReferencesBelongToSchool } from '../services/authorization.js';
import { buildPermissionContext } from '../services/permissionEngine.js';
import { sharedFilesForUser } from './sharedFiles.js';
import { enforceRateLimit } from '../services/rateLimit.js';

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const targetSchema = z.object({ schoolId: id, userId: id }).strict();
const saveSchema = targetSchema.extend({ profile: accessProfileSchema, revision: z.number().int().min(0), legacyPermissionsPatch: accessProfileSchema.shape.school.optional(), legacyBaseline: z.record(z.string(), z.boolean()).optional() });

export async function getAccessConfigurationHandler(request) {
  const actor = await requireActor(request);
  const input = targetSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  const target = await requireTargetInSchool(actor, input.userId, input.schoolId, { allowSelf: true, requireAuthUser: false });
  const [context, classSnapshot, rolesSnapshot, legacyClasses, legacyRoles] = await Promise.all([
    buildPermissionContext({ schoolId: input.schoolId, userId: input.userId }),
    adminDb.collection(`schools/${input.schoolId}/classes`).get(),
    adminDb.collection(`schools/${input.schoolId}/roleDefinitions`).get(),
    adminDb.collection(`classes_${input.schoolId}`).get(),
    adminDb.collection(`roles_${input.schoolId}`).get(),
  ]);
  const classes = [...new Map([...legacyClasses.docs, ...classSnapshot.docs].map(doc => [doc.id, doc])).values()].map(doc => ({ id: doc.id, name: doc.data().name || '', teacherId: doc.data().teacherId || '', staffIds: doc.data().staffIds || [], status: doc.data().status || 'active' }));
  const profile = target.data.accessProfilesBySchool?.[input.schoolId] || emptyAccessProfile();
  const role = target.data.rolesBySchool?.[input.schoolId] || target.data.role;
  return {
    profile, revision: target.data.accessProfileRevisions?.[input.schoolId] || 0,
    protected: ['principal', 'institution_manager', 'global_admin', 'platform_admin'].includes(role),
    classes: classes.filter(item => item.status !== 'archived'),
    roles: [...new Map([...legacyRoles.docs, ...rolesSnapshot.docs].map(doc => [doc.id, doc])).values()].filter(doc => doc.data().status !== 'archived').map(doc => ({ id: doc.id, name: doc.data().name, permissions: doc.data().permissions || {}, accessScope: doc.data().accessScope || { type: 'school' } })),
    grants: context.capabilityGrants,
    sharedFiles: await sharedFilesForUser(input.userId, input.schoolId),
    legacyPermissions: target.data.permissions || {},
    schoolCount: new Set([target.data.schoolId, ...(target.data.schoolIds || [])].filter(Boolean)).size,
    profileGrants: profileGrants(profile, classes, input.userId),
  };
}
export async function saveAccessConfigurationHandler(request) {
  const actor = await requireActor(request);
  const input = saveSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  const target = await requireTargetInSchool(actor, input.userId, input.schoolId, { requireAuthUser: false });
  const role = target.data.rolesBySchool?.[input.schoolId] || target.data.role;
  if (['principal', 'institution_manager', 'global_admin', 'platform_admin'].includes(role)) throw new HttpsError('permission-denied', 'Protected manager');
  await assertReferencesBelongToSchool(input.schoolId, 'classes', Object.keys(input.profile.classes));
  await enforceRateLimit({ uid: actor.uid, action: 'accessConfiguration.save', limit: 30 });
  await adminDb.runTransaction(async transaction => {
    const current = (await transaction.get(target.ref)).data();
    const currentRole = current.rolesBySchool?.[input.schoolId] || current.role;
    if (!new Set([current.schoolId, ...(current.schoolIds || [])]).has(input.schoolId) || ['principal', 'institution_manager', 'global_admin', 'platform_admin'].includes(currentRole)) throw new HttpsError('aborted', 'Membership or protected role changed. Reload before saving.');
    if ((current.accessProfileRevisions?.[input.schoolId] || 0) !== input.revision) throw new HttpsError('aborted', 'Access changed. Reload before saving.');
    if (input.legacyPermissionsPatch && Object.keys(input.legacyPermissionsPatch).length) {
      for (const key of Object.keys(input.legacyPermissionsPatch)) {
        if (current.permissions?.[key] !== input.legacyBaseline?.[key]) throw new HttpsError('aborted', 'Legacy permissions changed. Reload before saving.');
      }
    }
    transaction.update(target.ref, {
      ...(input.legacyPermissionsPatch ? { permissions: { ...(current.permissions || {}), ...input.legacyPermissionsPatch } } : {}),
      ...(current.accessProfilesBySchool?.[input.schoolId] || JSON.stringify(cleanAccessProfile(input.profile)) !== JSON.stringify(emptyAccessProfile()) ? { [`accessProfilesBySchool.${input.schoolId}`]: cleanAccessProfile(input.profile) } : {}),
      [`accessProfileRevisions.${input.schoolId}`]: input.revision + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const audit = adminDb.collection('auditLogs').doc();
    transaction.create(audit, { actorUid: actor.uid, targetUid: input.userId, schoolId: input.schoolId, action: 'access.profile.update', metadata: { presetId: input.profile.presetId, revision: input.revision + 1 }, createdAt: FieldValue.serverTimestamp() });
  });
  return { ok: true, revision: input.revision + 1 };
}
export const getAccessConfiguration = onCall(CALLABLE_OPTIONS, getAccessConfigurationHandler);
export const saveAccessConfiguration = onCall(CALLABLE_OPTIONS, saveAccessConfigurationHandler);

export async function getOwnAccessClassesHandler(request) {
  const actor = await requireActor(request);
  const schoolId = id.parse(request.data?.schoolId);
  if (!actor.schoolIds.has(schoolId)) throw new HttpsError('permission-denied', 'School required');
  return { classes: (await assignedClassesForUser(schoolId, actor.uid)).map(item => ({ id: item.id, name: item.name || '', teacherId: item.teacherId || '', staffIds: item.staffIds || [], status: item.status || 'active' })) };
}
export const getOwnAccessClasses = onCall(CALLABLE_OPTIONS, getOwnAccessClassesHandler);
