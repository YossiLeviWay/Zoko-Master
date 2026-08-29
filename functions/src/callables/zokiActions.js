import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import {
  zokiAttendanceActionSchema,
  zokiCalendarEventActionSchema,
  zokiCalendarEventCancelActionSchema,
  zokiCalendarEventUpdateActionSchema,
  zokiContactActionSchema,
  zokiDirectPermissionActionSchema,
  zokiGradeActionSchema,
  zokiRoleAssignmentActionSchema,
  zokiResourceAccessActionSchema,
  zokiResourceCreateActionSchema,
  zokiResourceMoveActionSchema,
  zokiResourceRenameActionSchema,
  zokiStudentNoteActionSchema,
  zokiStudentTrackActionSchema,
  zokiStudentTransferActionSchema,
  zokiTeamMembershipActionSchema,
  zokiTeamCreateActionSchema,
  zokiTeamManagerActionSchema,
  zokiTaskStatusActionSchema,
  zokiTaskAssignmentActionSchema,
  zokiTaskDetailsActionSchema,
} from '../validation/schemas.js';
import { isPrincipalFor, requireActor, requireTargetInSchool } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, publicError, toPublicError } from '../services/errors.js';
import { calculateSubjectGrade } from '../services/gradeCalculator.js';
import { buildPermissionContext, evaluatePermission, withResourcePermissionContext } from '../services/permissionEngine.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { getRole, resolveActorRoleAuthority } from '../services/roleAuthorization.js';
import { directPermissionDefinition } from '../permissionCatalog.js';
import { assignCustomRoleHandler } from './roles.js';
import { rebuildAclPolicy } from './permissions.js';
import { createHash } from 'node:crypto';
import { calendarEventVersion } from '../services/calendarEventState.js';

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

function calendarDateParts(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw publicError('invalid-argument', 'invalid-calendar-date', 'תאריך האירוע אינו תקין.');
  }
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

export async function executeZokiTaskStatusHandler(request) {
  const actor = await requireActor(request);
  const input = zokiTaskStatusActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiTaskStatus', limit: 30, windowSeconds: 300 });
  const nestedRef = adminDb.doc(`schools/${input.schoolId}/tasks/${input.taskId}`);
  const legacyRef = adminDb.doc(`tasks_${input.schoolId}/${input.taskId}`);
  const personalRef = adminDb.doc(`users/${actor.uid}/personalTasks/${input.taskId}`);
  const primaryRef = input.storageMode === 'personal' ? personalRef : input.storageMode === 'nested' ? nestedRef : legacyRef;
  const primaryBefore = await primaryRef.get();
  if (!primaryBefore.exists) throw permissionDenied();
  const before = primaryBefore.data();
  let canEditAll = false;
  if (input.storageMode === 'personal') {
    if (before.schoolId !== input.schoolId || before.scope !== 'personal'
      || before.ownerId !== actor.uid || before.createdBy !== actor.uid) throw permissionDenied();
  } else {
    if ((before.schoolId && before.schoolId !== input.schoolId) || before.scope === 'personal') throw permissionDenied();
    const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId });
    canEditAll = evaluatePermission(permissionContext, { capability: 'tasks.editAll', accessLevel: 'edit', resource: {} }).allowed
      || evaluatePermission(permissionContext, { capability: 'tasks_edit', accessLevel: 'edit', resource: {} }).allowed;
    const assigned = Array.isArray(before.assigneeIds) && before.assigneeIds.includes(actor.uid);
    const participant = Array.isArray(before.participantIds) && before.participantIds.includes(actor.uid);
    if (!canEditAll && !assigned && !participant) throw permissionDenied();
  }
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;
  await adminDb.runTransaction(async transaction => {
    const [receipt, primary, nested, legacy] = await Promise.all([
      transaction.get(receiptRef), transaction.get(primaryRef), transaction.get(nestedRef), transaction.get(legacyRef),
    ]);
    if (receipt.exists) {
      const value = receipt.data();
      result = { taskId: value.taskId, status: value.status };
      return;
    }
    if (!primary.exists) throw permissionDenied();
    const task = primary.data();
    if (input.storageMode === 'personal') {
      if (task.schoolId !== input.schoolId || task.scope !== 'personal'
        || task.ownerId !== actor.uid || task.createdBy !== actor.uid) throw permissionDenied();
    } else {
      const assigned = Array.isArray(task.assigneeIds) && task.assigneeIds.includes(actor.uid);
      const participant = Array.isArray(task.participantIds) && task.participantIds.includes(actor.uid);
      if ((task.schoolId && task.schoolId !== input.schoolId) || task.scope === 'personal'
        || (!canEditAll && !assigned && !participant)) throw permissionDenied();
    }
    const currentStatus = ['todo', 'in_progress', 'done', 'completed'].includes(task.status) ? task.status : 'todo';
    if (currentStatus !== input.expectedStatus) {
      throw publicError('aborted', 'task-status-changed', 'מצב המשימה השתנה מאז ההצעה. יש לבקש מזוקי לבדוק מחדש.');
    }
    if ((currentStatus === 'completed' ? 'done' : currentStatus) === input.status) {
      throw publicError('failed-precondition', 'task-status-already-applied', 'המשימה כבר נמצאת במצב המבוקש.');
    }
    const patch = {
      status: input.status,
      completedAt: input.status === 'done' ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (input.storageMode === 'personal') transaction.update(personalRef, patch);
    else {
      if (nested.exists && (!nested.data().schoolId || nested.data().schoolId === input.schoolId)) transaction.update(nestedRef, patch);
      if (legacy.exists && (!legacy.data().schoolId || legacy.data().schoolId === input.schoolId)) transaction.update(legacyRef, patch);
    }
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'task.status.update', requestId: input.requestId,
      taskId: input.taskId, storageMode: input.storageMode, status: input.status, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = { taskId: input.taskId, status: input.status };
  });
  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.task.status.update', targetType: 'task', targetId: input.taskId,
    schoolId: input.schoolId, metadata: { taskId: input.taskId, status: input.status, storageMode: input.storageMode },
  });
  return { ok: true, executed, ...result, route: `/tasks?task=${encodeURIComponent(input.taskId)}` };
}

export async function executeZokiTaskAssignmentHandler(request) {
  const actor = await requireActor(request);
  const input = zokiTaskAssignmentActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiTaskAssignment', limit: 25, windowSeconds: 300 });
  const target = await requireTargetInSchool(actor, input.userId, input.schoolId, { requireAuthUser: false });
  const nestedRef = adminDb.doc(`schools/${input.schoolId}/tasks/${input.taskId}`);
  const legacyRef = adminDb.doc(`tasks_${input.schoolId}/${input.taskId}`);
  const primaryRef = input.storageMode === 'nested' ? nestedRef : legacyRef;
  const primaryBefore = await primaryRef.get();
  if (!primaryBefore.exists) throw permissionDenied();
  const before = primaryBefore.data();
  if ((before.schoolId && before.schoolId !== input.schoolId) || before.scope === 'personal') throw permissionDenied();
  const permissionContext = await withResourcePermissionContext(
    await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId }),
    { resourceType: 'task', resourceId: input.taskId },
  );
  const allowed = capability => evaluatePermission(permissionContext, {
    capability, accessLevel: 'edit', resourceType: 'task', resourceId: input.taskId,
    resource: { resourceType: 'task', resourceId: input.taskId },
  }).allowed;
  const editAll = allowed('tasks.editAll') || allowed('tasks_edit');
  const canAssign = editAll || allowed('tasks.assign') || allowed('tasks_assign');
  const canRemove = editAll || allowed('tasks.manageAssignments');
  if ((input.action === 'add' && !canAssign) || (input.action === 'remove' && !canRemove)) throw permissionDenied();

  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;
  await adminDb.runTransaction(async transaction => {
    const [receipt, primary, nested, legacy, targetSnapshot] = await Promise.all([
      transaction.get(receiptRef), transaction.get(primaryRef), transaction.get(nestedRef),
      transaction.get(legacyRef), transaction.get(target.ref),
    ]);
    if (receipt.exists) {
      const value = receipt.data();
      result = { taskId: value.taskId, userId: value.userId, operation: value.operation };
      return;
    }
    if (!primary.exists || !targetSnapshot.exists) throw permissionDenied();
    const task = primary.data();
    const targetData = targetSnapshot.data();
    if ((task.schoolId && task.schoolId !== input.schoolId) || task.scope === 'personal'
      || !userInSchool(targetData, input.schoolId)
      || targetData.accountStatus === 'disabled' || targetData.status === 'archived') throw permissionDenied();
    const currentAssigneeIds = [...new Set(Array.isArray(task.assigneeIds) ? task.assigneeIds : [])].sort();
    if (JSON.stringify(currentAssigneeIds) !== JSON.stringify(input.expectedAssigneeIds)) {
      throw publicError('aborted', 'task-assignees-changed', 'אחראי המשימה השתנו מאז ההצעה. יש לבקש מזוקי לבדוק מחדש.');
    }
    const currentlyAssigned = currentAssigneeIds.includes(input.userId);
    if (currentlyAssigned !== input.expectedCurrentlyAssigned) {
      throw publicError('aborted', 'task-assignees-changed', 'אחראי המשימה השתנו מאז ההצעה. יש לבקש מזוקי לבדוק מחדש.');
    }
    if ((input.action === 'add' && currentlyAssigned) || (input.action === 'remove' && !currentlyAssigned)) {
      throw publicError('failed-precondition', 'task-assignment-already-applied', 'שיוך המשימה כבר נמצא במצב המבוקש.');
    }
    const nextAssigneeIds = input.action === 'add'
      ? [...new Set([...currentAssigneeIds, input.userId])].slice(0, 50)
      : currentAssigneeIds.filter(id => id !== input.userId);
    const currentParticipantIds = [...new Set(Array.isArray(task.participantIds) ? task.participantIds : [])];
    const nextParticipantIds = input.action === 'add'
      ? [...new Set([...currentParticipantIds, input.userId])].slice(0, 100)
      : currentParticipantIds.filter(id => id !== input.userId);
    const patch = {
      scope: 'assigned', assigneeType: 'individual', assigneeIds: nextAssigneeIds,
      participantIds: nextParticipantIds, teamId: '', assigneeTeamId: '', lastAssignedStaffId: input.userId,
      assignmentUpdatedBy: actor.uid, assignmentUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    };
    if (nested.exists && (!nested.data().schoolId || nested.data().schoolId === input.schoolId)) transaction.update(nestedRef, patch);
    if (legacy.exists && (!legacy.data().schoolId || legacy.data().schoolId === input.schoolId)) transaction.update(legacyRef, patch);
    if (input.action === 'add') transaction.create(adminDb.doc(`notifications/zoki_task_assignment_${actionId}`), {
      userId: input.userId, schoolId: input.schoolId, title: 'משימה הוקצתה לך',
      body: String(task.title || 'משימה חדשה').slice(0, 200), link: `/tasks?task=${encodeURIComponent(input.taskId)}`,
      type: 'task', read: false, createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'task.assignment.change', requestId: input.requestId,
      taskId: input.taskId, userId: input.userId, operation: input.action,
      storageMode: input.storageMode, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = {
      taskId: input.taskId, userId: input.userId, operation: input.action,
      staffName: targetData.fullName || targetData.displayName || targetData.name || '',
    };
  });
  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: `zoki.action.task.assignment.${input.action}`, targetType: 'task', targetId: input.taskId,
    targetUid: input.userId, schoolId: input.schoolId,
    metadata: { taskId: input.taskId, userId: input.userId, operation: input.action, storageMode: input.storageMode },
  });
  return { ok: true, executed, ...result, route: `/tasks?task=${encodeURIComponent(input.taskId)}` };
}

