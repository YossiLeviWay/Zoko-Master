import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { classGraduationPreviewSchema, graduateClassSchema, restoreGraduateSchema } from '../validation/schemas.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { failedPrecondition, permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { requireRoleAction, resolveActorRoleAuthority } from '../services/roleAuthorization.js';

async function compatibleDoc(schoolId, resource, id) {
  const [nested, legacy] = await adminDb.getAll(
    adminDb.doc(`schools/${schoolId}/${resource}/${id}`),
    adminDb.doc(`${resource}_${schoolId}/${id}`),
  );
  const snapshot = nested.exists ? nested : legacy;
  if (!snapshot.exists) throw failedPrecondition();
  return { id: snapshot.id, ref: snapshot.ref, data: snapshot.data(), nested: nested.exists };
}

async function compatibleCollection(schoolId, resource) {
  const [nested, legacy] = await Promise.all([
    adminDb.collection(`schools/${schoolId}/${resource}`).get(),
    adminDb.collection(`${resource}_${schoolId}`).get(),
  ]);
  const result = new Map();
  legacy.docs.forEach(snapshot => result.set(snapshot.id, { id: snapshot.id, ref: snapshot.ref, data: snapshot.data() }));
  nested.docs.forEach(snapshot => result.set(snapshot.id, { id: snapshot.id, ref: snapshot.ref, data: snapshot.data() }));
  return [...result.values()];
}

async function authorize(actor, schoolId, capability) {
  if (!actor.schoolIds.has(schoolId) && !actor.globalAdmin) throw permissionDenied();
  const authority = await resolveActorRoleAuthority(actor, schoolId);
  requireRoleAction(authority, capability);
  return authority;
}

async function graduationContext(input) {
  const [classItem, academicYear, students, targets] = await Promise.all([
    compatibleDoc(input.schoolId, 'classes', input.classId),
    compatibleDoc(input.schoolId, 'academicYears', input.academicYearId)
      .catch(() => compatibleDoc(input.schoolId, 'academic_years', input.academicYearId)),
    compatibleCollection(input.schoolId, 'students'),
    adminDb.collection(`schools/${input.schoolId}/classOutcomeTargets`)
      .where('classId', '==', input.classId).where('academicYearId', '==', input.academicYearId).get(),
  ]);
  const forClass = students.filter(student => (
    student.data.classId === input.classId
    && (!student.data.academicYearId || student.data.academicYearId === input.academicYearId)
  ));
  const alreadyGraduated = forClass.filter(student => student.data.status === 'graduated');
  const excluded = forClass.filter(student => ['dropout', 'withdrawn', 'inactive', 'archived', 'transferred'].includes(student.data.status));
  const eligible = forClass.filter(student => !['graduated', 'dropout', 'withdrawn', 'inactive', 'archived', 'transferred'].includes(student.data.status));
  const missing = eligible.filter(student => !student.data.fullName || !student.data.classId);
  return { classItem, academicYear, students: forClass, alreadyGraduated, excluded, eligible, missing, targets };
}

function previewResponse(input, context) {
  return {
    schoolId: input.schoolId,
    institutionId: input.schoolId,
    classId: input.classId,
    className: context.classItem.data.name || '',
    academicYearId: input.academicYearId,
    academicYearLabel: context.academicYear.data.label || context.academicYear.data.hebrewLabel || '',
    graduationDate: input.graduationDate,
    activeStudentCount: context.eligible.length,
    alreadyGraduatedCount: context.alreadyGraduated.length,
    excludedStudentCount: context.excluded.length,
    missingDataCount: context.missing.length,
    outcomeTargetCount: context.targets.size,
    confirmationText: `אני מאשר להפוך ${context.eligible.length} תלמידים לבוגרים`,
  };
}

