import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import {
  calculateClassOutcomesSchema,
  classOutcomeTargetSchema,
  initializeOutcomeTemplatesSchema,
  manualOutcomeApprovalSchema,
  outcomeDefinitionActionSchema,
  outcomeDefinitionSchema,
} from '../validation/schemas.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { failedPrecondition, permissionDenied, toPublicError } from '../services/errors.js';
import { evaluateOutcomeDefinition, summarizeOutcomeResults } from '../services/outcomeEvaluator.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { requireRoleAction, resolveActorRoleAuthority } from '../services/roleAuthorization.js';

const STARTER_TEMPLATES = [
  { key: 'full_matriculation', name: 'בגרות מלאה', calculationMode: 'combined', criteria: [{ type: 'average_min', minimum: 55 }, { type: 'manual_approval' }] },
  { key: 'technological_matriculation', name: 'בגרות טכנולוגית', calculationMode: 'combined', criteria: [{ type: 'professional_exam_passed' }, { type: 'manual_approval' }] },
  { key: 'professional_certificate', name: 'תעודת מקצוע', calculationMode: 'combined', criteria: [{ type: 'practical_complete' }, { type: 'manual_approval' }] },
  { key: 'completion_certificate', name: 'תעודת גמר', calculationMode: 'combined', criteria: [{ type: 'attendance_min', minimum: 0 }, { type: 'manual_approval' }] },
];

async function authorize(actor, schoolId, permission) {
  if (!actor.schoolIds.has(schoolId) && !actor.globalAdmin) throw permissionDenied();
  const authority = await resolveActorRoleAuthority(actor, schoolId);
  requireRoleAction(authority, permission);
}

