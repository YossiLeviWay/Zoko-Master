import { adminDb } from './firebaseAdmin.js';

// Nested records take precedence, including removal of a previous legacy assignment.
export async function assignedClassesForUser(schoolId, userId) {
  const collections = [adminDb.collection(`classes_${schoolId}`), adminDb.collection(`schools/${schoolId}/classes`)];
  const snapshots = await Promise.all(collections.flatMap(collection => [collection.where('teacherId', '==', userId).get(), collection.where('staffIds', 'array-contains', userId).get()]));
  const classes = new Map(snapshots.flatMap(snapshot => snapshot.docs).map(doc => [doc.id, /** @type {any} */ ({ id: doc.id, ...doc.data() })]));
  if (classes.size) {
    const current = await adminDb.getAll(...[...classes.keys()].map(id => adminDb.doc(`schools/${schoolId}/classes/${id}`)));
    current.filter(doc => doc.exists).forEach(doc => classes.set(doc.id, { id: doc.id, ...doc.data() }));
  }
  return [...classes.values()].filter(item => item.status !== 'archived' && (item.teacherId === userId || item.staffIds?.includes(userId)));
}
