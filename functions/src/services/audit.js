import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';

export async function writeAuditLog({
  actorUid,
  actorRole = '',
  action,
  targetUid = null,
  targetType = '',
  targetId = '',
  schoolId = null,
  institutionId = null,
  reason = '',
  requestId = '',
  before = {},
  after = {},
  metadata = {},
  collectionName = 'auditLogs',
}) {
  const safeMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => (
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    )),
  );

  const safeSnapshot = value => Object.fromEntries(Object.entries(value || {}).filter(([, item]) => (
    typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null
  )));

  await adminDb.collection(collectionName).add({
    actorUid,
    actorRole,
    action,
    targetUid,
    targetType,
    targetId,
    schoolId,
    institutionId: institutionId || schoolId,
    reason: typeof reason === 'string' ? reason.slice(0, 500) : '',
    requestId,
    before: safeSnapshot(before),
    after: safeSnapshot(after),
    metadata: safeMetadata,
    createdAt: FieldValue.serverTimestamp(),
  });
}
