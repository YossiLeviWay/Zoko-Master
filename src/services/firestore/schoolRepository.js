import {
  addDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { schoolCollection, schoolDoc } from './paths';

function authorizedSchools(access = {}) {
  const ids = new Set(Array.isArray(access.schoolIds) ? access.schoolIds : []);
  if (access.schoolId) ids.add(access.schoolId);
  return ids;
}

export function assertSchoolMembership(access, schoolId) {
  if (!access?.uid) throw new Error('Authenticated access context is required');
  if (access.globalAdmin === true || authorizedSchools(access).has(schoolId)) return;
  throw new Error('School membership is required');
}

export function createSchoolRepository({ db, schoolId, resource, access, mode }) {
  assertSchoolMembership(access, schoolId);
  const collectionRef = schoolCollection(db, schoolId, resource, mode);

  return Object.freeze({
    collectionRef,
    docRef(documentId) {
      return schoolDoc(db, schoolId, resource, documentId, mode);
    },
    async list() {
      const snapshot = await getDocs(collectionRef);
      return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    },
    subscribe(onData, onError) {
      return onSnapshot(
        collectionRef,
        snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
        onError,
      );
    },
    async create(data) {
      return addDoc(collectionRef, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
    async replace(documentId, data) {
      return setDoc(this.docRef(documentId), {
        ...data,
        updatedAt: serverTimestamp(),
      });
    },
    async update(documentId, data) {
      return updateDoc(this.docRef(documentId), {
        ...data,
        updatedAt: serverTimestamp(),
      });
    },
    async remove(documentId) {
      return deleteDoc(this.docRef(documentId));
    },
  });
}

export async function listSchoolResourceWithCompatibility({ db, schoolId, resource, access }) {
  assertSchoolMembership(access, schoolId);
  const readMode = import.meta.env.VITE_FIRESTORE_READ_MODE || 'legacy';
  const modes = readMode === 'dual' ? ['legacy', 'nested'] : [readMode];
  if (modes.some(mode => !['legacy', 'nested'].includes(mode))) {
    throw new Error('Invalid Firestore read mode');
  }

  const snapshots = await Promise.all(
    modes.map(mode => getDocs(schoolCollection(db, schoolId, resource, mode))),
  );
  const merged = new Map();
  snapshots.forEach(snapshot => {
    snapshot.docs.forEach(item => merged.set(item.id, { id: item.id, ...item.data() }));
  });
  return [...merged.values()];
}
