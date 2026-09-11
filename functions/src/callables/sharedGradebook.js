import { z } from 'zod';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { requireActor } from '../services/authorization.js';
import { buildPermissionContext, evaluatePermission } from '../services/permissionEngine.js';

const inputSchema = z.object({ schoolId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), gradebookId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/) }).strict();
// A shared mapping needs only a roster, never full student records or sensitive subdocuments.
export async function getSharedGradebookContextHandler(request) {
  const actor = await requireActor(request);
  const { schoolId, gradebookId } = inputSchema.parse(request.data);
  const fileId = `gradebook_${gradebookId}`;
  const [nestedFile, bookDoc] = await adminDb.getAll(adminDb.doc(`schools/${schoolId}/files/${fileId}`), adminDb.doc(`schools/${schoolId}/gradebooks/${gradebookId}`));
  const fileDoc = nestedFile.exists ? nestedFile : await adminDb.doc(`files_${schoolId}/${fileId}`).get();
  if (!fileDoc.exists || !bookDoc.exists || fileDoc.data().gradebookId !== gradebookId || fileDoc.data().classId !== bookDoc.data().classId) throw new HttpsError('permission-denied', 'Mapping unavailable');
  const file = fileDoc.data(), book = bookDoc.data();
  const resource = { resourceType: 'file', resourceId: fileId, parentIds: file.folderId ? [file.folderId] : [] };
  const context = await buildPermissionContext({ userId: actor.uid, schoolId, resource });
  const nestedClass = await adminDb.doc(`schools/${schoolId}/classes/${book.classId}`).get();
  const classDoc = nestedClass.exists ? nestedClass : await adminDb.doc(`classes_${schoolId}/${book.classId}`).get();
  const legacyAssigned = !actor.data.accessProfilesBySchool?.[schoolId] && context.resourceAcls.length === 0 && classDoc.exists && (classDoc.data().teacherId === actor.uid || classDoc.data().staffIds?.includes(actor.uid));
  const allows = (capability, action) => (legacyAssigned && (action !== 'manage' || classDoc.data().teacherId === actor.uid)) || evaluatePermission(context, { capability, ...resource, accessLevel: action, resource: { classId: book.classId, resourceId: fileId } }).allowed;
  if (!allows('grades.view', 'view')) throw new HttpsError('permission-denied', 'Mapping unavailable');
  const snapshots = await Promise.all([adminDb.collection(`students_${schoolId}`), adminDb.collection(`schools/${schoolId}/students`)].map(collection => collection.where('classId', '==', book.classId).get()));
  const students = { docs: [...new Map(snapshots.flatMap(snapshot => snapshot.docs).map(doc => [doc.id, doc])).values()] };
  if (students.docs.length) {
    const nested = await adminDb.getAll(...students.docs.map(doc => adminDb.doc(`schools/${schoolId}/students/${doc.id}`)));
    const overrides = new Map(nested.filter(doc => doc.exists).map(doc => [doc.id, doc]));
    students.docs = students.docs.map(doc => overrides.get(doc.id) || doc).filter(doc => doc.data().classId === book.classId);
  }
  return { students: students.docs.filter(doc => doc.data().status !== 'archived').map(doc => ({ id: doc.id, fullName: doc.data().fullName || doc.data().displayName || '', classId: book.classId })), canCreate: allows('grades.edit', 'create'), canEdit: allows('grades.edit', 'edit'), canManage: allows('gradebooks.manage', 'manage') };
}
export const getSharedGradebookContext = onCall(CALLABLE_OPTIONS, getSharedGradebookContextHandler);
