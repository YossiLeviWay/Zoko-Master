import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { bulkStudentImportSchema } from '../validation/schemas.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { buildPermissionContext, evaluatePermission } from '../services/permissionEngine.js';

function normalizeIdNumber(value) {
  return String(value || '').normalize('NFKC').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

function studentFields(row, classData) {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
    classId: row.classId,
    className: classData.name || '',
    academicYear: row.academicYear,
    gradeLevel: row.gradeLevel || classData.gradeLevel || '',
    status: row.status,
    trackIds: row.trackIds,
    programTypes: row.programTypes,
    birthDate: row.birthDate,
    phone: row.phone,
    email: row.email,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    joinedAt: row.joinedAt,
  };
}

function enrollmentId(studentId, academicYearId) {
  return `${studentId}_${academicYearId}`;
}

async function readCompatibleCollection(schoolId, resource) {
  const [nested, legacy] = await Promise.all([
    adminDb.collection(`schools/${schoolId}/${resource}`).get(),
    adminDb.collection(`${resource}_${schoolId}`).get(),
  ]);
  const byId = new Map();
  legacy.docs.forEach(doc => byId.set(doc.id, { id: doc.id, ref: doc.ref, mode: 'legacy', ...doc.data() }));
  nested.docs.forEach(doc => byId.set(doc.id, { id: doc.id, ref: doc.ref, mode: 'nested', ...doc.data() }));
  return [...byId.values()];
}

async function readStudentIdentities(schoolId, students) {
  const refs = students.map(student => adminDb.doc(`schools/${schoolId}/students/${student.id}/sensitive/identity`));
  const snapshots = refs.length ? await adminDb.getAll(...refs) : [];
  const result = new Map();
  students.forEach((student, index) => {
    const sensitive = snapshots[index]?.exists ? snapshots[index].data() : {};
    const identity = normalizeIdNumber(sensitive.normalizedIdNumber || student.normalizedIdNumber || student.idNumber);
    if (identity) result.set(identity, student);
  });
  return result;
}

async function claimImportJob(actor, schoolId, requestId, count) {
  const ref = adminDb.doc(`schools/${schoolId}/studentImportJobs/${requestId}`);
  const claimed = await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return { existing: true, data: snapshot.data() };
    transaction.create(ref, {
      schoolId,
      requestId,
      status: 'processing',
      totals: { requested: count, created: 0, updated: 0, skipped: 0, failed: 0 },
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { existing: false };
  });
  return { ref, ...claimed };
}

