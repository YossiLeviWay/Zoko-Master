import { getDoc, getDocs, query, where, writeBatch, serverTimestamp, deleteField } from 'firebase/firestore';
import { schoolDoc, schoolCollection } from './paths';
import { privateSessionGuard } from '../../utils/browserPrivacy';

// Reversible, manager-authorized operations work on Spark. Hard deletion stays server-only.
export async function changeRecycleBin({ db, schoolId, actorId, resourceType, item, action }) {
  if (!['trash', 'restore'].includes(action) || !['file', 'folder'].includes(resourceType)) throw new Error('invalid-input');
  const assertSession = privateSessionGuard();
  const kind = resourceType === 'file' ? 'files' : 'folders';
  const rootRef = schoolDoc(db, schoolId, kind, item.id, item.dataMode);
  const root = await getDoc(rootRef);
  if (!root.exists() || root.data().schoolId !== schoolId) throw new Error('permission-denied');
  const children = resourceType === 'folder' ? (await getDocs(query(schoolCollection(db, schoolId, 'files', item.dataMode), where('folderId', '==', item.id)))).docs : [];
  const affected = children.filter(child => action === 'trash' ? !child.data().trashedAt : child.data().trashedWithFolderId === item.id);
  const updates = new Map([[rootRef.path, { ref: rootRef, child: false }], ...affected.map(child => [child.ref.path, { ref: child.ref, child: true }])]);
  const fileDocs = resourceType === 'file' ? [root] : affected;
  for (const file of fileDocs) {
    if (file.data().fileType !== 'gradebook' || !file.data().gradebookId) continue;
    const book = await getDoc(schoolDoc(db, schoolId, 'gradebooks', file.data().gradebookId, 'nested'));
    if (book.exists()) updates.set(book.ref.path, { ref: book.ref, child: resourceType === 'folder' });
  }
  if (updates.size > 450) throw new Error('recycle-bin-too-large');
  assertSession();
  const batch = writeBatch(db);
  for (const { ref, child } of updates.values()) batch.update(ref, action === 'trash' ? {
    trashedAt: serverTimestamp(), trashedBy: actorId, updatedAt: serverTimestamp(),
    ...(child ? { trashedWithFolderId: item.id } : {}),
  } : { trashedAt: deleteField(), trashedBy: deleteField(), trashedWithFolderId: deleteField(), updatedAt: serverTimestamp() });
  await batch.commit();
  return { ok: true };
}
