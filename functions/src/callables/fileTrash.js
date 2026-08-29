import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { fileTrashActionSchema } from '../validation/schemas.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb, adminStorage } from '../services/firebaseAdmin.js';
import { permissionDenied, publicError, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { requireRoleAction, resolveActorRoleAuthority } from '../services/roleAuthorization.js';

async function resolveResource(schoolId, resourceType, resourceId) {
  const collectionName = resourceType === 'file' ? 'files' : 'folders';
  const [nested, legacy] = await adminDb.getAll(
    adminDb.doc(`schools/${schoolId}/${collectionName}/${resourceId}`),
    adminDb.doc(`${collectionName}_${schoolId}/${resourceId}`),
  );
  const snapshots = [nested, legacy].filter(snapshot => snapshot.exists);
  if (snapshots.length) return {
    snapshot: legacy.exists ? legacy : nested,
    snapshots,
    mode: [nested.exists && 'nested', legacy.exists && 'legacy'].filter(Boolean).join('+'),
  };
  throw permissionDenied();
}

async function folderFiles(schoolId, folderId) {
  const [nested, legacy] = await Promise.all([
    adminDb.collection(`schools/${schoolId}/files`).where('folderId', '==', folderId).get(),
    adminDb.collection(`files_${schoolId}`).where('folderId', '==', folderId).get(),
  ]);
  return [...nested.docs, ...legacy.docs];
}

async function removeStoredObject(data) {
  if (!data.storagePath) return;
  try { await adminStorage.bucket().file(data.storagePath).delete({ ignoreNotFound: true }); } catch (error) {
    logger.warn('Stored file cleanup failed.', { code: error?.code || 'unknown' });
  }
}

async function purgeDocument(snapshot) {
  const data = snapshot.data();
  await removeStoredObject(data);
  if (data.fileType === 'gradebook' && data.gradebookId && data.schoolId) {
    const gradebookRef = adminDb.doc(`schools/${data.schoolId}/gradebooks/${data.gradebookId}`);
    try { await adminDb.recursiveDelete(gradebookRef); } catch (error) {
      logger.warn('Gradebook cleanup failed.', { code: error?.code || 'unknown' });
    }
  }
  await adminDb.recursiveDelete(snapshot.ref);
}

async function updateDocuments(updates) {
  const chunkSize = 400;
  for (let index = 0; index < updates.length; index += chunkSize) {
    const batch = adminDb.batch();
    updates.slice(index, index + chunkSize).forEach(({ ref, patch }) => batch.update(ref, patch));
    await batch.commit();
  }
}

async function linkedGradebookUpdates(fileSnapshots, patch) {
  const gradebookRefsByPath = new Map(fileSnapshots.flatMap(snapshot => {
    const file = snapshot.data();
    return file.fileType === 'gradebook' && file.gradebookId && file.schoolId
      ? [adminDb.doc(`schools/${file.schoolId}/gradebooks/${file.gradebookId}`)]
      : [];
  }).map(ref => [ref.path, ref]));
  const gradebookRefs = [...gradebookRefsByPath.values()];
  if (gradebookRefs.length === 0) return [];
  const snapshots = await adminDb.getAll(...gradebookRefs);
  return snapshots.filter(snapshot => snapshot.exists).map(snapshot => ({ ref: snapshot.ref, patch }));
}

export async function fileTrashActionHandler(request) {
  const actor = await requireActor(request);
  const input = fileTrashActionSchema.parse(request.data);
  const authority = await resolveActorRoleAuthority(actor, input.schoolId);
  requireRoleAction(authority, 'files.delete');
  await enforceRateLimit({ uid: actor.uid, action: `fileTrash.${input.action}`, limit: input.action === 'purge' ? 20 : 80 });
  const resource = await resolveResource(input.schoolId, input.resourceType, input.resourceId);
  const data = resource.snapshot.data();
  const actionId = input.source === 'zoki'
    ? createHash('sha256').update([actor.uid, input.schoolId, input.requestId, `resource-${input.action}`].join('\u0000')).digest('hex').slice(0, 40)
    : '';
  const receiptRef = actionId ? adminDb.doc(`schools/${input.schoolId}/zokiActionReceipts/${actionId}`) : null;
  if (receiptRef && (await receiptRef.get()).exists) {
    const queryKey = input.resourceType === 'file' ? 'openFile' : 'folder';
    const route = input.action === 'restore' ? `/files?${queryKey}=${encodeURIComponent(input.resourceId)}` : '/files?trash=1';
    return { ok: true, executed: false, resourceType: input.resourceType, resourceId: input.resourceId, route };
  }
  if (input.source === 'zoki' && (data.name || data.title || '') !== input.expectedName) {
    throw publicError('failed-precondition', 'resource-changed', 'שם הפריט השתנה מאז ההצעה. יש לבקש מזוקי לבדוק מחדש.');
  }
  if (input.source === 'zoki') {
    const stateMatches = input.action === 'trash' ? !data.trashedAt : Boolean(data.trashedAt);
    if (!stateMatches) {
      throw publicError('failed-precondition', 'resource-changed', 'מצב הפריט השתנה מאז ההצעה. יש לבקש מזוקי לבדוק מחדש.');
    }
  }

  if (input.action === 'trash') {
    const patch = {
      trashedAt: FieldValue.serverTimestamp(),
      trashedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const affectedFiles = input.resourceType === 'file' ? [...resource.snapshots] : [];
    const updates = resource.snapshots.map(snapshot => ({ ref: snapshot.ref, patch }));
    if (input.resourceType === 'folder') {
      const children = await folderFiles(input.schoolId, input.resourceId);
      affectedFiles.push(...children);
      children.forEach(child => updates.push({
        ref: child.ref,
        patch: { ...patch, trashedWithFolderId: input.resourceId },
      }));
    }
    updates.push(...await linkedGradebookUpdates(affectedFiles, patch));
    await updateDocuments(updates);
  } else if (input.action === 'restore') {
    if (!data.trashedAt) throw permissionDenied();
    const patch = {
      trashedAt: FieldValue.delete(), trashedBy: FieldValue.delete(),
      trashedWithFolderId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
    };
    const affectedFiles = input.resourceType === 'file' ? [...resource.snapshots] : [];
    const updates = resource.snapshots.map(snapshot => ({ ref: snapshot.ref, patch }));
    if (input.resourceType === 'folder') {
      const children = await folderFiles(input.schoolId, input.resourceId);
      const movedChildren = children.filter(child => child.data().trashedWithFolderId === input.resourceId);
      affectedFiles.push(...movedChildren);
      movedChildren.forEach(child => updates.push({ ref: child.ref, patch }));
    }
    updates.push(...await linkedGradebookUpdates(affectedFiles, patch));
    await updateDocuments(updates);
  } else {
    if (!data.trashedAt || input.confirmPermanent !== true) throw permissionDenied();
    if (input.resourceType === 'folder') {
      const children = await folderFiles(input.schoolId, input.resourceId);
      await Promise.all(children.map(purgeDocument));
    }
    await Promise.all(resource.snapshots.map(purgeDocument));
  }

  if (receiptRef) await receiptRef.create({
    schoolId: input.schoolId, actorUid: actor.uid, action: `resource.${input.action}`, requestId: input.requestId,
    resourceType: input.resourceType, resourceId: input.resourceId, createdAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    actorUid: actor.uid,
    action: input.source === 'zoki' ? `zoki.action.resource.${input.action}` : `file.${input.action}`,
    targetType: input.resourceType,
    targetId: input.resourceId,
    schoolId: input.schoolId,
    metadata: { resourceType: input.resourceType, resourceId: input.resourceId, dataMode: resource.mode },
  });
  const queryKey = input.resourceType === 'file' ? 'openFile' : 'folder';
  const route = input.action === 'restore' ? `/files?${queryKey}=${encodeURIComponent(input.resourceId)}` : '/files?trash=1';
  return { ok: true, executed: true, resourceType: input.resourceType, resourceId: input.resourceId, route };
}

async function runSafely(request) {
  try { return await fileTrashActionHandler(request); }
  catch (error) {
    logger.error('File trash operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

export const fileTrashAction = onCall(CALLABLE_OPTIONS, runSafely);
