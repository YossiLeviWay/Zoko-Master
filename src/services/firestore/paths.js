import { collection, doc } from 'firebase/firestore';

const RESOURCE_CONFIG = Object.freeze({
  tasks: { legacy: 'tasks' },
  classes: { legacy: 'classes' },
  students: { legacy: 'students' },
  files: { legacy: 'files' },
  fileHistory: { legacy: 'file_history' },
  folders: { legacy: 'folders' },
  teams: { legacy: 'teams' },
  events: { legacy: 'events' },
  holidays: { legacy: 'holidays' },
  categories: { legacy: 'categories' },
  roles: { legacy: 'roles' },
  tracks: { legacy: 'tracks' },
  settings: { legacy: 'settings' },
  sheets: { legacy: 'sheets' },
});

export const SCHOOL_RESOURCES = Object.freeze(Object.keys(RESOURCE_CONFIG));

export function assertSafeId(value, label = 'identifier') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function getDataMode() {
  const mode = import.meta.env.VITE_FIRESTORE_DATA_MODE || 'legacy';
  if (!['legacy', 'nested'].includes(mode)) throw new Error('Invalid Firestore data mode');
  return mode;
}

export function schoolCollectionPath(schoolId, resource, mode = getDataMode()) {
  assertSafeId(schoolId, 'school identifier');
  const config = RESOURCE_CONFIG[resource];
  if (!config) throw new Error('Unsupported school resource');
  return mode === 'nested'
    ? `schools/${schoolId}/${resource}`
    : `${config.legacy}_${schoolId}`;
}

export function schoolCollection(db, schoolId, resource, mode) {
  return collection(db, schoolCollectionPath(schoolId, resource, mode));
}

export function schoolDoc(db, schoolId, resource, documentId, mode) {
  assertSafeId(documentId, 'document identifier');
  return doc(db, schoolCollectionPath(schoolId, resource, mode), documentId);
}

export function schoolSubcollection(db, schoolId, resource, documentId, subcollectionName, mode) {
  assertSafeId(subcollectionName, 'subcollection identifier');
  return collection(schoolDoc(db, schoolId, resource, documentId, mode), subcollectionName);
}
