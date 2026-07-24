import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { requireActor, requireSchoolManager } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { failedPrecondition, permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import {
  assignInstitutionManagerSchema,
  createSchoolSchema,
  deleteSchoolSchema,
  updateSchoolSchema,
} from '../validation/schemas.js';
import { findAuthUserByEmail, createInvitationRecord } from '../services/invitations.js';
import { EMAIL_PROVIDER_API_KEY } from '../services/email.js';

const LEGACY_SCHOOL_RESOURCES = [
  'tasks', 'classes', 'students', 'files', 'file_history', 'folders', 'teams', 'events',
  'holidays', 'categories', 'roles', 'tracks', 'settings', 'sheets',
];

async function runSafely(handler, request) {
  try {
    return await handler(request);
  } catch (error) {
    logger.error('School administration operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

export async function createSchoolHandler(request) {
  const actor = await requireActor(request);
  if (!actor.platformAdmin) throw permissionDenied();
  const input = createSchoolSchema.parse(request.data);
  await enforceRateLimit({ uid: actor.uid, action: 'createSchool', limit: 5 });
  const schoolId = input.code.toLowerCase();
  const startYears = [2025, 2026, 2027];
  if (!startYears.map(year => `year_${year}_${year + 1}`).includes(input.activeAcademicYearId)) {
    throw failedPrecondition();
  }
  const ref = adminDb.collection('schools').doc(schoolId);
  const publicRef = adminDb.collection('schoolPublicDirectory').doc(schoolId);
  const schoolData = {
    name: input.name,
    code: input.code,
    address: input.address,
    phone: input.phone,
    institutionalEmail: input.institutionalEmail,
    activeAcademicYearId: input.activeAcademicYearId,
    status: input.status,
    primaryManagerId: '',
    managerIds: [],
    createdBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await adminDb.runTransaction(async transaction => {
    if ((await transaction.get(ref)).exists) throw failedPrecondition();
    transaction.create(ref, schoolData);
    transaction.create(publicRef, { schoolId, name: input.name, code: input.code, status: input.status, updatedAt: FieldValue.serverTimestamp() });
    startYears.forEach(startYear => {
      const labels = { 2025: 'תשפ״ו', 2026: 'תשפ״ז', 2027: 'תשפ״ח' };
      transaction.create(ref.collection('academicYears').doc(`year_${startYear}_${startYear + 1}`), {
        schoolId,
        hebrewYearNumber: startYear + 3761,
        hebrewLabel: labels[startYear],
        gregorianStartYear: startYear,
        gregorianEndYear: startYear + 1,
        startDate: `${startYear}-09-01`,
        endDate: `${startYear + 1}-08-31`,
        isActive: `year_${startYear}_${startYear + 1}` === input.activeAcademicYearId,
        label: labels[startYear],
        startYear,
        endYear: startYear + 1,
        status: startYear < 2026 ? 'closed' : startYear === 2026 ? 'active' : 'future',
        createdBy: actor.uid,
        updatedBy: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    transaction.create(ref.collection('settings').doc('academic_years'), {
      schoolId,
      activeAcademicYearId: input.activeAcademicYearId,
      createdBy: actor.uid,
      updatedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  const managerResult = await assignManager({ actor, schoolId, ...input.manager });
  await writeAuditLog({
    actorUid: actor.uid,
    action: 'school.create',
    schoolId,
  });
  return { schoolId, manager: managerResult };
}

async function assignManager({ actor, schoolId, fullName, email }) {
  const authUser = await findAuthUserByEmail(email);
  const schoolRef = adminDb.collection('schools').doc(schoolId);
  if (!authUser) {
    const invitation = await createInvitationRecord({
      actor,
      schoolId,
      fullName,
      email,
      role: 'institution_manager',
      throwOnDeliveryFailure: false,
    });
    await schoolRef.update({ pendingManagerInvitationId: invitation.invitationId, updatedAt: FieldValue.serverTimestamp() });
    return { type: 'invitation', ...invitation };
  }
  const userRef = adminDb.collection('users').doc(authUser.uid);
  const membershipRef = schoolRef.collection('memberships').doc(authUser.uid);
  await adminDb.runTransaction(async transaction => {
    const userSnapshot = await transaction.get(userRef);
    const current = userSnapshot.data() || {};
    transaction.set(userRef, {
      uid: authUser.uid,
      email: authUser.email,
      fullName: current.fullName || authUser.displayName || fullName,
      role: current.role && current.role !== 'viewer' ? current.role : 'institution_manager',
      rolesBySchool: { ...(current.rolesBySchool || {}), [schoolId]: 'institution_manager' },
      schoolId: current.schoolId || schoolId,
      schoolIds: [...new Set([...(current.schoolIds || []), schoolId])],
      accountStatus: 'active',
      updatedAt: FieldValue.serverTimestamp(),
      ...(userSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    transaction.set(membershipRef, { schoolId, userId: authUser.uid, role: 'institution_manager', status: 'active', joinedAt: FieldValue.serverTimestamp(), assignedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
    transaction.update(schoolRef, { primaryManagerId: authUser.uid, managerIds: FieldValue.arrayUnion(authUser.uid), pendingManagerInvitationId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
  });
  return { type: 'existing-user', userId: authUser.uid };
}

export async function assignInstitutionManagerHandler(request) {
  const actor = await requireActor(request);
  if (!actor.platformAdmin) throw permissionDenied();
  const input = assignInstitutionManagerSchema.parse(request.data);
  const school = await adminDb.collection('schools').doc(input.schoolId).get();
  if (!school.exists) throw failedPrecondition();
  await enforceRateLimit({ uid: actor.uid, action: 'assignInstitutionManager', limit: 10, windowSeconds: 300 });
  const result = await assignManager({ actor, ...input });
  await writeAuditLog({ actorUid: actor.uid, action: 'school.manager.assign', schoolId: input.schoolId, metadata: { assignmentType: result.type } });
  return result;
}

export async function updateSchoolHandler(request) {
  const actor = await requireActor(request);
  const input = updateSchoolSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'updateSchool', limit: 20 });
  const ref = adminDb.collection('schools').doc(input.schoolId);
  if (!(await ref.get()).exists) throw failedPrecondition();
  const current = (await ref.get()).data();
  const nextStatus = actor.platformAdmin ? input.status : current.status;
  await ref.update({
    name: input.name,
    code: input.code,
    address: input.address,
    phone: input.phone,
    institutionalEmail: input.institutionalEmail,
    activeAcademicYearId: input.activeAcademicYearId,
    status: nextStatus,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await adminDb.collection('schoolPublicDirectory').doc(input.schoolId).set({
    schoolId: input.schoolId,
    name: input.name,
    code: input.code,
    status: nextStatus,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await writeAuditLog({
    actorUid: actor.uid,
    action: 'school.update',
    schoolId: input.schoolId,
  });
  return { ok: true };
}

async function schoolHasData(schoolId, schoolRef) {
  const [primaryUsers, additionalUsers, nestedCollections, ...legacySnapshots] = await Promise.all([
    adminDb.collection('users').where('schoolId', '==', schoolId).limit(1).get(),
    adminDb.collection('users').where('schoolIds', 'array-contains', schoolId).limit(1).get(),
    schoolRef.listCollections(),
    ...LEGACY_SCHOOL_RESOURCES.map(resource => (
      adminDb.collection(`${resource}_${schoolId}`).limit(1).get()
    )),
  ]);
  if (!primaryUsers.empty || !additionalUsers.empty || legacySnapshots.some(snapshot => !snapshot.empty)) {
    return true;
  }
  const contentCollections = nestedCollections.filter(collectionRef => !['academicYears', 'settings'].includes(collectionRef.id));
  const nestedSnapshots = await Promise.all(contentCollections.map(collectionRef => collectionRef.limit(1).get()));
  return nestedSnapshots.some(snapshot => !snapshot.empty);
}

export async function deleteSchoolHandler(request) {
  const actor = await requireActor(request);
  if (!actor.platformAdmin) throw permissionDenied();
  const input = deleteSchoolSchema.parse(request.data);
  await enforceRateLimit({ uid: actor.uid, action: 'deleteSchool', limit: 3 });
  const ref = adminDb.collection('schools').doc(input.schoolId);
  if (!(await ref.get()).exists || await schoolHasData(input.schoolId, ref)) throw failedPrecondition();
  const batch = adminDb.batch();
  [2025, 2026, 2027].forEach(year => batch.delete(ref.collection('academicYears').doc(`year_${year}_${year + 1}`)));
  batch.delete(ref.collection('settings').doc('academic_years'));
  batch.delete(adminDb.collection('schoolPublicDirectory').doc(input.schoolId));
  batch.delete(ref);
  await batch.commit();
  await writeAuditLog({
    actorUid: actor.uid,
    action: 'school.delete',
    schoolId: input.schoolId,
  });
  return { ok: true };
}

const SCHOOL_OPTIONS = { ...CALLABLE_OPTIONS, secrets: [EMAIL_PROVIDER_API_KEY] };
export const createSchool = onCall(SCHOOL_OPTIONS, request => runSafely(createSchoolHandler, request));
export const updateSchool = onCall(CALLABLE_OPTIONS, request => runSafely(updateSchoolHandler, request));
export const deleteSchool = onCall(CALLABLE_OPTIONS, request => runSafely(deleteSchoolHandler, request));
export const assignInstitutionManager = onCall(SCHOOL_OPTIONS, request => runSafely(assignInstitutionManagerHandler, request));