export async function previewClassGraduationHandler(request) {
  const actor = await requireActor(request);
  const input = classGraduationPreviewSchema.parse(request.data);
  await authorize(actor, input.schoolId, 'students.graduateClass');
  await enforceRateLimit({ uid: actor.uid, action: 'students.graduateClass.preview', limit: 30, windowSeconds: 300 });
  return previewResponse(input, await graduationContext(input));
}

async function claimJob(actor, input) {
  const ref = adminDb.doc(`schools/${input.schoolId}/graduationJobs/${input.requestId}`);
  const result = await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return { existing: true, data: snapshot.data() };
    transaction.create(ref, {
      schoolId: input.schoolId,
      institutionId: input.schoolId,
      requestId: input.requestId,
      classId: input.classId,
      academicYearId: input.academicYearId,
      status: 'processing',
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { existing: false };
  });
  return { ref, ...result };
}

export async function graduateClassHandler(request) {
  const actor = await requireActor(request);
  const input = graduateClassSchema.parse(request.data);
  await authorize(actor, input.schoolId, 'students.graduateClass');
  await enforceRateLimit({ uid: actor.uid, action: 'students.graduateClass', limit: 6, windowSeconds: 3600 });
  const job = await claimJob(actor, input);
  if (job.existing) {
    if (job.data.status !== 'completed') throw failedPrecondition();
    return { requestId: input.requestId, idempotentReplay: true, graduatedCount: job.data.graduatedCount || 0 };
  }

  try {
    const context = await graduationContext(input);
    const preview = previewResponse(input, context);
    if (input.confirmationText !== preview.confirmationText || context.eligible.length === 0) throw failedPrecondition();
    const classData = context.classItem.data;
    let batch = adminDb.batch();
    let writes = 0;
    let graduatedCount = 0;
    async function flush() {
      if (!writes) return;
      await batch.commit();
      batch = adminDb.batch();
      writes = 0;
    }

    for (const student of context.eligible) {
      const snapshotId = `${student.id}_${input.academicYearId}`;
      const graduationData = {
        status: 'graduated',
        graduationDate: input.graduationDate,
        graduationAcademicYearId: input.academicYearId,
        institutionId: input.schoolId,
        originalClassId: input.classId,
        graduationClassName: classData.name || student.data.className || '',
        graduationTrackIds: student.data.trackIds || classData.trackIds || [],
        graduationProgramTypes: student.data.programTypes || classData.programTypes || [],
        graduationHomeroomTeacherId: classData.homeroomTeacherId || classData.teacherId || '',
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      };
      batch.set(student.ref, graduationData, { merge: true });
      batch.set(adminDb.doc(`schools/${input.schoolId}/graduationSnapshots/${snapshotId}`), {
        schoolId: input.schoolId,
        institutionId: input.schoolId,
        studentId: student.id,
        classId: input.classId,
        className: graduationData.graduationClassName,
        academicYearId: input.academicYearId,
        graduationDate: input.graduationDate,
        trackIds: graduationData.graduationTrackIds,
        programTypes: graduationData.graduationProgramTypes,
        homeroomTeacherId: graduationData.graduationHomeroomTeacherId,
        sourceStudentStatus: student.data.status || 'active',
        createdBy: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: false });
      const enrollmentId = `${student.id}_${input.academicYearId}`;
      batch.set(adminDb.doc(`schools/${input.schoolId}/studentEnrollments/${enrollmentId}`), {
        schoolId: input.schoolId,
        studentId: student.id,
        classId: input.classId,
        className: graduationData.graduationClassName,
        academicYearId: input.academicYearId,
        status: 'graduated',
        endDate: input.graduationDate,
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(adminDb.collection(`schools/${input.schoolId}/students/${student.id}/history`).doc(), {
        schoolId: input.schoolId,
        studentId: student.id,
        type: 'class_graduated',
        classId: input.classId,
        academicYearId: input.academicYearId,
        effectiveDate: input.graduationDate,
        graduationSnapshotId: snapshotId,
        requestId: input.requestId,
        createdBy: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      writes += 4;
      graduatedCount += 1;
      if (writes >= 400) await flush();
    }
    await flush();
    await job.ref.update({ status: 'completed', graduatedCount, completedAt: FieldValue.serverTimestamp() });
    await writeAuditLog({
      actorUid: actor.uid,
      actorRole: actor.data.role || '',
      action: 'students.graduateClass',
      targetType: 'class',
      targetId: input.classId,
      schoolId: input.schoolId,
      requestId: input.requestId,
      after: { graduatedCount, graduationDate: input.graduationDate, academicYearId: input.academicYearId },
    });
    return { requestId: input.requestId, idempotentReplay: false, graduatedCount };
  } catch (error) {
    await job.ref.update({ status: 'failed', completedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
    throw error;
  }
}

export async function restoreGraduateHandler(request) {
  const actor = await requireActor(request);
  const input = restoreGraduateSchema.parse(request.data);
  await authorize(actor, input.schoolId, 'students.restoreGraduate');
  await enforceRateLimit({ uid: actor.uid, action: 'students.restoreGraduate', limit: 10, windowSeconds: 3600 });
  const [student, targetClass, targetYear] = await Promise.all([
    compatibleDoc(input.schoolId, 'students', input.studentId),
    compatibleDoc(input.schoolId, 'classes', input.targetClassId),
    compatibleDoc(input.schoolId, 'academicYears', input.targetAcademicYearId)
      .catch(() => compatibleDoc(input.schoolId, 'academic_years', input.targetAcademicYearId)),
  ]);
  if (student.data.status !== 'graduated' || targetYear.data.status === 'closed' || targetYear.data.isActive === false) {
    throw failedPrecondition();
  }
  const enrollmentId = `${input.studentId}_${input.targetAcademicYearId}`;
  const batch = adminDb.batch();
  batch.set(student.ref, {
    status: 'active',
    classId: input.targetClassId,
    className: targetClass.data.name || '',
    academicYearId: input.targetAcademicYearId,
    currentEnrollmentId: enrollmentId,
    restoredFromGraduationAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(adminDb.doc(`schools/${input.schoolId}/studentEnrollments/${enrollmentId}`), {
    schoolId: input.schoolId,
    studentId: input.studentId,
    classId: input.targetClassId,
    className: targetClass.data.name || '',
    academicYearId: input.targetAcademicYearId,
    status: 'active',
    startDate: input.effectiveDate,
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(adminDb.collection(`schools/${input.schoolId}/students/${input.studentId}/history`).doc(), {
    schoolId: input.schoolId,
    studentId: input.studentId,
    type: 'graduation_restored',
    nextClassId: input.targetClassId,
    nextAcademicYearId: input.targetAcademicYearId,
    reason: input.reason,
    requestId: input.requestId,
    effectiveDate: input.effectiveDate,
    createdBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  await writeAuditLog({
    actorUid: actor.uid,
    actorRole: actor.data.role || '',
    action: 'students.restoreGraduate',
    targetType: 'student',
    targetId: input.studentId,
    schoolId: input.schoolId,
    reason: input.reason,
    requestId: input.requestId,
    before: { status: student.data.status },
    after: { status: 'active', classId: input.targetClassId, academicYearId: input.targetAcademicYearId },
  });
  return { ok: true };
}

async function runSafely(handler, request) {
  try {
    return await handler(request);
  } catch (error) {
    logger.error('Graduation operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

export const previewClassGraduation = onCall(CALLABLE_OPTIONS, request => runSafely(previewClassGraduationHandler, request));
export const graduateClass = onCall({ ...CALLABLE_OPTIONS, timeoutSeconds: 120, memory: '512MiB' }, request => runSafely(graduateClassHandler, request));
export const restoreGraduate = onCall(CALLABLE_OPTIONS, request => runSafely(restoreGraduateHandler, request));
