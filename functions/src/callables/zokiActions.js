import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { zokiGradeActionSchema, zokiStudentTransferActionSchema } from '../validation/schemas.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, publicError, toPublicError } from '../services/errors.js';
import { calculateSubjectGrade } from '../services/gradeCalculator.js';
import { buildPermissionContext, evaluatePermission } from '../services/permissionEngine.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { createHash } from 'node:crypto';

function stableId(...parts) {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 40);
}

function normalizedScore(value) {
  if (value === '' || value === null || value === undefined) return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function sameScore(left, right) {
  return normalizedScore(left) === normalizedScore(right);
}

export async function executeZokiGradeHandler(request) {
  const actor = await requireActor(request);
  const input = zokiGradeActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiGradeExecute', limit: 30, windowSeconds: 300 });
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId });
  const gradebookRef = adminDb.doc(`schools/${input.schoolId}/gradebooks/${input.gradebookId}`);
  const studentRef = adminDb.doc(`schools/${input.schoolId}/students/${input.studentId}`);
  const gradeRef = gradebookRef.collection('grades').doc(input.studentId);
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const [receipt, gradebookSnapshot, studentSnapshot, gradeSnapshot] = await Promise.all([
      transaction.get(receiptRef), transaction.get(gradebookRef), transaction.get(studentRef), transaction.get(gradeRef),
    ]);
    if (receipt.exists) {
      const receiptData = receipt.data();
      result = { gradebookId: receiptData.gradebookId, studentId: receiptData.studentId };
      return;
    }
    if (!gradebookSnapshot.exists || !studentSnapshot.exists) throw permissionDenied();
    const gradebook = gradebookSnapshot.data();
    const student = studentSnapshot.data();
    if (gradebook.schoolId !== input.schoolId || student.schoolId !== input.schoolId
      || !gradebook.classId || student.classId !== gradebook.classId
      || gradebook.status === 'archived' || student.status === 'archived') throw permissionDenied();
    const permission = evaluatePermission(permissionContext, {
      capability: 'grades.edit', accessLevel: 'edit', resource: { classId: gradebook.classId },
    });
    if (!permission.allowed) throw permissionDenied();
    const subject = (Array.isArray(gradebook.subjects) ? gradebook.subjects : []).find(item => item?.id === input.subjectId);
    const component = (Array.isArray(subject?.components) ? subject.components : []).find(item => item?.id === input.componentId);
    if (!subject || !component) throw publicError('failed-precondition', 'grade-component-changed', 'מבנה הציונים השתנה. יש לבקש מזוקי הצעה חדשה.');
    const current = gradeSnapshot.data() || {};
    const previousScore = current.scores?.[input.subjectId]?.[input.componentId];
    if (!sameScore(previousScore, input.expectedPreviousScore)) {
      throw publicError('aborted', 'grade-changed', 'הציון השתנה מאז ההצעה. יש לבדוק ולאשר מחדש.');
    }
    const scores = {
      ...(current.scores || {}),
      [input.subjectId]: {
        ...(current.scores?.[input.subjectId] || {}),
        [input.componentId]: String(input.score),
      },
    };
    let calculated;
    try { calculated = { ...(current.calculated || {}), [input.subjectId]: calculateSubjectGrade(subject, scores[input.subjectId]) }; }
    catch { throw publicError('failed-precondition', 'grade-formula-invalid', 'לא ניתן לחשב את הציון לפי הנוסחה הנוכחית.'); }
    transaction.set(gradeRef, {
      schoolId: input.schoolId, gradebookId: input.gradebookId, classId: gradebook.classId,
      studentId: input.studentId, displayName: student.fullName || student.name || '',
      scores, calculated, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'grade.update', requestId: input.requestId,
      gradebookId: input.gradebookId, studentId: input.studentId, subjectId: input.subjectId, componentId: input.componentId,
      createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = {
      gradebookId: input.gradebookId, studentId: input.studentId,
      studentName: student.fullName || student.name || '', subjectName: subject.name || '', componentName: component.name || '',
      previousScore: normalizedScore(previousScore), score: input.score, calculatedScore: calculated[input.subjectId],
    };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.grade.update', targetType: 'studentGrade', targetId: `${input.gradebookId}_${input.studentId}`,
    schoolId: input.schoolId,
    metadata: { gradebookId: input.gradebookId, studentId: input.studentId, subjectId: input.subjectId, componentId: input.componentId },
  });
  return { ok: true, executed, ...result, route: `/students?student=${encodeURIComponent(input.studentId)}` };
}