function normalizedTaskDetails(task = {}) {
  return {
    title: String(task.title || '').trim(),
    description: String(task.description || '').trim(),
    priority: ['low', 'medium', 'high'].includes(task.priority) ? task.priority : 'medium',
    dueDate: /^\d{4}-\d{2}-\d{2}$/u.test(task.dueDate || '') ? task.dueDate : '',
  };
}

export async function executeZokiTaskDetailsHandler(request) {
  const actor = await requireActor(request);
  const input = zokiTaskDetailsActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiTaskDetails', limit: 25, windowSeconds: 300 });
  const nestedRef = adminDb.doc(`schools/${input.schoolId}/tasks/${input.taskId}`);
  const legacyRef = adminDb.doc(`tasks_${input.schoolId}/${input.taskId}`);
  const personalRef = adminDb.doc(`users/${actor.uid}/personalTasks/${input.taskId}`);
  const primaryRef = input.storageMode === 'personal' ? personalRef : input.storageMode === 'nested' ? nestedRef : legacyRef;
  const primaryBefore = await primaryRef.get();
  if (!primaryBefore.exists) throw permissionDenied();
  const before = primaryBefore.data();
  if (input.storageMode === 'personal') {
    if (before.schoolId !== input.schoolId || before.scope !== 'personal'
      || before.ownerId !== actor.uid || before.createdBy !== actor.uid) throw permissionDenied();
  } else {
    if ((before.schoolId && before.schoolId !== input.schoolId) || before.scope === 'personal') throw permissionDenied();
    const permissionContext = await withResourcePermissionContext(
      await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId }),
      { resourceType: 'task', resourceId: input.taskId },
    );
    const allowed = capability => evaluatePermission(permissionContext, {
      capability, accessLevel: 'edit', resourceType: 'task', resourceId: input.taskId,
      resource: { resourceType: 'task', resourceId: input.taskId },
    }).allowed;
    if (!allowed('tasks.editAll') && !allowed('tasks_edit')) throw permissionDenied();
  }
  const changedFields = Object.keys(input.expected).filter(key => input.expected[key] !== input.task[key]);
  if (!changedFields.length) throw publicError('failed-precondition', 'task-details-already-applied', 'פרטי המשימה כבר נמצאים במצב המבוקש.');
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;
  await adminDb.runTransaction(async transaction => {
    const [receipt, primary, nested, legacy] = await Promise.all([
      transaction.get(receiptRef), transaction.get(primaryRef), transaction.get(nestedRef), transaction.get(legacyRef),
    ]);
    if (receipt.exists) {
      result = { taskId: receipt.data().taskId, changedFields: receipt.data().changedFields || [] };
      return;
    }
    if (!primary.exists) throw permissionDenied();
    const task = primary.data();
    if (input.storageMode === 'personal') {
      if (task.schoolId !== input.schoolId || task.scope !== 'personal'
        || task.ownerId !== actor.uid || task.createdBy !== actor.uid) throw permissionDenied();
    } else if ((task.schoolId && task.schoolId !== input.schoolId) || task.scope === 'personal') throw permissionDenied();
    if (JSON.stringify(normalizedTaskDetails(task)) !== JSON.stringify(input.expected)) {
      throw publicError('aborted', 'task-details-changed', 'פרטי המשימה השתנו מאז ההצעה. יש לבקש מזוקי לבדוק מחדש.');
    }
    const patch = { ...input.task, updatedAt: FieldValue.serverTimestamp() };
    if (input.storageMode === 'personal') transaction.update(personalRef, patch);
    else {
      if (nested.exists && (!nested.data().schoolId || nested.data().schoolId === input.schoolId)) transaction.update(nestedRef, patch);
      if (legacy.exists && (!legacy.data().schoolId || legacy.data().schoolId === input.schoolId)) transaction.update(legacyRef, patch);
    }
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'task.details.update', requestId: input.requestId,
      taskId: input.taskId, storageMode: input.storageMode, changedFields,
      createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = { taskId: input.taskId, changedFields };
  });
  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.task.details.update', targetType: 'task', targetId: input.taskId,
    schoolId: input.schoolId, metadata: { taskId: input.taskId, storageMode: input.storageMode, changedFields: changedFields.join(',') },
  });
  return { ok: true, executed, ...result, route: `/tasks?task=${encodeURIComponent(input.taskId)}` };
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

export async function executeZokiRoleAssignmentHandler(request) {
  const actor = await requireActor(request);
  const input = zokiRoleAssignmentActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiRoleAssignment', limit: 20, windowSeconds: 300 });
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  const existingReceipt = await receiptRef.get();
  if (existingReceipt.exists) {
    const value = existingReceipt.data();
    return {
      ok: true, executed: false, userId: value.userId, roleId: value.roleId, operation: value.operation,
      route: '/staff',
    };
  }

  const [target, role] = await Promise.all([
    requireTargetInSchool(actor, input.userId, input.schoolId),
    getRole(input.roleId, input.schoolId),
  ]);
  const assignments = target.data.customRoleAssignments || {};
  const currentRoleIds = Array.isArray(assignments[input.schoolId])
    ? assignments[input.schoolId]
    : Array.isArray(target.data.customRoleIds) ? target.data.customRoleIds : [];
  const currentlyAssigned = currentRoleIds.includes(input.roleId);
  if (currentlyAssigned !== input.expectedCurrentlyAssigned) {
    throw publicError('aborted', 'staff-role-changed', 'שיוך התפקיד השתנה מאז ההצעה. יש לבדוק ולאשר מחדש.');
  }
  if ((input.action === 'assign' && currentlyAssigned)
    || (input.action === 'remove' && !currentlyAssigned)) {
    throw publicError('failed-precondition', 'staff-role-already-applied', 'התפקיד כבר נמצא במצב המבוקש.');
  }

  await assignCustomRoleHandler({
    ...request,
    data: {
      schoolId: input.schoolId,
      roleId: input.roleId,
      userId: input.userId,
      action: input.action,
      confirmSensitiveChange: true,
    },
  });

  let executed = false;
  await adminDb.runTransaction(async transaction => {
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) return;
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: `role.${input.action}`,
      requestId: input.requestId, userId: input.userId, roleId: input.roleId,
      operation: input.action, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
  });
  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: `zoki.action.role.${input.action}`, targetType: 'staff', targetId: input.userId,
    targetUid: input.userId, schoolId: input.schoolId, metadata: { roleId: input.roleId },
  });
  return {
    ok: true, executed, userId: input.userId, staffName: target.data.fullName || target.data.displayName || '',
    roleId: input.roleId, roleName: role.data.name || role.data.title || '', operation: input.action, route: '/staff',
  };
}

export async function executeZokiDirectPermissionHandler(request) {
  const actor = await requireActor(request);
  const input = zokiDirectPermissionActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  const authority = await resolveActorRoleAuthority(actor, input.schoolId);
  if (!authority.unrestricted) throw permissionDenied();
  const definition = directPermissionDefinition(input.permissionKey);
  if (!definition) throw permissionDenied();
  const target = await requireTargetInSchool(actor, input.userId, input.schoolId, { requireAuthUser: false });
  await enforceRateLimit({ uid: actor.uid, action: 'zokiDirectPermission', limit: 20, windowSeconds: 300 });
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const [receipt, targetSnapshot] = await Promise.all([
      transaction.get(receiptRef), transaction.get(target.ref),
    ]);
    if (receipt.exists) {
      const value = receipt.data();
      result = { userId: value.userId, permissionKey: value.permissionKey, operation: value.operation };
      return;
    }
    if (!targetSnapshot.exists) throw permissionDenied();
    const targetData = targetSnapshot.data();
    const targetRole = targetData.rolesBySchool?.[input.schoolId] || targetData.role || '';
    if (!userInSchool(targetData, input.schoolId)
      || targetData.accountStatus === 'disabled' || targetData.status === 'archived'
      || ['principal', 'institution_manager', 'global_admin', 'platform_admin'].includes(targetRole)) {
      throw permissionDenied();
    }
    const currentPermissions = targetData.permissions || {};
    const currentlyEnabled = definition.keys.some(key => currentPermissions[key] === true);
    if (currentlyEnabled !== input.expectedCurrentlyEnabled) {
      throw publicError('aborted', 'staff-permission-changed', 'הרשאות איש הצוות השתנו מאז ההצעה. יש לבדוק ולאשר מחדש.');
    }
    const grant = input.action === 'grant';
    if (grant === currentlyEnabled) {
      throw publicError('failed-precondition', 'staff-permission-already-applied', 'ההרשאה כבר נמצאת במצב המבוקש.');
    }
    const nextPermissions = { ...currentPermissions };
    definition.keys.forEach(key => { nextPermissions[key] = grant; });
    transaction.update(target.ref, { permissions: nextPermissions, updatedAt: FieldValue.serverTimestamp() });
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'staff.permission.change',
      requestId: input.requestId, userId: input.userId, permissionKey: definition.key,
      operation: input.action, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = {
      userId: input.userId,
      staffName: targetData.fullName || targetData.displayName || targetData.name || '',
      permissionKey: definition.key,
      permissionName: definition.label,
      operation: input.action,
    };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: input.action === 'grant' ? 'zoki.action.permission.grant' : 'zoki.action.permission.revoke',
    targetType: 'staffPermission', targetId: input.userId, targetUid: input.userId,
    schoolId: input.schoolId, metadata: { permissionKey: definition.key },
  });
  return { ok: true, executed, ...result, route: '/staff' };
}