function definitionData(input, actor, version) {
  return {
    schoolId: input.schoolId,
    institutionId: input.schoolId,
    name: input.name,
    description: input.description,
    academicYearId: input.academicYearId,
    applicableGrades: input.applicableGrades,
    applicableTracks: input.applicableTracks,
    applicablePrograms: input.applicablePrograms,
    active: input.active,
    calculationMode: input.calculationMode,
    criteria: input.criteria,
    dropoutPolicy: input.dropoutPolicy,
    version,
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export async function initializeOutcomeTemplatesHandler(request) {
  const actor = await requireActor(request);
  const input = initializeOutcomeTemplatesSchema.parse(request.data);
  await authorize(actor, input.schoolId, 'outcomes.manageDefinitions');
  await enforceRateLimit({ uid: actor.uid, action: 'outcomes.initializeTemplates', limit: 4, windowSeconds: 3600 });
  const collection = adminDb.collection(`schools/${input.schoolId}/outcomeDefinitions`);
  const existing = await collection.where('starterTemplate', '==', true).limit(1).get();
  if (!existing.empty) return { created: 0, alreadyInitialized: true };
  const batch = adminDb.batch();
  STARTER_TEMPLATES.forEach(template => {
    const ref = collection.doc(`starter_${template.key}_${input.academicYearId}`);
    batch.create(ref, {
      schoolId: input.schoolId,
      institutionId: input.schoolId,
      name: template.name,
      description: 'תבנית התחלתית בלבד. יש להתאים ולאמת את התנאים למדיניות המוסד ולדרישות הרלוונטיות.',
      academicYearId: input.academicYearId,
      applicableGrades: [],
      applicableTracks: [],
      applicablePrograms: [],
      active: true,
      calculationMode: template.calculationMode,
      criteria: template.criteria,
      dropoutPolicy: 'exclude',
      version: 1,
      starterTemplate: true,
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  await writeAuditLog({ actorUid: actor.uid, actorRole: actor.data.role || '', action: 'outcomes.templates.initialize', targetType: 'school', targetId: input.schoolId, schoolId: input.schoolId, after: { count: STARTER_TEMPLATES.length } });
  return { created: STARTER_TEMPLATES.length, alreadyInitialized: false };
}

export async function upsertOutcomeDefinitionHandler(request) {
  const actor = await requireActor(request);
  const input = outcomeDefinitionSchema.parse(request.data);
  await authorize(actor, input.schoolId, 'outcomes.manageDefinitions');
  await enforceRateLimit({ uid: actor.uid, action: 'outcomes.definition.write', limit: 30, windowSeconds: 300 });
  const collection = adminDb.collection(`schools/${input.schoolId}/outcomeDefinitions`);
  const ref = input.definitionId ? collection.doc(input.definitionId) : collection.doc();
  let previous = null;
  let version = 1;
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    previous = snapshot.exists ? snapshot.data() : null;
    version = snapshot.exists ? (Number(previous.version) || 1) + 1 : 1;
    const next = definitionData(input, actor, version);
    transaction.set(ref, {
      ...next,
      ...(snapshot.exists ? {} : { createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() }),
    }, { merge: snapshot.exists });
    transaction.create(ref.collection('versions').doc(String(version)), {
      ...next,
      definitionId: ref.id,
      savedAt: FieldValue.serverTimestamp(),
    });
  });
  await writeAuditLog({
    actorUid: actor.uid, actorRole: actor.data.role || '', action: 'outcomes.definition.upsert',
    targetType: 'outcomeDefinition', targetId: ref.id, schoolId: input.schoolId,
    before: previous ? { name: previous.name || '', active: previous.active !== false, version: previous.version || 1 } : {},
    after: { name: input.name, active: input.active, version },
  });
  return { definitionId: ref.id, version };
}

export async function outcomeDefinitionActionHandler(request) {
  const actor = await requireActor(request);
  const input = outcomeDefinitionActionSchema.parse(request.data);
  await authorize(actor, input.schoolId, 'outcomes.manageDefinitions');
  const sourceRef = adminDb.doc(`schools/${input.schoolId}/outcomeDefinitions/${input.definitionId}`);
  const sourceSnapshot = await sourceRef.get();
  if (!sourceSnapshot.exists) throw failedPrecondition();
  const source = sourceSnapshot.data();
  if (input.action === 'disable') {
    await sourceRef.update({ active: false, version: (Number(source.version) || 1) + 1, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
    await writeAuditLog({ actorUid: actor.uid, actorRole: actor.data.role || '', action: 'outcomes.definition.disable', targetType: 'outcomeDefinition', targetId: input.definitionId, schoolId: input.schoolId, before: { active: source.active !== false }, after: { active: false } });
    return { definitionId: input.definitionId, action: input.action };
  }
  const targetRef = sourceRef.parent.doc();
  const clone = { ...source, name: input.name || `${source.name} - עותק`, version: 1, starterTemplate: false, clonedFrom: sourceRef.id, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() };
  delete clone.id;
  await targetRef.create(clone);
  await writeAuditLog({ actorUid: actor.uid, actorRole: actor.data.role || '', action: 'outcomes.definition.clone', targetType: 'outcomeDefinition', targetId: targetRef.id, schoolId: input.schoolId, after: { clonedFrom: sourceRef.id } });
  return { definitionId: targetRef.id, action: input.action };
}

export async function upsertClassOutcomeTargetHandler(request) {
  const actor = await requireActor(request);
  const input = classOutcomeTargetSchema.parse(request.data);
  await authorize(actor, input.schoolId, 'outcomes.assignToClass');
  const [definition, classSnapshot] = await adminDb.getAll(
    adminDb.doc(`schools/${input.schoolId}/outcomeDefinitions/${input.outcomeDefinitionId}`),
    adminDb.doc(`schools/${input.schoolId}/classes/${input.classId}`),
  );
  if (!definition.exists || !classSnapshot.exists || definition.data().active === false) throw failedPrecondition();
  const targetId = `${input.classId}_${input.academicYearId}_${input.outcomeDefinitionId}`;
  const ref = adminDb.doc(`schools/${input.schoolId}/classOutcomeTargets/${targetId}`);
  await ref.set({ ...input, institutionId: input.schoolId, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(), createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() }, { merge: true });
  await writeAuditLog({ actorUid: actor.uid, actorRole: actor.data.role || '', action: 'outcomes.target.upsert', targetType: 'classOutcomeTarget', targetId, schoolId: input.schoolId, after: { classId: input.classId, targetPercentage: input.targetPercentage } });
  return { targetId };
}

async function readStudentsForClass(schoolId, classId) {
  const [nested, legacy] = await Promise.all([
    adminDb.collection(`schools/${schoolId}/students`).where('classId', '==', classId).get(),
    adminDb.collection(`students_${schoolId}`).where('classId', '==', classId).get(),
  ]);
  const byId = new Map();
  legacy.docs.forEach(snapshot => byId.set(snapshot.id, { id: snapshot.id, ...snapshot.data() }));
  nested.docs.forEach(snapshot => byId.set(snapshot.id, { id: snapshot.id, ...snapshot.data() }));
  return [...byId.values()];
}

function factsFor(student, grade) {
  const outcomeData = student.outcomeData || {};
  return {
    subjectScores: grade?.calculated || {},
    average: outcomeData.average,
    units: outcomeData.units,
    practicalComplete: outcomeData.practicalComplete,
    workHours: outcomeData.workHours,
    attendancePercentage: outcomeData.attendancePercentage,
    professionalExamPassed: outcomeData.professionalExamPassed,
    evidenceUploaded: outcomeData.evidenceUploaded,
  };
}

export async function calculateClassOutcomesHandler(request) {
  const actor = await requireActor(request);
  const input = calculateClassOutcomesSchema.parse(request.data);
  await authorize(actor, input.schoolId, 'outcomes.calculate');
  await enforceRateLimit({ uid: actor.uid, action: 'outcomes.calculate', limit: 10, windowSeconds: 3600 });
  const jobRef = adminDb.doc(`schools/${input.schoolId}/outcomeCalculationJobs/${input.requestId}`);
  const claim = await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(jobRef);
    if (snapshot.exists) return snapshot.data();
    transaction.create(jobRef, { schoolId: input.schoolId, requestId: input.requestId, status: 'processing', createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() });
    return null;
  });
  if (claim) {
    if (claim.status !== 'completed') throw failedPrecondition();
    return { requestId: input.requestId, idempotentReplay: true, summaries: claim.summaries || [] };
  }
  try {
    const definitionRefs = input.outcomeDefinitionIds.map(id => adminDb.doc(`schools/${input.schoolId}/outcomeDefinitions/${id}`));
    const definitionSnapshots = await adminDb.getAll(...definitionRefs);
    if (definitionSnapshots.some(snapshot => !snapshot.exists || snapshot.data().active === false)) throw failedPrecondition();
    const [students, gradeSnapshot, targetSnapshot, approvalSnapshot] = await Promise.all([
      readStudentsForClass(input.schoolId, input.classId),
      adminDb.collection(`schools/${input.schoolId}/gradebooks/grades_${input.classId}_${input.academicYearId}/grades`).get(),
      adminDb.collection(`schools/${input.schoolId}/classOutcomeTargets`).where('classId', '==', input.classId).where('academicYearId', '==', input.academicYearId).get(),
      adminDb.collection(`schools/${input.schoolId}/studentOutcomeApprovals`).where('classId', '==', input.classId).get(),
    ]);
    const grades = new Map(gradeSnapshot.docs.map(snapshot => [snapshot.id, snapshot.data()]));
    const targets = new Map(targetSnapshot.docs.map(snapshot => [snapshot.data().outcomeDefinitionId, snapshot.data()]));
    const approvals = new Map(approvalSnapshot.docs
      .filter(snapshot => snapshot.data().academicYearId === input.academicYearId)
      .map(snapshot => [`${snapshot.data().studentId}_${snapshot.data().outcomeDefinitionId}_v${snapshot.data().outcomeDefinitionVersion}`, snapshot.data()]));
    const summaries = [];
    let batch = adminDb.batch();
    let writes = 0;
    async function flush() { if (writes) { await batch.commit(); batch = adminDb.batch(); writes = 0; } }

    for (const definitionSnapshot of definitionSnapshots) {
      const definition = definitionSnapshot.data();
      const target = targets.get(definitionSnapshot.id) || {};
      const explicitlyIncluded = new Set(target.includedStudentIds || []);
      const eligibleStudents = students.filter(student => {
        if (explicitlyIncluded.size && !explicitlyIncluded.has(student.id)) return false;
        if (student.status === 'dropout') return definition.dropoutPolicy === 'include';
        return !['withdrawn', 'inactive', 'archived', 'transferred'].includes(student.status);
      });
      const results = [];
      for (const student of eligibleStudents) {
        const approval = approvals.get(`${student.id}_${definitionSnapshot.id}_v${definition.version || 1}`);
        const evaluation = approval?.approved === true
          ? { status: 'manually_approved', passedCriteria: [], failedCriteria: [], missingCriteria: [], criteriaResults: [] }
          : evaluateOutcomeDefinition(definition, factsFor(student, grades.get(student.id)));
        // A calculation run is immutable. Including the request id lets a later
        // recalculation preserve the prior result instead of overwriting it.
        const resultId = `${student.id}_${definitionSnapshot.id}_v${definition.version || 1}_${input.requestId}`;
        const result = {
          schoolId: input.schoolId,
          institutionId: input.schoolId,
          studentId: student.id,
          classId: input.classId,
          academicYearId: input.academicYearId,
          outcomeDefinitionId: definitionSnapshot.id,
          outcomeDefinitionVersion: definition.version || 1,
          status: evaluation.status,
          passedCriteria: evaluation.passedCriteria,
          failedCriteria: evaluation.failedCriteria,
          missingCriteria: evaluation.missingCriteria,
          criteriaResults: evaluation.criteriaResults,
          calculatedBy: actor.uid,
          calculatedAt: FieldValue.serverTimestamp(),
          requestId: input.requestId,
          locked: true,
        };
        batch.create(adminDb.doc(`schools/${input.schoolId}/studentOutcomeResults/${resultId}`), result);
        writes += 1;
        results.push(result);
        if (writes >= 400) await flush();
      }
      const summary = summarizeOutcomeResults(results, target.targetPercentage || 0);
      const summaryId = `${input.classId}_${input.academicYearId}_${definitionSnapshot.id}_v${definition.version || 1}`;
      batch.set(adminDb.doc(`schools/${input.schoolId}/outcomeSummaries/${summaryId}`), {
        ...summary,
        schoolId: input.schoolId,
        institutionId: input.schoolId,
        classId: input.classId,
        academicYearId: input.academicYearId,
        outcomeDefinitionId: definitionSnapshot.id,
        outcomeDefinitionVersion: definition.version || 1,
        dropoutPolicy: definition.dropoutPolicy || 'exclude',
        separateDropoutCount: definition.dropoutPolicy === 'separate' ? students.filter(student => student.status === 'dropout').length : 0,
        calculatedBy: actor.uid,
        calculatedAt: FieldValue.serverTimestamp(),
        requestId: input.requestId,
      }, { merge: false });
      writes += 1;
      summaries.push({ outcomeDefinitionId: definitionSnapshot.id, outcomeDefinitionVersion: definition.version || 1, ...summary });
    }
    await flush();
    await jobRef.update({ status: 'completed', summaries, completedAt: FieldValue.serverTimestamp() });
    await writeAuditLog({ actorUid: actor.uid, actorRole: actor.data.role || '', action: 'outcomes.calculate', targetType: 'class', targetId: input.classId, schoolId: input.schoolId, requestId: input.requestId, after: { definitionCount: definitionSnapshots.length, studentCount: students.length } });
    return { requestId: input.requestId, idempotentReplay: false, summaries };
  } catch (error) {
    await jobRef.update({ status: 'failed', completedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
    throw error;
  }
}

export async function manualOutcomeApprovalHandler(request) {
  const actor = await requireActor(request);
  const input = manualOutcomeApprovalSchema.parse(request.data);
  await authorize(actor, input.schoolId, 'outcomes.manualApproval');
  await enforceRateLimit({ uid: actor.uid, action: 'outcomes.manualApproval', limit: 30, windowSeconds: 300 });
  const definitionRef = adminDb.doc(`schools/${input.schoolId}/outcomeDefinitions/${input.outcomeDefinitionId}`);
  const definition = await definitionRef.get();
  if (!definition.exists) throw failedPrecondition();
  const version = definition.data().version || 1;
  const resultId = input.resultId;
  const ref = adminDb.doc(`schools/${input.schoolId}/studentOutcomeResults/${resultId}`);
  const previous = await ref.get();
  if (!previous.exists
    || previous.data().studentId !== input.studentId
    || previous.data().classId !== input.classId
    || previous.data().academicYearId !== input.academicYearId
    || previous.data().outcomeDefinitionId !== input.outcomeDefinitionId
    || previous.data().outcomeDefinitionVersion !== version) throw failedPrecondition();
  const approvalId = `${input.studentId}_${input.outcomeDefinitionId}_v${version}`;
  const approvalRef = adminDb.doc(`schools/${input.schoolId}/studentOutcomeApprovals/${approvalId}`);
  const approvalData = {
    schoolId: input.schoolId,
    institutionId: input.schoolId,
    studentId: input.studentId,
    classId: input.classId,
    academicYearId: input.academicYearId,
    outcomeDefinitionId: input.outcomeDefinitionId,
    outcomeDefinitionVersion: version,
    sourceResultId: resultId,
    approved: input.approved,
    status: input.approved ? 'manually_approved' : 'pending_data',
    manuallyApprovedBy: actor.uid,
    manualApprovalReason: input.reason,
    manualApprovalAt: FieldValue.serverTimestamp(),
    requestId: input.requestId,
  };
  const batch = adminDb.batch();
  batch.set(approvalRef, approvalData, { merge: true });
  batch.create(approvalRef.collection('history').doc(input.requestId), { ...approvalData, locked: true });
  await batch.commit();
  await writeAuditLog({ actorUid: actor.uid, actorRole: actor.data.role || '', action: 'outcomes.manualApproval', targetType: 'studentOutcomeResult', targetId: resultId, schoolId: input.schoolId, reason: input.reason, requestId: input.requestId, before: { status: previous.data()?.status || '' }, after: { status: input.approved ? 'manually_approved' : 'pending_data' } });
  return { resultId, approvalId, status: input.approved ? 'manually_approved' : 'pending_data' };
}

async function runSafely(handler, request) {
  try { return await handler(request); }
  catch (error) {
    logger.error('Outcome operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

export const initializeOutcomeTemplates = onCall(CALLABLE_OPTIONS, request => runSafely(initializeOutcomeTemplatesHandler, request));
export const upsertOutcomeDefinition = onCall(CALLABLE_OPTIONS, request => runSafely(upsertOutcomeDefinitionHandler, request));
export const outcomeDefinitionAction = onCall(CALLABLE_OPTIONS, request => runSafely(outcomeDefinitionActionHandler, request));
export const upsertClassOutcomeTarget = onCall(CALLABLE_OPTIONS, request => runSafely(upsertClassOutcomeTargetHandler, request));
export const calculateClassOutcomes = onCall({ ...CALLABLE_OPTIONS, timeoutSeconds: 120, memory: '512MiB' }, request => runSafely(calculateClassOutcomesHandler, request));
export const manualOutcomeApproval = onCall(CALLABLE_OPTIONS, request => runSafely(manualOutcomeApprovalHandler, request));