export async function executeZokiStudentTransferHandler(request) {
  const actor = await requireActor(request);
  const input = zokiStudentTransferActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiStudentTransfer', limit: 15, windowSeconds: 300 });
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId });
  const studentRef = adminDb.doc(`schools/${input.schoolId}/students/${input.studentId}`);
  const targetClassRef = adminDb.doc(`schools/${input.schoolId}/classes/${input.targetClassId}`);
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const [receipt, studentSnapshot, targetClassSnapshot] = await Promise.all([
      transaction.get(receiptRef), transaction.get(studentRef), transaction.get(targetClassRef),
    ]);
    if (receipt.exists) {
      const value = receipt.data();
      result = { studentId: value.studentId, targetClassId: value.targetClassId };
      return;
    }
    if (!studentSnapshot.exists || !targetClassSnapshot.exists) throw permissionDenied();
    const student = studentSnapshot.data();
    const targetClass = targetClassSnapshot.data();
    if (student.schoolId !== input.schoolId || targetClass.schoolId !== input.schoolId
      || student.status !== 'active' || targetClass.status === 'archived'
      || student.classId === input.targetClassId) throw permissionDenied();
    if ((student.classId || '') !== input.expectedCurrentClassId) {
      throw publicError('aborted', 'student-class-changed', 'שיוך התלמיד השתנה מאז ההצעה. יש לבדוק מחדש.');
    }
    const currentClassRef = adminDb.doc(`schools/${input.schoolId}/classes/${student.classId}`);
    const currentClassSnapshot = await transaction.get(currentClassRef);
    if (!currentClassSnapshot.exists) throw permissionDenied();
    const currentClass = currentClassSnapshot.data();
    const transferPermission = evaluatePermission(permissionContext, {
      capability: 'students.transferClass', accessLevel: 'edit', resource: { classId: student.classId },
    });
    const legacyTransferPermission = evaluatePermission(permissionContext, {
      capability: 'students_transfer_class', accessLevel: 'edit', resource: { classId: student.classId },
    });
    const targetViewPermission = evaluatePermission(permissionContext, {
      capability: 'classes.view', accessLevel: 'view', resource: { classId: input.targetClassId },
    });
    if ((!transferPermission.allowed && !legacyTransferPermission.allowed) || !targetViewPermission.allowed) throw permissionDenied();
    const currentYearId = currentClass.academicYearId || student.academicYearId || '';
    const targetYearId = targetClass.academicYearId || '';
    if (!currentYearId || !targetYearId || currentYearId !== targetYearId) {
      throw publicError('failed-precondition', 'cross-year-transfer', 'העברה דרך זוקי אפשרית רק בין כיתות באותה שנת לימודים.');
    }
    const enrollmentId = typeof student.currentEnrollmentId === 'string' && student.currentEnrollmentId
      ? student.currentEnrollmentId : `${input.studentId}__${currentYearId}`;
    const enrollmentRef = adminDb.doc(`schools/${input.schoolId}/studentEnrollments/${enrollmentId}`);
    const enrollmentSnapshot = await transaction.get(enrollmentRef);
    if (enrollmentSnapshot.exists && (enrollmentSnapshot.data().studentId !== input.studentId
      || enrollmentSnapshot.data().academicYearId !== currentYearId)) throw permissionDenied();
    const enrollmentBase = enrollmentSnapshot.exists ? enrollmentSnapshot.data() : {
      studentId: input.studentId, schoolId: input.schoolId, academicYearId: currentYearId,
      academicYearLabel: currentClass.academicYear || student.academicYear || '',
      enrollmentStatus: 'active', startDate: student.joinedAt || '', endDate: '', exitReason: '',
      displayName: student.fullName || '', majorIds: student.trackIds || [], studyProgramIds: student.programTypes || [],
      createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(),
    };
    transaction.set(enrollmentRef, {
      ...enrollmentBase,
      classId: input.targetClassId, className: targetClass.name || '', grade: targetClass.gradeLevel || '',
      updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(studentRef, {
      classId: input.targetClassId, className: targetClass.name || '', gradeLevel: targetClass.gradeLevel || '',
      academicYear: targetClass.academicYear || targetClass.academicYearLabel || student.academicYear || '',
      academicYearId: targetYearId, currentEnrollmentId: enrollmentId, status: 'active',
      joinedAt: input.effectiveDate, endDate: '', updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(studentRef.collection('history').doc(`zoki_${actionId}`), {
      type: 'class_transfer', schoolId: input.schoolId, studentId: input.studentId,
      previousClassId: student.classId || '', previousClassName: student.className || currentClass.name || '',
      nextClassId: input.targetClassId, nextClassName: targetClass.name || '', academicYearId: currentYearId,
      effectiveDate: input.effectiveDate, reason: input.reason, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'student.transferClass', requestId: input.requestId,
      studentId: input.studentId, previousClassId: student.classId || '', targetClassId: input.targetClassId,
      createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = {
      studentId: input.studentId, studentName: student.fullName || '', previousClassId: student.classId || '',
      previousClassName: student.className || currentClass.name || '', targetClassId: input.targetClassId,
      targetClassName: targetClass.name || '', effectiveDate: input.effectiveDate,
    };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.student.transferClass', targetType: 'student', targetId: input.studentId,
    schoolId: input.schoolId,
    metadata: { previousClassId: result.previousClassId, targetClassId: result.targetClassId },
  });
  return { ok: true, executed, ...result, route: `/students?student=${encodeURIComponent(input.studentId)}` };
}

export const executeZokiGrade = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiGradeHandler(request); }
  catch (error) { logger.error('Zoki grade action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiStudentTransfer = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiStudentTransferHandler(request); }
  catch (error) { logger.error('Zoki student transfer failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});
