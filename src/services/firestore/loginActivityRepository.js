import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';

const MAX_VISIBLE_LOGINS = 10;

function loginEntriesPath(schoolId, userId) {
  if (!schoolId || !userId) throw new Error('LOGIN_ACTIVITY_SCOPE_REQUIRED');
  return `schools/${schoolId}/loginActivity/${userId}/entries`;
}

export async function recordSchoolLogin({ db, userId, schoolId }) {
  await addDoc(collection(db, loginEntriesPath(schoolId, userId)), {
    userId,
    schoolId,
    eventType: 'school_login',
    loggedInAt: serverTimestamp(),
    schemaVersion: 1,
  });
}

export async function listRecentSchoolLogins({ db, userId, schoolId }) {
  const snapshot = await getDocs(query(
    collection(db, loginEntriesPath(schoolId, userId)),
    orderBy('loggedInAt', 'desc'),
    limit(MAX_VISIBLE_LOGINS),
  ));
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}
