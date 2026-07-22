import { adminAuth, adminDb } from './firebaseAdmin.js';
import { permissionDenied, unauthenticated } from './errors.js';

function memberships(userData = {}) {
  const ids = new Set(Array.isArray(userData.schoolIds) ? userData.schoolIds : []);
  if (typeof userData.schoolId === 'string' && userData.schoolId) ids.add(userData.schoolId);
  return ids;
}

export async function requireActor(request) {
  if (!request.auth?.uid) throw unauthenticated();
  const snapshot = await adminDb.collection('users').doc(request.auth.uid).get();
  if (!snapshot.exists) throw permissionDenied();
  const data = snapshot.data();
  if (data.accountStatus && data.accountStatus !== 'active') throw permissionDenied();
  return {
    uid: request.auth.uid,
    data,
    globalAdmin: request.auth.token.global_admin === true,
    schoolIds: memberships(data),
  };
}

export function isPrincipalFor(actor, schoolId) {
  return actor.data.role === 'principal' && actor.schoolIds.has(schoolId);
}

export function requireSchoolManager(actor, schoolId) {
  if (actor.globalAdmin || isPrincipalFor(actor, schoolId)) return;
  throw permissionDenied();
}

export async function requireTargetInSchool(actor, targetUid, schoolId, { allowSelf = false } = {}) {
  if (!allowSelf && actor.uid === targetUid) throw permissionDenied();
  const targetRef = adminDb.collection('users').doc(targetUid);
  const targetSnapshot = await targetRef.get();
  if (!targetSnapshot.exists) throw permissionDenied();
  const targetData = targetSnapshot.data();
  const targetMemberships = memberships(targetData);
  if (!actor.globalAdmin && !targetMemberships.has(schoolId)) throw permissionDenied();

  const targetAuth = await adminAuth.getUser(targetUid);
  const targetGlobalAdmin = targetAuth.customClaims?.global_admin === true;
  if (!actor.globalAdmin && (targetGlobalAdmin || targetData.role === 'principal')) {
    throw permissionDenied();
  }

  return { ref: targetRef, data: targetData, auth: targetAuth, schoolIds: targetMemberships };
}

export async function assertReferencesBelongToSchool(schoolId, collectionName, ids) {
  if (!ids?.length) return;
  const uniqueIds = [...new Set(ids)];
  const nestedRefs = uniqueIds.map(id => adminDb.doc(`schools/${schoolId}/${collectionName}/${id}`));
  const nestedSnapshots = await adminDb.getAll(...nestedRefs);
  const missing = uniqueIds.filter((id, index) => !nestedSnapshots[index].exists);
  if (missing.length === 0) return;

  const legacyRefs = missing.map(id => adminDb.doc(`${collectionName}_${schoolId}/${id}`));
  const legacySnapshots = await adminDb.getAll(...legacyRefs);
  if (legacySnapshots.some(snapshot => !snapshot.exists)) throw permissionDenied();
}