export async function bulkImportStudentsHandler(request) {
  const actor = await requireActor(request);
  const input = bulkStudentImportSchema.parse(request.data);
  const schoolId = actor.data.activeSchoolId || actor.data.schoolId;
  if (!schoolId || !actor.schoolIds.has(schoolId)) throw permissionDenied();
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId });
  permissionContext.subject.platformAdmin = actor.platformAdmin;
  permissionContext.subject.globalAdmin = actor.globalAdmin;
  const schoolAccess = evaluatePermission(permissionContext, { capability: 'students.bulkImport', resource: {} });
  if (!schoolAccess.allowed && !input.students.every(row => evaluatePermission(permissionContext, {
    capability: 'students.bulkImport', resource: { classId: row.classId },
  }).allowed)) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'students.bulkImport', limit: 8, windowSeconds: 3600 });

  const job = await claimImportJob(actor, schoolId, input.requestId, input.students.length);
  if (job.existing) {
    if (job.data.status !== 'completed') throw permissionDenied();
    return { requestId: input.requestId, idempotentReplay: true, totals: job.data.totals, errors: [] };
  }

  try {
    const [classes, academicYears, students] = await Promise.all([
      readCompatibleCollection(schoolId, 'classes'),
      readCompatibleCollection(schoolId, 'academic_years'),
      readCompatibleCollection(schoolId, 'students'),
    ]);
    const classById = new Map(classes.map(item => [item.id, item]));
    const yearById = new Map(academicYears.map(item => [item.id, item]));
    const existingByIdentity = await readStudentIdentities(schoolId, students);
    const seenInput = new Set();
    const totals = { requested: input.students.length, created: 0, updated: 0, skipped: 0, failed: 0 };
    const errors = [];
    let batch = adminDb.batch();
    let batchWrites = 0;

    async function flush() {
      if (batchWrites === 0) return;
      await batch.commit();
      batch = adminDb.batch();
      batchWrites = 0;
    }

    for (const row of input.students) {
      const normalizedId = normalizeIdNumber(row.idNumber);
      const classData = classById.get(row.classId);
      if (!normalizedId || !classData || !yearById.has(row.academicYearId)) {
        totals.failed += 1;
        errors.push({ rowId: row.rowId, reason: !classData ? 'class-not-found' : !yearById.has(row.academicYearId) ? 'academic-year-not-found' : 'invalid-identifier' });
        continue;
      }
      if (seenInput.has(normalizedId)) {
        totals.failed += 1;
        errors.push({ rowId: row.rowId, reason: 'duplicate-in-request' });
        continue;
      }
      seenInput.add(normalizedId);
      const existing = existingByIdentity.get(normalizedId);
      if (existing && row.duplicateAction !== 'update') {
        totals.skipped += 1;
        errors.push({ rowId: row.rowId, reason: row.duplicateAction === 'review' ? 'duplicate-review-required' : 'duplicate-skipped' });
        continue;
      }

      const studentRef = existing?.ref || adminDb.collection(`schools/${schoolId}/students`).doc();
      const fields = studentFields(row, classData);
      const yearEnrollmentId = enrollmentId(studentRef.id, row.academicYearId);
      batch.set(studentRef, {
        ...fields,
        schoolId,
        currentEnrollmentId: yearEnrollmentId,
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(!existing ? { createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), requirementStatus: {} } : {}),
      }, { merge: Boolean(existing) });
      batchWrites += 1;
      batch.set(adminDb.doc(`schools/${schoolId}/students/${studentRef.id}/sensitive/identity`), {
        schoolId,
        studentId: studentRef.id,
        idNumber: row.idNumber,
        normalizedIdNumber: normalizedId,
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(!existing ? { createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() } : {}),
      }, { merge: Boolean(existing) });
      batchWrites += 1;
      const enrollmentRef = adminDb.doc(`schools/${schoolId}/studentEnrollments/${yearEnrollmentId}`);
      batch.set(enrollmentRef, {
        schoolId,
        studentId: studentRef.id,
        academicYearId: row.academicYearId,
        classId: row.classId,
        className: classData.name || '',
        gradeLevel: fields.gradeLevel,
        status: row.status,
        startDate: row.joinedAt,
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(!existing ? { createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() } : {}),
      }, { merge: true });
      batchWrites += 1;
      if (row.initialNote) {
        batch.set(adminDb.doc(
          `schools/${schoolId}/students/${studentRef.id}/notes/import_${input.requestId}_${row.rowId}`,
        ), {
          schoolId,
          studentId: studentRef.id,
          content: row.initialNote,
          visibility: 'school_admin',
          source: 'bulk_import',
          createdBy: actor.uid,
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: false });
        batchWrites += 1;
      }
      if (!existing) {
        batch.set(adminDb.doc(`schools/${schoolId}/personalFiles/${studentRef.id}`), {
          schoolId, studentId: studentRef.id, status: 'active', createdBy: actor.uid,
          updatedBy: actor.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        });
        batch.set(adminDb.collection(`schools/${schoolId}/students/${studentRef.id}/history`).doc(), {
          schoolId, studentId: studentRef.id, type: 'student_imported', nextClassId: row.classId,
          effectiveDate: row.joinedAt, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(),
        });
        batchWrites += 2;
        totals.created += 1;
        existingByIdentity.set(normalizedId, { ref: studentRef, ...fields });
      } else {
        totals.updated += 1;
      }
      if (batchWrites >= 400) await flush();
    }
    await flush();
    await job.ref.update({
      status: 'completed', totals, completedAt: FieldValue.serverTimestamp(),
      errorReport: errors.slice(0, 200),
    });
    await writeAuditLog({
      actorUid: actor.uid,
      action: 'students.bulkImport',
      schoolId,
      metadata: { requestId: input.requestId, created: totals.created, updated: totals.updated, skipped: totals.skipped, failed: totals.failed },
    });
    return { requestId: input.requestId, idempotentReplay: false, totals, errors };
  } catch (error) {
    await job.ref.update({ status: 'failed', completedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
    throw error;
  }
}

async function runSafely(request) {
  try {
    return await bulkImportStudentsHandler(request);
  } catch (error) {
    logger.error('Bulk student import failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

export const bulkImportStudents = onCall({ ...CALLABLE_OPTIONS, timeoutSeconds: 120, memory: '512MiB' }, runSafely);