function currentResourceAclState(items) {
  const active = items.filter(item => {
    if (item.active === false) return false;
    const expiresAt = item.expiresAt?.toMillis?.() || (item.expiresAt ? Date.parse(item.expiresAt) : 0);
    return !expiresAt || expiresAt > Date.now();
  });
  if (!active.length) return 'none';
  if (active.some(item => item.explicitDeny === true)) return 'deny';
  const levels = ['view', 'comment', 'edit', 'manage'];
  const highest = active.reduce((current, item) => (
    levels.indexOf(item.accessLevel) > levels.indexOf(current) ? item.accessLevel : current
  ), 'view');
  return `grant:${highest}`;
}

export async function executeZokiResourceAccessHandler(request) {
  const actor = await requireActor(request);
  const input = zokiResourceAccessActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  const authority = await resolveActorRoleAuthority(actor, input.schoolId);
  if (!authority.unrestricted && !authority.permissions.has('files.managePermissions')) throw permissionDenied();
  const target = await requireTargetInSchool(actor, input.userId, input.schoolId, { requireAuthUser: false });
  await enforceRateLimit({ uid: actor.uid, action: 'zokiResourceAccess', limit: 25, windowSeconds: 300 });
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  const nestedResourceRef = adminDb.doc(`schools/${input.schoolId}/${input.resourceType === 'file' ? 'files' : 'folders'}/${input.resourceId}`);
  const legacyResourceRef = adminDb.doc(`${input.resourceType === 'file' ? 'files' : 'folders'}_${input.schoolId}/${input.resourceId}`);
  const aclCollection = adminDb.collection(`schools/${input.schoolId}/resourceAcls`);
  const aclQuery = aclCollection.where('resourceType', '==', input.resourceType).where('resourceId', '==', input.resourceId);
  const deterministicAclRef = aclCollection.doc(`zoki_${stableId(input.schoolId, input.resourceType, input.resourceId, input.userId)}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const [receipt, nestedResource, legacyResource, targetSnapshot, aclSnapshot] = await Promise.all([
      transaction.get(receiptRef), transaction.get(nestedResourceRef), transaction.get(legacyResourceRef),
      transaction.get(target.ref), transaction.get(aclQuery),
    ]);
    if (receipt.exists) {
      const value = receipt.data();
      result = {
        userId: value.userId, resourceType: value.resourceType, resourceId: value.resourceId,
        operation: value.operation, accessLevel: value.accessLevel,
      };
      return;
    }
    const resourceSnapshot = nestedResource.exists ? nestedResource : legacyResource;
    if (!resourceSnapshot.exists || !targetSnapshot.exists) throw permissionDenied();
    const resource = resourceSnapshot.data();
    const targetData = targetSnapshot.data();
    const targetRole = targetData.rolesBySchool?.[input.schoolId] || targetData.role || '';
    if ((resource.schoolId && resource.schoolId !== input.schoolId)
      || !userInSchool(targetData, input.schoolId)
      || targetData.accountStatus === 'disabled' || targetData.status === 'archived'
      || ['principal', 'institution_manager', 'global_admin', 'platform_admin'].includes(targetRole)) {
      throw permissionDenied();
    }
    const matching = aclSnapshot.docs.filter(item => {
      const acl = item.data();
      return acl.principalType === 'user' && acl.principalId === input.userId;
    });
    const currentState = currentResourceAclState(matching.map(item => item.data()));
    if (currentState !== input.expectedDirectState) {
      throw publicError('aborted', 'resource-access-changed', 'הרשאות המשאב השתנו מאז ההצעה. יש לבדוק ולאשר מחדש.');
    }
    const requestedState = input.action === 'grant' ? `grant:${input.accessLevel}`
      : input.action === 'deny' ? 'deny' : 'none';
    if (currentState === requestedState || (input.action === 'remove' && currentState === 'none')) {
      throw publicError('failed-precondition', 'resource-access-already-applied', 'הרשאת המשאב כבר נמצאת במצב המבוקש.');
    }
    if (input.action === 'remove') {
      matching.filter(item => item.data().active !== false).forEach(item => transaction.update(item.ref, {
        active: false, revokedBy: actor.uid, revokedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      }));
    } else {
      const selected = matching.find(item => item.id === deterministicAclRef.id) || matching[0];
      const selectedRef = selected?.ref || deterministicAclRef;
      matching.filter(item => item.ref.path !== selectedRef.path && item.data().active !== false)
        .forEach(item => transaction.update(item.ref, {
          active: false, revokedBy: actor.uid, revokedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        }));
      transaction.set(selectedRef, {
        schoolId: input.schoolId, resourceType: input.resourceType, resourceId: input.resourceId,
        principalType: 'user', principalId: input.userId,
        accessLevel: input.action === 'deny' ? 'view' : input.accessLevel,
        explicitDeny: input.action === 'deny', inherit: true, expiresAt: null,
        active: true, grantedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
        ...(selected ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true });
    }
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'resource.access.change', requestId: input.requestId,
      userId: input.userId, resourceType: input.resourceType, resourceId: input.resourceId,
      operation: input.action, accessLevel: input.accessLevel, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = {
      userId: input.userId, staffName: targetData.fullName || targetData.displayName || targetData.name || '',
      resourceType: input.resourceType, resourceId: input.resourceId,
      resourceName: resource.name || resource.title || '', operation: input.action, accessLevel: input.accessLevel,
    };
  });

  if (executed) {
    await rebuildAclPolicy(input.schoolId, input.resourceType, input.resourceId);
    await writeAuditLog({
      actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
      action: `zoki.action.resourceAccess.${input.action}`,
      targetType: 'resourceAccess', targetId: `${input.resourceType}:${input.resourceId}`, targetUid: input.userId,
      schoolId: input.schoolId,
      metadata: { resourceType: input.resourceType, resourceId: input.resourceId, accessLevel: input.accessLevel },
    });
  }
  return {
    ok: true, executed, ...result,
    route: input.resourceType === 'file'
      ? `/files?file=${encodeURIComponent(input.resourceId)}`
      : `/files?folder=${encodeURIComponent(input.resourceId)}`,
  };
}

export async function executeZokiStudentTrackHandler(request) {
  const actor = await requireActor(request);
  const input = zokiStudentTrackActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiStudentTrack', limit: 20, windowSeconds: 300 });
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId });
  const studentRef = adminDb.doc(`schools/${input.schoolId}/students/${input.studentId}`);
  const trackRef = adminDb.doc(`schools/${input.schoolId}/tracks/${input.trackId}`);
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const [receipt, studentSnapshot, trackSnapshot] = await Promise.all([
      transaction.get(receiptRef), transaction.get(studentRef), transaction.get(trackRef),
    ]);
    if (receipt.exists) {
      const value = receipt.data();
      result = { studentId: value.studentId, trackId: value.trackId, operation: value.operation };
      return;
    }
    if (!studentSnapshot.exists || !trackSnapshot.exists) throw permissionDenied();
    const student = studentSnapshot.data();
    const track = trackSnapshot.data();
    if (student.schoolId !== input.schoolId || student.status !== 'active' || track.status === 'archived') {
      throw permissionDenied();
    }
    const modernPermission = evaluatePermission(permissionContext, {
      capability: 'students.managePrograms', accessLevel: 'edit', resource: { classId: student.classId },
    });
    const legacyPermission = evaluatePermission(permissionContext, {
      capability: 'students_manage_programs', accessLevel: 'edit', resource: { classId: student.classId },
    });
    if (!modernPermission.allowed && !legacyPermission.allowed) throw permissionDenied();
    const currentTrackIds = [...new Set(Array.isArray(student.trackIds) ? student.trackIds : [student.trackId].filter(Boolean))];
    const currentlyAssigned = currentTrackIds.includes(input.trackId);
    if (currentlyAssigned !== input.expectedCurrentlyAssigned) {
      throw publicError('aborted', 'student-tracks-changed', 'מגמות התלמיד השתנו מאז ההצעה. יש לבדוק ולאשר מחדש.');
    }
    if ((input.action === 'add' && currentlyAssigned) || (input.action === 'remove' && !currentlyAssigned)) {
      throw publicError('failed-precondition', 'student-track-already-applied', 'המגמה כבר נמצאת במצב המבוקש.');
    }
    const nextTrackIds = input.action === 'add'
      ? [...currentTrackIds, input.trackId]
      : currentTrackIds.filter(trackId => trackId !== input.trackId);
    const enrollmentId = typeof student.currentEnrollmentId === 'string' && student.currentEnrollmentId
      ? student.currentEnrollmentId
      : student.academicYearId ? `${input.studentId}__${student.academicYearId}` : '';
    const enrollmentRef = enrollmentId
      ? adminDb.doc(`schools/${input.schoolId}/studentEnrollments/${enrollmentId}`) : null;
    const enrollmentSnapshot = enrollmentRef ? await transaction.get(enrollmentRef) : null;
    if (enrollmentSnapshot?.exists && enrollmentSnapshot.data().studentId !== input.studentId) throw permissionDenied();
    transaction.update(studentRef, {
      trackIds: nextTrackIds, trackId: nextTrackIds[0] || '',
      updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
    });
    if (enrollmentSnapshot?.exists) transaction.update(enrollmentRef, {
      majorIds: nextTrackIds, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(studentRef.collection('history').doc(`zoki_${actionId}`), {
      type: input.action === 'add' ? 'track_added' : 'track_removed',
      schoolId: input.schoolId, studentId: input.studentId, trackId: input.trackId,
      createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: `student.track.${input.action}`,
      requestId: input.requestId, studentId: input.studentId, trackId: input.trackId,
      operation: input.action, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = {
      studentId: input.studentId, studentName: student.fullName || '', trackId: input.trackId,
      trackName: track.name || track.title || '', operation: input.action, trackIds: nextTrackIds,
    };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: `zoki.action.student.track.${input.action}`, targetType: 'student', targetId: input.studentId,
    schoolId: input.schoolId, metadata: { trackId: input.trackId },
  });
  return { ok: true, executed, ...result, route: `/students?student=${encodeURIComponent(input.studentId)}` };
}

export async function executeZokiAttendanceHandler(request) {
  const actor = await requireActor(request);
  const input = zokiAttendanceActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiAttendance', limit: 30, windowSeconds: 300 });
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId });
  const basePath = `schools/${input.schoolId}/files/${input.fileId}`;
  const fileRef = adminDb.doc(basePath);
  const studentRef = adminDb.doc(`schools/${input.schoolId}/students/${input.studentId}`);
  const memberRef = adminDb.doc(`${basePath}/attendanceMembers/${input.studentId}`);
  const dayRef = adminDb.doc(`${basePath}/attendanceDays/${input.dateKey}`);
  const statusRef = adminDb.doc(`${basePath}/attendanceLegend/${input.statusId}`);
  const recordId = `${input.studentId}__${input.dateKey}`;
  const recordRef = adminDb.doc(`${basePath}/attendanceRecords/${recordId}`);
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const historyRef = adminDb.doc(`${basePath}/attendanceHistory/zoki_${actionId}`);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const [receipt, fileSnapshot, studentSnapshot, memberSnapshot, daySnapshot, statusSnapshot, recordSnapshot] = await Promise.all([
      transaction.get(receiptRef), transaction.get(fileRef), transaction.get(studentRef), transaction.get(memberRef),
      transaction.get(dayRef), transaction.get(statusRef), transaction.get(recordRef),
    ]);
    if (receipt.exists) {
      const value = receipt.data();
      result = { fileId: value.fileId, studentId: value.studentId, dateKey: value.dateKey, statusId: value.statusId };
      return;
    }
    if (!fileSnapshot.exists || !studentSnapshot.exists || !memberSnapshot.exists || !daySnapshot.exists || !statusSnapshot.exists) {
      throw permissionDenied();
    }
    const file = fileSnapshot.data();
    const student = studentSnapshot.data();
    const member = memberSnapshot.data();
    const day = daySnapshot.data();
    const status = statusSnapshot.data();
    if (file.schoolId !== input.schoolId || file.fileType !== 'attendance' || file.status === 'archived'
      || file.setupStatus !== 'ready' || !file.classId || student.schoolId !== input.schoolId
      || student.classId !== file.classId || student.status === 'archived'
      || member.schoolId !== input.schoolId || member.fileId !== input.fileId
      || member.studentId !== input.studentId || member.classId !== file.classId || member.included === false
      || day.schoolId !== input.schoolId || day.fileId !== input.fileId
      || day.dateKey !== input.dateKey || day.blocked === true || day.scheduled === false
      || status.type !== 'status' || status.active === false || status.fileId !== input.fileId
      || status.schoolId !== input.schoolId) throw permissionDenied();
    const classRef = adminDb.doc(`schools/${input.schoolId}/classes/${file.classId}`);
    const classSnapshot = await transaction.get(classRef);
    if (!classSnapshot.exists) throw permissionDenied();
    const classData = classSnapshot.data();
    const modernPermission = evaluatePermission(permissionContext, {
      capability: 'attendance.edit', accessLevel: 'edit', resource: { classId: file.classId },
    });
    const legacyPermission = evaluatePermission(permissionContext, {
      capability: 'attendance_edit', accessLevel: 'edit', resource: { classId: file.classId },
    });
    const teachesClass = classData.schoolId === input.schoolId && classData.teacherId === actor.uid;
    if (!modernPermission.allowed && !legacyPermission.allowed && !teachesClass) throw permissionDenied();
    const previous = recordSnapshot.exists ? recordSnapshot.data() : null;
    if (previous && (previous.schoolId !== input.schoolId || previous.fileId !== input.fileId
      || previous.classId !== file.classId || previous.studentId !== input.studentId
      || previous.dateKey !== input.dateKey)) throw permissionDenied();
    const previousStatusId = previous?.primaryStatusId || '';
    if (previousStatusId !== input.expectedPreviousStatusId) {
      throw publicError('aborted', 'attendance-changed', 'הנוכחות השתנתה מאז ההצעה. יש לבדוק ולאשר מחדש.');
    }
    if (previousStatusId === input.statusId) {
      throw publicError('failed-precondition', 'attendance-already-applied', 'סטטוס הנוכחות כבר נמצא במצב המבוקש.');
    }
    const nextRecord = {
      schoolId: input.schoolId, fileId: input.fileId, classId: file.classId,
      studentId: input.studentId, dateKey: input.dateKey, primaryStatusId: input.statusId,
      actionIds: Array.isArray(previous?.actionIds) ? previous.actionIds : [],
      note: typeof previous?.note === 'string' ? previous.note : '',
      updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.set(recordRef, nextRecord);
    transaction.create(historyRef, {
      schoolId: input.schoolId, fileId: input.fileId, classId: file.classId, recordId,
      studentId: input.studentId, dateKey: input.dateKey,
      type: previous ? 'cell_updated' : 'cell_created',
      previous: previous ? {
        primaryStatusId: previousStatusId,
        actionIds: Array.isArray(previous.actionIds) ? previous.actionIds : [],
        note: typeof previous.note === 'string' ? previous.note : '',
      } : null,
      next: { primaryStatusId: input.statusId, actionIds: nextRecord.actionIds, note: nextRecord.note },
      createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'attendance.update', requestId: input.requestId,
      fileId: input.fileId, studentId: input.studentId, dateKey: input.dateKey, statusId: input.statusId,
      createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = {
      fileId: input.fileId, sheetName: file.name || '', studentId: input.studentId,
      studentName: student.fullName || student.name || member.displayName || '', dateKey: input.dateKey,
      statusId: input.statusId, statusLabel: status.label || status.shortCode || '',
    };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.attendance.update', targetType: 'attendanceRecord', targetId: `${input.fileId}_${recordId}`,
    schoolId: input.schoolId, metadata: { fileId: input.fileId, studentId: input.studentId, dateKey: input.dateKey },
  });
  return { ok: true, executed, ...result, route: `/files?file=${encodeURIComponent(input.fileId)}` };
}

export async function executeZokiStudentNoteHandler(request) {
  const actor = await requireActor(request);
  const input = zokiStudentNoteActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiStudentNote', limit: 30, windowSeconds: 300 });
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId });
  const studentRef = adminDb.doc(`schools/${input.schoolId}/students/${input.studentId}`);
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const noteId = `zoki_${actionId}`;
  const noteRef = studentRef.collection('notes').doc(noteId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const [receipt, studentSnapshot] = await Promise.all([
      transaction.get(receiptRef), transaction.get(studentRef),
    ]);
    if (receipt.exists) {
      const value = receipt.data();
      result = { studentId: value.studentId, noteId: value.noteId };
      return;
    }
    if (!studentSnapshot.exists) throw permissionDenied();
    const student = studentSnapshot.data();
    if (student.schoolId !== input.schoolId || student.status === 'archived' || !student.classId) throw permissionDenied();
    if (student.classId !== input.expectedClassId) {
      throw publicError('aborted', 'student-class-changed', 'שיוך התלמיד השתנה מאז ההצעה. יש לבדוק ולאשר מחדש.');
    }
    const classRef = adminDb.doc(`schools/${input.schoolId}/classes/${student.classId}`);
    const classSnapshot = await transaction.get(classRef);
    if (!classSnapshot.exists || classSnapshot.data().schoolId !== input.schoolId) throw permissionDenied();
    const classData = classSnapshot.data();
    const modernAdd = evaluatePermission(permissionContext, {
      capability: 'students.addNotes', accessLevel: 'edit', resource: { classId: student.classId },
    });
    const legacyAdd = evaluatePermission(permissionContext, {
      capability: 'students_add_notes', accessLevel: 'edit', resource: { classId: student.classId },
    });
    const modernView = evaluatePermission(permissionContext, {
      capability: 'students.view', accessLevel: 'view', resource: { classId: student.classId },
    });
    const legacyView = evaluatePermission(permissionContext, {
      capability: 'students_view', accessLevel: 'view', resource: { classId: student.classId },
    });
    const assignedToClass = classData.teacherId === actor.uid
      || (Array.isArray(classData.staffIds) && classData.staffIds.includes(actor.uid));
    if ((!modernAdd.allowed && !legacyAdd.allowed) || (!modernView.allowed && !legacyView.allowed && !assignedToClass)) {
      throw permissionDenied();
    }
    transaction.create(noteRef, {
      schoolId: input.schoolId, studentId: input.studentId, content: input.content,
      type: input.type, visibility: input.visibility,
      createdBy: actor.uid, createdByName: actor.data.fullName || actor.data.displayName || '',
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), editHistory: [],
    });
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'student.note.create', requestId: input.requestId,
      studentId: input.studentId, noteId, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = {
      studentId: input.studentId, studentName: student.fullName || student.name || '',
      noteId, className: student.className || classData.name || '',
      type: input.type, visibility: input.visibility,
    };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.student.note.create', targetType: 'studentNote', targetId: noteId,
    schoolId: input.schoolId, metadata: { studentId: input.studentId, noteId },
  });
  return { ok: true, executed, ...result, route: `/students?student=${encodeURIComponent(input.studentId)}` };
}

export async function executeZokiCalendarEventHandler(request) {
  const actor = await requireActor(request);
  const input = zokiCalendarEventActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  const { year, month } = calendarDateParts(input.date);
  await enforceRateLimit({ uid: actor.uid, action: 'zokiCalendarEvent', limit: 20, windowSeconds: 300 });
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId });
  const createPermission = evaluatePermission(permissionContext, { capability: 'calendar.create', accessLevel: 'edit', resource: {} });
  const editPermission = evaluatePermission(permissionContext, { capability: 'calendar.edit', accessLevel: 'edit', resource: {} });
  const legacyEditPermission = evaluatePermission(permissionContext, { capability: 'calendar_edit', accessLevel: 'edit', resource: {} });
  if (!createPermission.allowed && !editPermission.allowed && !legacyEditPermission.allowed) throw permissionDenied();
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const eventId = `zoki_${actionId}`;
  const nestedEventRef = adminDb.doc(`schools/${input.schoolId}/events/${eventId}`);
  const legacyEventRef = adminDb.doc(`events_${input.schoolId}/${eventId}`);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) {
      const value = receipt.data();
      result = { eventId: value.eventId, date: value.date };
      return;
    }
    const [nestedCategories, legacyCategories] = await Promise.all([
      transaction.get(adminDb.collection(`schools/${input.schoolId}/categories`)),
      transaction.get(adminDb.collection(`categories_${input.schoolId}`)),
    ]);
    const categoryNames = new Set([...nestedCategories.docs, ...legacyCategories.docs]
      .map(item => String(item.data().name || item.data().title || '').trim()).filter(Boolean));
    if (categoryNames.size === 0) categoryNames.add('כללי');
    if (!categoryNames.has(input.category)) {
      throw publicError('failed-precondition', 'calendar-category-changed', 'קטגוריית האירוע השתנתה. יש לבקש מזוקי הצעה חדשה.');
    }
    const referencedTeamIds = [...new Set([
      ...(Array.isArray(input.visibleTo) ? input.visibleTo : []), ...input.editableBy,
    ])];
    if (referencedTeamIds.length) {
      const snapshots = await Promise.all(referencedTeamIds.flatMap(teamId => [
        transaction.get(adminDb.doc(`schools/${input.schoolId}/teams/${teamId}`)),
        transaction.get(adminDb.doc(`teams_${input.schoolId}/${teamId}`)),
      ]));
      referencedTeamIds.forEach((teamId, index) => {
        const nested = snapshots[index * 2];
        const legacy = snapshots[(index * 2) + 1];
        const snapshot = nested.exists ? nested : legacy;
        const data = snapshot.exists ? snapshot.data() : null;
        if (!snapshot.exists || data.status === 'archived' || (data.schoolId && data.schoolId !== input.schoolId)) {
          throw publicError('failed-precondition', 'calendar-team-changed', 'אחד הצוותים שנבחרו אינו זמין עוד. יש לבקש מזוקי הצעה חדשה.');
        }
      });
    }
    const event = {
      schoolId: input.schoolId, title: input.title, description: input.description,
      date: input.date, time: input.time, category: input.category, color: input.color,
      visibleTo: input.visibleTo, editableBy: input.editableBy, year, month,
      source: 'zoki', createdBy: actor.uid, updatedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.create(nestedEventRef, event);
    transaction.create(legacyEventRef, event);
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'calendar.event.create', requestId: input.requestId,
      eventId, date: input.date, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = { eventId, title: input.title, date: input.date, time: input.time, category: input.category };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.calendar.event.create', targetType: 'calendarEvent', targetId: eventId,
    schoolId: input.schoolId, metadata: { eventId, date: input.date },
  });
  return { ok: true, executed, ...result, route: `/calendar?year=${year}&month=${month}` };
}

export async function executeZokiResourceRenameHandler(request) {
  const actor = await requireActor(request);
  const input = zokiResourceRenameActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiResourceRename', limit: 30, windowSeconds: 300 });
  const collectionName = input.resourceType === 'file' ? 'files' : 'folders';
  const nestedRef = adminDb.doc(`schools/${input.schoolId}/${collectionName}/${input.resourceId}`);
  const legacyRef = adminDb.doc(`${collectionName}_${input.schoolId}/${input.resourceId}`);
  const [nestedBefore, legacyBefore] = await adminDb.getAll(nestedRef, legacyRef);
  const before = legacyBefore.exists ? legacyBefore : nestedBefore;
  if (!before.exists) throw permissionDenied();
  const beforeData = before.data();
  const permissionContext = await withResourcePermissionContext(
    await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId }),
    { resourceType: input.resourceType, resourceId: input.resourceId, parentIds: [beforeData.folderId].filter(Boolean) },
  );
  const editPermission = evaluatePermission(permissionContext, {
    capability: 'files.edit', accessLevel: 'edit', resourceType: input.resourceType,
    resourceId: input.resourceId, resource: {
      resourceType: input.resourceType, resourceId: input.resourceId,
      parentIds: [beforeData.folderId].filter(Boolean), classId: beforeData.classId,
    },
  });
  if (!editPermission.allowed) throw permissionDenied();
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const [receipt, nested, legacy] = await Promise.all([
      transaction.get(receiptRef), transaction.get(nestedRef), transaction.get(legacyRef),
    ]);
    if (receipt.exists) {
      result = { resourceType: receipt.data().resourceType, resourceId: receipt.data().resourceId };
      return;
    }
    const current = legacy.exists ? legacy : nested;
    const currentData = current.exists ? current.data() : null;
    if (!current.exists || currentData.trashedAt || String(currentData.name || currentData.title || '') !== input.expectedName) {
      throw publicError('failed-precondition', 'resource-changed', 'הפריט השתנה מאז ההצעה. יש לבקש מזוקי לבדוק מחדש.');
    }
    const patch = { name: input.newName, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() };
    if (nested.exists) transaction.update(nestedRef, patch);
    if (legacy.exists) transaction.update(legacyRef, patch);
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'resource.rename', requestId: input.requestId,
      resourceType: input.resourceType, resourceId: input.resourceId, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = { resourceType: input.resourceType, resourceId: input.resourceId, name: input.newName };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.resource.rename', targetType: input.resourceType, targetId: input.resourceId,
    schoolId: input.schoolId, metadata: { resourceType: input.resourceType, resourceId: input.resourceId },
  });
  const queryKey = input.resourceType === 'file' ? 'file' : 'folder';
  return { ok: true, executed, ...result, route: `/files?${queryKey}=${encodeURIComponent(input.resourceId)}` };
}

export async function executeZokiResourceMoveHandler(request) {
  const actor = await requireActor(request);
  const input = zokiResourceMoveActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiResourceMove', limit: 30, windowSeconds: 300 });
  const nestedFileRef = adminDb.doc(`schools/${input.schoolId}/files/${input.fileId}`);
  const legacyFileRef = adminDb.doc(`files_${input.schoolId}/${input.fileId}`);
  const nestedFolderRef = adminDb.doc(`schools/${input.schoolId}/folders/${input.targetFolderId}`);
  const legacyFolderRef = adminDb.doc(`folders_${input.schoolId}/${input.targetFolderId}`);
  const [nestedFile, legacyFile, nestedFolder, legacyFolder] = await adminDb.getAll(
    nestedFileRef, legacyFileRef, nestedFolderRef, legacyFolderRef,
  );
  const file = legacyFile.exists ? legacyFile : nestedFile;
  const folder = legacyFolder.exists ? legacyFolder : nestedFolder;
  if (!file.exists || !folder.exists || file.data().trashedAt || folder.data().trashedAt) throw permissionDenied();
  let permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId });
  permissionContext = await withResourcePermissionContext(permissionContext, {
    resourceType: 'file', resourceId: input.fileId, parentIds: [file.data().folderId].filter(Boolean),
  });
  const fileEdit = evaluatePermission(permissionContext, {
    capability: 'files.edit', accessLevel: 'edit', resourceType: 'file', resourceId: input.fileId,
    resource: { resourceType: 'file', resourceId: input.fileId, parentIds: [file.data().folderId].filter(Boolean), classId: file.data().classId },
  });
  const folderContext = await withResourcePermissionContext(
    await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId }),
    { resourceType: 'folder', resourceId: input.targetFolderId },
  );
  const folderEdit = evaluatePermission(folderContext, {
    capability: 'files.edit', accessLevel: 'edit', resourceType: 'folder', resourceId: input.targetFolderId,
    resource: { resourceType: 'folder', resourceId: input.targetFolderId, classId: folder.data().classId },
  });
  if (!fileEdit.allowed || !folderEdit.allowed) throw permissionDenied();
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const nestedDuplicatesQuery = adminDb.collection(`schools/${input.schoolId}/files`)
      .where('name', '==', input.expectedName).where('folderId', '==', input.targetFolderId).limit(10);
    const legacyDuplicatesQuery = adminDb.collection(`files_${input.schoolId}`)
      .where('name', '==', input.expectedName).where('folderId', '==', input.targetFolderId).limit(10);
    const [receipt, currentNestedFile, currentLegacyFile, currentNestedFolder, currentLegacyFolder, nestedDuplicates, legacyDuplicates] = await Promise.all([
      transaction.get(receiptRef), transaction.get(nestedFileRef), transaction.get(legacyFileRef),
      transaction.get(nestedFolderRef), transaction.get(legacyFolderRef),
      transaction.get(nestedDuplicatesQuery), transaction.get(legacyDuplicatesQuery),
    ]);
    if (receipt.exists) {
      result = { fileId: receipt.data().resourceId, targetFolderId: receipt.data().targetFolderId };
      return;
    }
    const currentFile = currentLegacyFile.exists ? currentLegacyFile : currentNestedFile;
    const currentFolder = currentLegacyFolder.exists ? currentLegacyFolder : currentNestedFolder;
    const data = currentFile.exists ? currentFile.data() : null;
    if (!currentFile.exists || data.trashedAt || String(data.name || '') !== input.expectedName
      || String(data.folderId || '') !== input.expectedFolderId) {
      throw publicError('failed-precondition', 'resource-changed', 'הקובץ השתנה מאז ההצעה. יש לבקש מזוקי לבדוק מחדש.');
    }
    if (!currentFolder.exists || currentFolder.data().trashedAt) {
      throw publicError('failed-precondition', 'resource-folder-changed', 'תיקיית היעד השתנתה. יש לבקש מזוקי לבדוק מחדש.');
    }
    if ([...nestedDuplicates.docs, ...legacyDuplicates.docs]
      .some(item => item.id !== input.fileId && !item.data().trashedAt)) {
      throw publicError('already-exists', 'resource-name-exists', 'כבר קיים קובץ פעיל בשם הזה בתיקיית היעד.');
    }
    const patch = { folderId: input.targetFolderId, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() };
    if (currentNestedFile.exists) transaction.update(nestedFileRef, patch);
    if (currentLegacyFile.exists) transaction.update(legacyFileRef, patch);
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'resource.move', requestId: input.requestId,
      resourceType: 'file', resourceId: input.fileId, targetFolderId: input.targetFolderId,
      createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = { fileId: input.fileId, targetFolderId: input.targetFolderId };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.resource.move', targetType: 'file', targetId: input.fileId,
    schoolId: input.schoolId, metadata: { resourceType: 'file', resourceId: input.fileId, targetFolderId: input.targetFolderId },
  });
  return { ok: true, executed, ...result, route: `/files?openFile=${encodeURIComponent(input.fileId)}` };
}

export async function executeZokiResourceCreateHandler(request) {
  const actor = await requireActor(request);
  const input = zokiResourceCreateActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiResourceCreate', limit: 30, windowSeconds: 300 });
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId });
  const modernCreate = evaluatePermission(permissionContext, { capability: 'files.create', accessLevel: 'edit', resource: {} });
  const legacyCreate = evaluatePermission(permissionContext, { capability: 'files_upload', accessLevel: 'edit', resource: {} });
  if (!modernCreate.allowed && !legacyCreate.allowed) throw permissionDenied();
  const folderNestedRef = input.folderId ? adminDb.doc(`schools/${input.schoolId}/folders/${input.folderId}`) : null;
  const folderLegacyRef = input.folderId ? adminDb.doc(`folders_${input.schoolId}/${input.folderId}`) : null;
  if (input.folderId) {
    const [folderNested, folderLegacy] = await adminDb.getAll(folderNestedRef, folderLegacyRef);
    const folder = folderLegacy.exists ? folderLegacy : folderNested;
    if (!folder.exists || folder.data().trashedAt) throw permissionDenied();
    const folderContext = await withResourcePermissionContext(permissionContext, {
      resourceType: 'folder', resourceId: input.folderId,
    });
    const folderView = evaluatePermission(folderContext, {
      capability: 'files.view', accessLevel: 'view', resourceType: 'folder', resourceId: input.folderId,
      resource: { resourceType: 'folder', resourceId: input.folderId, classId: folder.data().classId },
    });
    const legacyFolderView = evaluatePermission(folderContext, {
      capability: 'files_view', accessLevel: 'view', resourceType: 'folder', resourceId: input.folderId,
      resource: { resourceType: 'folder', resourceId: input.folderId, classId: folder.data().classId },
    });
    if (!folderView.allowed && !legacyFolderView.allowed) throw permissionDenied();
  }
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const resourceId = `zoki_${actionId}`;
  const collectionName = input.kind === 'folder' ? 'folders' : 'files';
  const nestedRef = adminDb.doc(`schools/${input.schoolId}/${collectionName}/${resourceId}`);
  const legacyRef = adminDb.doc(`${collectionName}_${input.schoolId}/${resourceId}`);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const nestedCollection = adminDb.collection(`schools/${input.schoolId}/${collectionName}`);
    const legacyCollection = adminDb.collection(`${collectionName}_${input.schoolId}`);
    const duplicateQuery = collection => {
      let query = collection.where('name', '==', input.name).limit(10);
      if (input.kind !== 'folder') query = query.where('folderId', '==', input.folderId);
      return query;
    };
    const reads = [
      transaction.get(receiptRef),
      transaction.get(duplicateQuery(nestedCollection)),
      transaction.get(duplicateQuery(legacyCollection)),
      ...(input.folderId ? [transaction.get(folderNestedRef), transaction.get(folderLegacyRef)] : []),
    ];
    const [receipt, nestedDuplicates, legacyDuplicates, folderNested, folderLegacy] = await Promise.all(reads);
    if (receipt.exists) {
      const value = receipt.data();
      result = { resourceType: value.resourceType, resourceId: value.resourceId };
      return;
    }
    if ([...nestedDuplicates.docs, ...legacyDuplicates.docs].some(item => !item.data().trashedAt)) {
      throw publicError('already-exists', 'resource-name-exists', 'כבר קיים פריט פעיל בשם הזה במיקום שנבחר.');
    }
    if (input.folderId) {
      const folder = folderLegacy?.exists ? folderLegacy : folderNested;
      if (!folder?.exists || folder.data().trashedAt) {
        throw publicError('failed-precondition', 'resource-folder-changed', 'תיקיית היעד השתנתה. יש לבקש מזוקי לבדוק מחדש.');
      }
    }
    const common = {
      schoolId: input.schoolId, name: input.name, source: 'zoki',
      createdBy: actor.uid, createdByName: actor.data.fullName || actor.data.displayName || '',
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    };
    const data = input.kind === 'folder' ? {
      ...common, visibility: input.visibility, allowedUsers: [], allowCreate: [],
    } : {
      ...common, folderId: input.folderId, fileType: input.kind, size: 0,
      type: input.kind === 'spreadsheet' ? 'application/x-spreadsheet' : 'text/html',
      content: input.kind === 'spreadsheet'
        ? JSON.stringify({ columns: 5, rows: 10, cells: {}, headers: {}, columnWidths: {}, rowHeights: {} })
        : '<p></p>',
    };
    transaction.create(nestedRef, data);
    transaction.create(legacyRef, data);
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'resource.create', requestId: input.requestId,
      resourceType: input.kind === 'folder' ? 'folder' : 'file', resourceId, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = { resourceType: input.kind === 'folder' ? 'folder' : 'file', resourceId, kind: input.kind };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.resource.create', targetType: result.resourceType, targetId: resourceId,
    schoolId: input.schoolId, metadata: { resourceType: result.resourceType, resourceId, kind: input.kind },
  });
  const queryKey = result.resourceType === 'file' ? 'openFile' : 'folder';
  return { ok: true, executed, ...result, route: `/files?${queryKey}=${encodeURIComponent(result.resourceId)}` };
}

async function requireCalendarEdit(actor, schoolId) {
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId });
  const editPermission = evaluatePermission(permissionContext, { capability: 'calendar.edit', accessLevel: 'edit', resource: {} });
  const legacyEditPermission = evaluatePermission(permissionContext, { capability: 'calendar_edit', accessLevel: 'edit', resource: {} });
  if (!editPermission.allowed && !legacyEditPermission.allowed) throw permissionDenied();
}

async function validateCalendarSelections(transaction, input) {
  const [nestedCategories, legacyCategories] = await Promise.all([
    transaction.get(adminDb.collection(`schools/${input.schoolId}/categories`)),
    transaction.get(adminDb.collection(`categories_${input.schoolId}`)),
  ]);
  const categoryNames = new Set([...nestedCategories.docs, ...legacyCategories.docs]
    .map(item => String(item.data().name || item.data().title || '').trim()).filter(Boolean));
  if (categoryNames.size === 0) categoryNames.add('כללי');
  if (!categoryNames.has(input.category)) {
    throw publicError('failed-precondition', 'calendar-category-changed', 'קטגוריית האירוע השתנתה. יש לבקש מזוקי הצעה חדשה.');
  }
  const referencedTeamIds = [...new Set([
    ...(Array.isArray(input.visibleTo) ? input.visibleTo : []), ...input.editableBy,
  ])];
  if (!referencedTeamIds.length) return;
  const snapshots = await Promise.all(referencedTeamIds.flatMap(teamId => [
    transaction.get(adminDb.doc(`schools/${input.schoolId}/teams/${teamId}`)),
    transaction.get(adminDb.doc(`teams_${input.schoolId}/${teamId}`)),
  ]));
  referencedTeamIds.forEach((teamId, index) => {
    const nested = snapshots[index * 2];
    const legacy = snapshots[(index * 2) + 1];
    const snapshot = nested.exists ? nested : legacy;
    const data = snapshot.exists ? snapshot.data() : null;
    if (!snapshot.exists || data.status === 'archived' || (data.schoolId && data.schoolId !== input.schoolId)) {
      throw publicError('failed-precondition', 'calendar-team-changed', 'אחד הצוותים שנבחרו אינו זמין עוד. יש לבקש מזוקי הצעה חדשה.');
    }
  });
}

export async function executeZokiCalendarEventUpdateHandler(request) {
  const actor = await requireActor(request);
  const input = zokiCalendarEventUpdateActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  const { year, month } = calendarDateParts(input.date);
  await enforceRateLimit({ uid: actor.uid, action: 'zokiCalendarEventUpdate', limit: 20, windowSeconds: 300 });
  await requireCalendarEdit(actor, input.schoolId);
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const nestedRef = adminDb.doc(`schools/${input.schoolId}/events/${input.eventId}`);
  const legacyRef = adminDb.doc(`events_${input.schoolId}/${input.eventId}`);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const [receipt, nested, legacy] = await Promise.all([
      transaction.get(receiptRef), transaction.get(nestedRef), transaction.get(legacyRef),
    ]);
    if (receipt.exists) {
      const value = receipt.data();
      result = { eventId: value.eventId, date: value.date };
      return;
    }
    const current = legacy.exists ? legacy : nested;
    if (!current.exists || calendarEventVersion(current.data(), input.eventId) !== input.expectedVersion) {
      throw publicError('failed-precondition', 'calendar-event-changed', 'האירוע השתנה מאז ההצעה. יש לבקש מזוקי לבדוק מחדש.');
    }
    await validateCalendarSelections(transaction, input);
    const update = {
      title: input.title, description: input.description, date: input.date, time: input.time,
      category: input.category, color: input.color, visibleTo: input.visibleTo, editableBy: input.editableBy,
      year, month, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
    };
    if (nested.exists) transaction.update(nestedRef, update);
    if (legacy.exists) transaction.update(legacyRef, update);
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'calendar.event.update', requestId: input.requestId,
      eventId: input.eventId, date: input.date, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = { eventId: input.eventId, date: input.date, time: input.time, category: input.category };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.calendar.event.update', targetType: 'calendarEvent', targetId: input.eventId,
    schoolId: input.schoolId, metadata: { eventId: input.eventId, date: input.date },
  });
  return { ok: true, executed, ...result, route: `/calendar?year=${year}&month=${month}` };
}

export async function executeZokiCalendarEventCancelHandler(request) {
  const actor = await requireActor(request);
  const input = zokiCalendarEventCancelActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiCalendarEventCancel', limit: 12, windowSeconds: 300 });
  await requireCalendarEdit(actor, input.schoolId);
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const nestedRef = adminDb.doc(`schools/${input.schoolId}/events/${input.eventId}`);
  const legacyRef = adminDb.doc(`events_${input.schoolId}/${input.eventId}`);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const [receipt, nested, legacy] = await Promise.all([
      transaction.get(receiptRef), transaction.get(nestedRef), transaction.get(legacyRef),
    ]);
    if (receipt.exists) {
      result = { eventId: receipt.data().eventId };
      return;
    }
    const current = legacy.exists ? legacy : nested;
    if (!current.exists || calendarEventVersion(current.data(), input.eventId) !== input.expectedVersion) {
      throw publicError('failed-precondition', 'calendar-event-changed', 'האירוע השתנה מאז ההצעה. יש לבקש מזוקי לבדוק מחדש.');
    }
    if (nested.exists) transaction.delete(nestedRef);
    if (legacy.exists) transaction.delete(legacyRef);
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'calendar.event.cancel', requestId: input.requestId,
      eventId: input.eventId, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = { eventId: input.eventId };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.calendar.event.cancel', targetType: 'calendarEvent', targetId: input.eventId,
    schoolId: input.schoolId, metadata: { eventId: input.eventId },
  });
  return { ok: true, executed, ...result, route: '/calendar' };
}

const CONTACT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function normalizeContactEmail(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/gu, '');
}

export async function executeZokiContactHandler(request) {
  const actor = await requireActor(request);
  const input = zokiContactActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiContact', limit: 20, windowSeconds: 300 });
  if (input.scope === 'institutional') {
    const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId });
    const permission = evaluatePermission(permissionContext, { capability: 'contacts.create', accessLevel: 'edit', resource: {} });
    if (!permission.allowed) throw permissionDenied();
  }
  const normalizedEmails = [...new Set([input.primaryEmail, ...input.additionalEmails]
    .map(normalizeContactEmail).filter(email => CONTACT_EMAIL_PATTERN.test(email)))];
  if (!normalizedEmails.length) throw publicError('invalid-argument', 'invalid-contact-email', 'כתובת הדוא״ל אינה תקינה.');
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const contactId = `zoki_${actionId}`;
  const collectionPath = input.scope === 'private'
    ? `users/${actor.uid}/contactDirectory/private/items`
    : `schools/${input.schoolId}/contactDirectory/institutional/items`;
  const contactRef = adminDb.doc(`${collectionPath}/${contactId}`);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) {
      const value = receipt.data();
      result = { contactId: value.contactId, scope: value.scope };
      return;
    }
    const duplicateQuery = adminDb.collection(collectionPath)
      .where('normalizedEmails', 'array-contains-any', normalizedEmails.slice(0, 10));
    const [duplicateSnapshot, ...ownerSnapshots] = await Promise.all([
      transaction.get(duplicateQuery),
      ...input.ownerStaffIds.map(userId => transaction.get(adminDb.doc(`users/${userId}`))),
    ]);
    if (duplicateSnapshot.docs.some(item => item.data().archived !== true)) {
      throw publicError('already-exists', 'duplicate-contact', 'כבר קיים איש קשר פעיל עם אחת מכתובות הדוא״ל האלה.');
    }
    ownerSnapshots.forEach(snapshot => {
      const user = snapshot.exists ? snapshot.data() : null;
      const schoolIds = new Set(Array.isArray(user?.schoolIds) ? user.schoolIds : [user?.schoolId].filter(Boolean));
      if (!snapshot.exists || !schoolIds.has(input.schoolId) || user.accountStatus === 'disabled' || user.status === 'archived') {
        throw publicError('failed-precondition', 'contact-staff-changed', 'אחד מאנשי הצוות האחראים אינו זמין עוד. יש לבקש מזוקי הצעה חדשה.');
      }
    });
    const contact = {
      scope: input.scope, schoolId: input.schoolId, fullName: input.fullName,
      organization: input.organization, jobTitle: input.jobTitle,
      primaryEmail: normalizedEmails[0], additionalEmails: normalizedEmails.slice(1), normalizedEmails,
      phone: input.phone, category: input.category, tags: input.tags, notes: input.notes,
      archived: false, schemaVersion: 1, createdBy: actor.uid, updatedBy: actor.uid,
      archivedBy: '', archivedAt: null, mergedIntoId: '', mergedFromIds: [],
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      ...(input.scope === 'private'
        ? { ownerId: actor.uid }
        : { ownerStaffIds: input.ownerStaffIds, visibility: input.visibility, linkedStaffId: '' }),
    };
    transaction.create(contactRef, contact);
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'contact.create', requestId: input.requestId,
      contactId, scope: input.scope, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = { contactId, scope: input.scope, fullName: input.fullName };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.contact.create', targetType: 'contact', targetId: contactId,
    schoolId: input.schoolId, metadata: { contactId, scope: input.scope },
  });
  return { ok: true, executed, ...result, route: `/contacts?scope=${encodeURIComponent(input.scope)}` };
}

function userInSchool(user, schoolId) {
  return user?.schoolId === schoolId || (Array.isArray(user?.schoolIds) && user.schoolIds.includes(schoolId));
}

export async function executeZokiTeamMembershipHandler(request) {
  const actor = await requireActor(request);
  const input = zokiTeamMembershipActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  const target = await requireTargetInSchool(actor, input.userId, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'zokiTeamMembership', limit: 30, windowSeconds: 300 });
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId });
  const editPermission = evaluatePermission(permissionContext, { capability: 'teams_edit', accessLevel: 'edit', resource: {} });
  const canManageAll = actor.globalAdmin || isPrincipalFor(actor, input.schoolId) || editPermission.allowed;
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  const nestedTeamRef = adminDb.doc(`schools/${input.schoolId}/teams/${input.teamId}`);
  const legacyTeamRef = adminDb.doc(`teams_${input.schoolId}/${input.teamId}`);
  const notificationRef = adminDb.doc(`notifications/zoki_team_${actionId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const [receipt, nestedTeam, legacyTeam, targetSnapshot] = await Promise.all([
      transaction.get(receiptRef), transaction.get(nestedTeamRef), transaction.get(legacyTeamRef), transaction.get(target.ref),
    ]);
    const teamSnapshot = legacyTeam.exists ? legacyTeam : nestedTeam;
    if (!teamSnapshot.exists || !targetSnapshot.exists) throw permissionDenied();
    const team = teamSnapshot.data();
    const targetData = targetSnapshot.data();
    if ((team.schoolId && team.schoolId !== input.schoolId) || !userInSchool(targetData, input.schoolId)
      || targetData.accountStatus === 'disabled' || targetData.status === 'archived') throw permissionDenied();
    const managerIds = Array.isArray(team.managerIds) ? team.managerIds : (Array.isArray(team.leaderIds) ? team.leaderIds : []);
    if (!canManageAll && !managerIds.includes(actor.uid)) throw permissionDenied();
    if (receipt.exists) {
      const value = receipt.data();
      result = { teamId: value.teamId, userId: value.userId, operation: value.operation };
      return;
    }
    const memberIds = Array.isArray(team.memberIds) ? team.memberIds : [];
    const currentlyMember = memberIds.includes(input.userId);
    if (currentlyMember !== input.expectedCurrentlyMember) {
      throw publicError('aborted', 'team-membership-changed', 'חברות איש הצוות בצוות השתנתה מאז ההצעה. יש לבדוק ולאשר מחדש.');
    }
    const add = input.action === 'add';
    if (add === currentlyMember) {
      throw publicError('failed-precondition', 'team-membership-already-applied', 'חברות איש הצוות כבר נמצאת במצב המבוקש.');
    }
    const teamUpdate = {
      memberIds: add ? FieldValue.arrayUnion(input.userId) : FieldValue.arrayRemove(input.userId),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (legacyTeam.exists) transaction.update(legacyTeamRef, teamUpdate);
    if (nestedTeam.exists) transaction.update(nestedTeamRef, teamUpdate);
    transaction.update(target.ref, {
      teamIds: add ? FieldValue.arrayUnion(input.teamId) : FieldValue.arrayRemove(input.teamId),
      [`teamIdsBySchool.${input.schoolId}`]: add
        ? FieldValue.arrayUnion(input.teamId) : FieldValue.arrayRemove(input.teamId),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (add) transaction.create(notificationRef, {
      userId: input.userId, schoolId: input.schoolId,
      title: `הוספת לצוות "${String(team.name || team.title || '').slice(0, 120)}"`,
      body: `${String(actor.data.fullName || actor.data.displayName || 'מנהל הצוות').slice(0, 120)} הוסיף/ה אותך לצוות`,
      type: 'staff', link: '/teams', read: false, createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'team.membership.change', requestId: input.requestId,
      teamId: input.teamId, userId: input.userId, operation: input.action, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = {
      teamId: input.teamId, teamName: team.name || team.title || '', userId: input.userId,
      staffName: targetData.fullName || targetData.displayName || targetData.name || '', operation: input.action,
    };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: input.action === 'add' ? 'zoki.action.team.member.add' : 'zoki.action.team.member.remove',
    targetType: 'teamMembership', targetId: `${input.teamId}:${input.userId}`, targetUid: input.userId,
    schoolId: input.schoolId, metadata: { teamId: input.teamId, userId: input.userId },
  });
  return { ok: true, executed, ...result, route: '/teams' };
}

export async function executeZokiTeamManagerHandler(request) {
  const actor = await requireActor(request);
  const input = zokiTeamManagerActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  const target = await requireTargetInSchool(actor, input.userId, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'zokiTeamManager', limit: 20, windowSeconds: 300 });
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId });
  const editPermission = evaluatePermission(permissionContext, { capability: 'teams_edit', accessLevel: 'edit', resource: {} });
  const canManageAll = actor.globalAdmin || isPrincipalFor(actor, input.schoolId) || editPermission.allowed;
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  const nestedTeamRef = adminDb.doc(`schools/${input.schoolId}/teams/${input.teamId}`);
  const legacyTeamRef = adminDb.doc(`teams_${input.schoolId}/${input.teamId}`);
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const [receipt, nestedTeam, legacyTeam, targetSnapshot] = await Promise.all([
      transaction.get(receiptRef), transaction.get(nestedTeamRef), transaction.get(legacyTeamRef), transaction.get(target.ref),
    ]);
    const teamSnapshot = legacyTeam.exists ? legacyTeam : nestedTeam;
    if (!teamSnapshot.exists || !targetSnapshot.exists) throw permissionDenied();
    const team = teamSnapshot.data();
    const targetData = targetSnapshot.data();
    if ((team.schoolId && team.schoolId !== input.schoolId) || !userInSchool(targetData, input.schoolId)
      || targetData.accountStatus === 'disabled' || targetData.status === 'archived') throw permissionDenied();
    const managerIds = Array.isArray(team.managerIds) ? team.managerIds : (Array.isArray(team.leaderIds) ? team.leaderIds : []);
    if (!canManageAll && !managerIds.includes(actor.uid)) throw permissionDenied();
    if (receipt.exists) {
      const value = receipt.data();
      result = { teamId: value.teamId, userId: value.userId, operation: value.operation };
      return;
    }
    const memberIds = Array.isArray(team.memberIds) ? team.memberIds : [];
    if (!memberIds.includes(input.userId)) {
      throw publicError('failed-precondition', 'team-manager-not-member', 'ניתן למנות למנהל צוות רק חבר קיים בצוות.');
    }
    const currentlyManager = managerIds.includes(input.userId);
    if (currentlyManager !== input.expectedCurrentlyManager) {
      throw publicError('aborted', 'team-managers-changed', 'מנהלי הצוות השתנו מאז ההצעה. יש לבדוק ולאשר מחדש.');
    }
    const assign = input.action === 'assign';
    if (assign === currentlyManager) {
      throw publicError('failed-precondition', 'team-manager-already-applied', 'מנהל הצוות כבר נמצא במצב המבוקש.');
    }
    if (!assign && managerIds.length <= 1) {
      throw publicError('failed-precondition', 'team-last-manager', 'לא ניתן להסיר את המנהל האחרון של הצוות.');
    }
    const teamUpdate = {
      managerIds: assign ? FieldValue.arrayUnion(input.userId) : FieldValue.arrayRemove(input.userId),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (legacyTeam.exists) transaction.update(legacyTeamRef, teamUpdate);
    if (nestedTeam.exists) transaction.update(nestedTeamRef, teamUpdate);
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'team.manager.change', requestId: input.requestId,
      teamId: input.teamId, userId: input.userId, operation: input.action, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = {
      teamId: input.teamId, teamName: team.name || team.title || '', userId: input.userId,
      staffName: targetData.fullName || targetData.displayName || targetData.name || '', operation: input.action,
    };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: input.action === 'assign' ? 'zoki.action.team.manager.assign' : 'zoki.action.team.manager.remove',
    targetType: 'teamManager', targetId: `${input.teamId}:${input.userId}`, targetUid: input.userId,
    schoolId: input.schoolId, metadata: { teamId: input.teamId, userId: input.userId },
  });
  return { ok: true, executed, ...result, route: '/teams' };
}

export async function executeZokiTeamCreateHandler(request) {
  const actor = await requireActor(request);
  const input = zokiTeamCreateActionSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'zokiTeamCreate', limit: 15, windowSeconds: 300 });
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId });
  const editPermission = evaluatePermission(permissionContext, { capability: 'teams_edit', accessLevel: 'edit', resource: {} });
  if (!actor.globalAdmin && !isPrincipalFor(actor, input.schoolId) && !editPermission.allowed) throw permissionDenied();
  const actionId = stableId(actor.uid, input.schoolId, input.requestId);
  const teamId = `zoki_${actionId}`;
  const nestedTeamRef = adminDb.doc(`schools/${input.schoolId}/teams/${teamId}`);
  const legacyTeamRef = adminDb.doc(`teams_${input.schoolId}/${teamId}`);
  const receiptRef = adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`);
  const memberRefs = input.memberIds.map(userId => adminDb.doc(`users/${userId}`));
  let executed = false;
  let result = null;

  await adminDb.runTransaction(async transaction => {
    const [receipt, nestedTeams, legacyTeams, ...memberSnapshots] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(adminDb.collection(`schools/${input.schoolId}/teams`).limit(500)),
      transaction.get(adminDb.collection(`teams_${input.schoolId}`).limit(500)),
      ...memberRefs.map(ref => transaction.get(ref)),
    ]);
    if (receipt.exists) {
      const value = receipt.data();
      result = { teamId: value.teamId, memberCount: value.memberCount };
      return;
    }
    const normalizedName = input.name.toLocaleLowerCase('he-IL');
    const duplicate = [...nestedTeams.docs, ...legacyTeams.docs].some(snapshot => {
      const team = snapshot.data();
      return team.status !== 'archived'
        && String(team.name || team.title || '').trim().toLocaleLowerCase('he-IL') === normalizedName;
    });
    if (duplicate) throw publicError('already-exists', 'team-name-exists', 'כבר קיים צוות פעיל בשם הזה.');
    memberSnapshots.forEach(snapshot => {
      const user = snapshot.exists ? snapshot.data() : null;
      if (!snapshot.exists || !userInSchool(user, input.schoolId)
        || user.accountStatus === 'disabled' || user.status === 'archived') {
        throw publicError('failed-precondition', 'team-staff-changed', 'אחד מחברי הצוות שנבחרו אינו זמין עוד. יש לבקש מזוקי הצעה חדשה.');
      }
    });
    const team = {
      schoolId: input.schoolId, name: input.name, description: input.description,
      responsibilityAreas: input.responsibilityAreas, keywords: input.keywords, aliases: input.aliases,
      supportingRoles: input.supportingRoles, typicalTaskTypes: input.typicalTaskTypes,
      memberIds: input.memberIds, managerIds: [actor.uid], status: 'active', source: 'zoki',
      createdBy: actor.data.fullName || actor.data.displayName || actor.uid, createdById: actor.uid,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.create(nestedTeamRef, team);
    transaction.create(legacyTeamRef, team);
    memberRefs.forEach((ref, index) => {
      const userId = input.memberIds[index];
      transaction.update(ref, {
        teamIds: FieldValue.arrayUnion(teamId),
        [`teamIdsBySchool.${input.schoolId}`]: FieldValue.arrayUnion(teamId),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(adminDb.doc(`notifications/zoki_team_create_${actionId}_${index}`), {
        userId, schoolId: input.schoolId, title: `הוספת לצוות "${input.name}"`,
        body: `${String(actor.data.fullName || actor.data.displayName || 'מנהל הצוות').slice(0, 120)} הוסיף/ה אותך לצוות`,
        type: 'staff', link: '/teams', read: false, createdAt: FieldValue.serverTimestamp(),
      });
    });
    transaction.create(receiptRef, {
      schoolId: input.schoolId, actorUid: actor.uid, action: 'team.create', requestId: input.requestId,
      teamId, memberCount: input.memberIds.length, createdAt: FieldValue.serverTimestamp(),
    });
    executed = true;
    result = { teamId, name: input.name, memberCount: input.memberIds.length };
  });

  if (executed) await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.action.team.create', targetType: 'team', targetId: teamId,
    schoolId: input.schoolId, metadata: { teamId, memberCount: input.memberIds.length },
  });
  return { ok: true, executed, ...result, route: '/teams' };
}

export const executeZokiGrade = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiGradeHandler(request); }
  catch (error) { logger.error('Zoki grade action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiTaskStatus = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiTaskStatusHandler(request); }
  catch (error) { logger.error('Zoki task status action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiTaskAssignment = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiTaskAssignmentHandler(request); }
  catch (error) { logger.error('Zoki task assignment action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiTaskDetails = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiTaskDetailsHandler(request); }
  catch (error) { logger.error('Zoki task details action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiStudentTransfer = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiStudentTransferHandler(request); }
  catch (error) { logger.error('Zoki student transfer failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiRoleAssignment = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiRoleAssignmentHandler(request); }
  catch (error) { logger.error('Zoki role assignment failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiDirectPermission = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiDirectPermissionHandler(request); }
  catch (error) { logger.error('Zoki direct permission action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiResourceAccess = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiResourceAccessHandler(request); }
  catch (error) { logger.error('Zoki resource access action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiResourceRename = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiResourceRenameHandler(request); }
  catch (error) { logger.error('Zoki resource rename failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiResourceMove = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiResourceMoveHandler(request); }
  catch (error) { logger.error('Zoki resource move failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiResourceCreate = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiResourceCreateHandler(request); }
  catch (error) { logger.error('Zoki resource creation failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiStudentTrack = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiStudentTrackHandler(request); }
  catch (error) { logger.error('Zoki student track action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiAttendance = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiAttendanceHandler(request); }
  catch (error) { logger.error('Zoki attendance action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiStudentNote = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiStudentNoteHandler(request); }
  catch (error) { logger.error('Zoki student note action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiCalendarEvent = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiCalendarEventHandler(request); }
  catch (error) { logger.error('Zoki calendar event action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiCalendarEventUpdate = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiCalendarEventUpdateHandler(request); }
  catch (error) { logger.error('Zoki calendar event update failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiCalendarEventCancel = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiCalendarEventCancelHandler(request); }
  catch (error) { logger.error('Zoki calendar event cancellation failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiContact = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiContactHandler(request); }
  catch (error) { logger.error('Zoki contact action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiTeamMembership = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiTeamMembershipHandler(request); }
  catch (error) { logger.error('Zoki team membership action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiTeamCreate = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiTeamCreateHandler(request); }
  catch (error) { logger.error('Zoki team creation failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const executeZokiTeamManager = onCall(CALLABLE_OPTIONS, async request => {
  try { return await executeZokiTeamManagerHandler(request); }
  catch (error) { logger.error('Zoki team manager action failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});
