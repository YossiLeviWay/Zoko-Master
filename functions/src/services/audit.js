import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';

export async function writeAuditLog({ actorUid, action, targetUid = null, schoolId = null, metadata = {} }) {
  const safeMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => (
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    )),
  );

  await adminDb.collection('auditLogs').add({
    actorUid,
    action,
    targetUid,
    schoolId,
    metadata: safeMetadata,
    createdAt: FieldValue.serverTimestamp(),
  });
}
