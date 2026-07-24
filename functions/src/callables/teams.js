import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { teamMembershipSchema } from '../validation/schemas.js';
import { requireActor, requireTargetInSchool, isPrincipalFor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';

async function getTeamRef(schoolId, teamId) {
  const nested = adminDb.doc(`schools/${schoolId}/teams/${teamId}`);
  if ((await nested.get()).exists) return nested;
  return adminDb.doc(`teams_${schoolId}/${teamId}`);
}

export async function updateTeamMembershipHandler(request) {
  const actor = await requireActor(request);
  const input = teamMembershipSchema.parse(request.data);
  if (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId)) throw permissionDenied();
  const target = await requireTargetInSchool(actor, input.userId, input.schoolId);
  const teamRef = await getTeamRef(input.schoolId, input.teamId);
  const teamSnapshot = await teamRef.get();
  if (!teamSnapshot.exists) throw permissionDenied();
  const team = teamSnapshot.data();
  const canManage = actor.globalAdmin
    || isPrincipalFor(actor, input.schoolId)
    || (team.managerIds || []).includes(actor.uid);
  if (!canManage) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'updateTeamMembership', limit: 40 });

  const add = input.action === 'add';
  const batch = adminDb.batch();
  batch.update(teamRef, {
    memberIds: add ? FieldValue.arrayUnion(input.userId) : FieldValue.arrayRemove(input.userId),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.update(target.ref, {
    teamIds: add ? FieldValue.arrayUnion(input.teamId) : FieldValue.arrayRemove(input.teamId),
    [`teamIdsBySchool.${input.schoolId}`]: add
      ? FieldValue.arrayUnion(input.teamId)
      : FieldValue.arrayRemove(input.teamId),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  await writeAuditLog({
    actorUid: actor.uid,
    action: add ? 'team.member.add' : 'team.member.remove',
    targetUid: input.userId,
    schoolId: input.schoolId,
    metadata: { teamId: input.teamId },
  });
  return { ok: true };
}

export const updateTeamMembership = onCall(CALLABLE_OPTIONS, async request => {
  try {
    return await updateTeamMembershipHandler(request);
  } catch (error) {
    logger.error('Team membership operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
});
