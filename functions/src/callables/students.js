import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { permanentlyDeleteStudentSchema } from '../validation/schemas.js';
import { requireActor, requireSchoolManager } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb, adminStorage } from '../services/firebaseAdmin.js';
import { failedPrecondition, permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';

const DELETABLE_STATUSES = new Set(['withdrawn', 'dropout', 'transferred', 'archived']);

async function deleteMatchingDocuments(reference) {
  const snapshot = await reference.get();
  await Promise.all(snapshot.docs.map(item => adminDb.recursiveDelete(item.ref)));
  return snapshot.size;
}

async function cleanupGradebooks(schoolId, studentId) {
  const [nested, legacy] = await Promise.all([
    adminDb.collection(`schools/${schoolId}/gradebooks`).get(),
    adminDb.collection(`gradebooks_${schoolId}`).get(),
  ]);
  const gradeRefs = [
    ...nested.docs.map(item => item.ref.collection('grades').doc(studentId)),
    ...legacy.docs.map(item => item.ref.collection('grades').doc(studentId)),
  ];
  const snapshots = gradeRefs.length ? await adminDb.getAll(...gradeRefs) : [];
  await Promise.all(snapshots.filter(item => item.exists).map(item => adminDb.recursiveDelete(item.ref)));
  return snapshots.filter(item => item.exists).length;
}

async function cleanupAttendance(schoolId, studentId) {
  const [nested, legacy] = await Promise.all([
    adminDb.collection(`schools/${schoolId}/files`).where('fileType', '==', 'attendance').get(),
    adminDb.collection(`files_${schoolId}`).where('fileType', '==', 'attendance').get(),
  ]);
  let removed = 0;
  await Promise.all([...nested.docs, ...legacy.docs].map(async item => {
    const [records, history, member] = await Promise.all([
      deleteMatchingDocuments(item.ref.collection('attendanceRecords').where('studentId', '==', studentId)),
      deleteMatchingDocuments(item.ref.collection('attendanceHistory').where('studentId', '==', studentId)),
      item.ref.collection('attendanceMembers').doc(studentId).get(),
    ]);
    if (member.exists) await adminDb.recursiveDelete(member.ref);
    removed += records + history + (member.exists ? 1 : 0);
  }));
  return removed;
}

export async function permanentlyDeleteStudentHandler(request) {
  const actor = await requireActor(request);
  const input = permanentlyDeleteStudentSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'students.permanentDelete', limit: 10, windowSeconds: 3600 });

  const nestedRef = adminDb.doc(`schools/${input.schoolId}/students/${input.studentId}`);
  const legacyRef = adminDb.doc(`students_${input.schoolId}/${input.studentId}`);
  const [nested, legacy] = await adminDb.getAll(nestedRef, legacyRef);
  const source = nested.exists ? nested : legacy;
  if (!source.exists || (source.data().schoolId && source.data().schoolId !== input.schoolId)) throw permissionDenied();
  if (!DELETABLE_STATUSES.has(source.data().status)) throw failedPrecondition();

  const [nestedEnrollments, legacyEnrollments, outcomes, gradeEntries, attendanceEntries] = await Promise.all([
    deleteMatchingDocuments(adminDb.collection(`schools/${input.schoolId}/studentEnrollments`).where('studentId', '==', input.studentId)),
    deleteMatchingDocuments(adminDb.collection(`studentEnrollments_${input.schoolId}`).where('studentId', '==', input.studentId)),
    deleteMatchingDocuments(adminDb.collection(`schools/${input.schoolId}/studentOutcomeResults`).where('studentId', '==', input.studentId)),
    cleanupGradebooks(input.schoolId, input.studentId),
    cleanupAttendance(input.schoolId, input.studentId),
  ]);
  await Promise.all([
    adminDb.recursiveDelete(nestedRef),
    adminDb.recursiveDelete(legacyRef),
    adminDb.recursiveDelete(adminDb.doc(`schools/${input.schoolId}/personalFiles/${input.studentId}`)),
    adminDb.recursiveDelete(adminDb.doc(`personal_files_${input.schoolId}/${input.studentId}`)),
  ]);
  try {
    await adminStorage.bucket().deleteFiles({ prefix: `schools/${input.schoolId}/students/${input.studentId}/` });
  } catch (error) {
    logger.warn('Student storage cleanup was incomplete.', { code: error?.code || 'unknown' });
  }

  await writeAuditLog({
    actorUid: actor.uid,
    action: 'student.permanentlyDeleted',
    targetUid: input.studentId,
    schoolId: input.schoolId,
    metadata: {
      previousStatus: source.data().status,
      removedEnrollmentCount: nestedEnrollments + legacyEnrollments,
      removedOutcomeCount: outcomes,
      removedGradeCount: gradeEntries,
      removedAttendanceCount: attendanceEntries,
    },
  });
  return { ok: true, studentId: input.studentId };
}

export const permanentlyDeleteStudent = onCall(CALLABLE_OPTIONS, async request => {
  try {
    return await permanentlyDeleteStudentHandler(request);
  } catch (error) {
    logger.error('Permanent student deletion failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
});
