import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { requireActor } from '../services/authorization.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { buildPermissionContext, withResourcePermissionContext, evaluatePermission } from '../services/permissionEngine.js';

export async function listSharedFilesHandler(request) {
  const actor = await requireActor(request);
  const schoolId = request.data?.schoolId;
  if (typeof schoolId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(schoolId) || !actor.schoolIds.has(schoolId)) throw new HttpsError('permission-denied', 'School required');
  return { files: await sharedFilesForUser(actor.uid, schoolId) };
}
export async function sharedFilesForUser(userId, schoolId) {
  const context = await buildPermissionContext({ userId, schoolId });
  const groups = { user: [userId], role: context.subject.roleIds, team: context.subject.teamIds, class: context.subject.classIds };
  const snapshots = await Promise.all(Object.entries(groups).flatMap(([type, ids]) => ids.map(id => adminDb.collection(`schools/${schoolId}/resourceAcls`).where('principalType', '==', type).where('principalId', '==', id).get())));
  const candidates = new Set();
  for (const acl of snapshots.flatMap(snapshot => snapshot.docs.map(doc => doc.data()))) {
    if (acl.active === false || acl.explicitDeny) continue;
    if (acl.resourceType === 'file') candidates.add(acl.resourceId);
    if (acl.resourceType === 'folder' && acl.inherit !== false) {
      const children = await Promise.all([adminDb.collection(`schools/${schoolId}/files`), adminDb.collection(`files_${schoolId}`)].map(collection => collection.where('folderId', '==', acl.resourceId).get()));
      children.flatMap(snapshot => snapshot.docs).forEach(doc => candidates.add(doc.id));
    }
  }
  const files = [];
  for (const id of candidates) {
    const nested = await adminDb.doc(`schools/${schoolId}/files/${id}`).get();
    const snapshot = nested.exists ? nested : await adminDb.doc(`files_${schoolId}/${id}`).get();
    if (!snapshot.exists) continue;
    const file = snapshot.data();
    const resource = { resourceType: 'file', resourceId: id, parentIds: file.folderId ? [file.folderId] : [] };
    const fileContext = await withResourcePermissionContext(context, resource);
    const can = action => evaluatePermission(fileContext, { ...resource, capability: `files.${action}`, accessLevel: action, resource: { resourceId: id, classId: file.classId } }).allowed;
    if (can('view')) files.push({ id, dataMode: nested.exists ? 'nested' : 'legacy', name: file.name || '', fileType: file.fileType || '', classId: file.classId || '', gradebookId: file.gradebookId || '', actions: ['view', 'create', 'edit', 'comment', 'delete', 'manage'].filter(can) });
  }
  return files;
}
export const listSharedFiles = onCall(CALLABLE_OPTIONS, listSharedFilesHandler);
