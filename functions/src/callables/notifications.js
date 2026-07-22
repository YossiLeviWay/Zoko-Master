import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { notificationSchema } from '../validation/schemas.js';

const REQUIRED_PERMISSION = Object.freeze({
  calendar: 'calendar_edit',
  file: 'files_upload',
  permission: 'staff_edit',
  staff: 'teams_edit',
  system: 'staff_edit',
  task: 'tasks_edit',
});

function userBelongsToSchool(data, schoolId) {
  return data?.schoolId === schoolId
    || (Array.isArray(data?.schoolIds) && data.schoolIds.includes(schoolId));
}

function actorMaySend(actor, type) {
  if (actor.globalAdmin || actor.data.role === 'principal') return true;
  if (type === 'message') return actor.schoolIds.size > 0;
  if (type === 'task') {
    return actor.data.permissions?.tasks_edit === true
      || actor.data.permissions?.tasks_assign === true;
  }
  const permission = REQUIRED_PERMISSION[type];
  return permission && actor.data.permissions?.[permission] === true;
}

export async function createNotificationsHandler(request) {
  const actor = await requireActor(request);
  const input = notificationSchema.parse(request.data);
  if (!actor.schoolIds.has(input.schoolId) && !actor.globalAdmin) throw permissionDenied();
  if (!actorMaySend(actor, input.type)) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'createNotifications', limit: 20 });

  const recipientRefs = input.userIds.map(userId => adminDb.collection('users').doc(userId));
  const recipients = await adminDb.getAll(...recipientRefs);
  if (recipients.some(snapshot => (
    !snapshot.exists
    || !userBelongsToSchool(snapshot.data(), input.schoolId)
    || snapshot.data().accountStatus === 'disabled'
  ))) throw permissionDenied();

  const batch = adminDb.batch();
  recipients.forEach(snapshot => {
    batch.create(adminDb.collection('notifications').doc(), {
      userId: snapshot.id,
      schoolId: input.schoolId,
      title: input.title,
      body: input.body,
      type: input.type,
      link: input.link,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  await writeAuditLog({
    actorUid: actor.uid,
    action: 'notification.create',
    schoolId: input.schoolId,
    metadata: { recipientCount: recipients.length, type: input.type },
  });
  return { ok: true, createdCount: recipients.length };
}

export const createNotifications = onCall(CALLABLE_OPTIONS, async request => {
  try {
    return await createNotificationsHandler(request);
  } catch (error) {
    logger.error('Notification operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
});
