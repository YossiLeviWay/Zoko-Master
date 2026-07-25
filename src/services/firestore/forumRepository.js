import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

export const FORUM_LIMITS = Object.freeze({
  folderName: 60,
  title: 100,
  threadBody: 500,
  replyBody: 400,
  reportReason: 200,
  queryItems: 100,
});

const ROOT = 'platformForum/root';

export function subscribeForumFolders({ db, onData, onError }) {
  return onSnapshot(
    query(
      collection(db, `${ROOT}/folders`),
      where('status', '==', 'active'),
      orderBy('name'),
      limit(FORUM_LIMITS.queryItems),
    ),
    snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    onError,
  );
}

export function subscribeForumThreads({ db, onData, onError }) {
  return onSnapshot(
    query(
      collection(db, `${ROOT}/threads`),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      limit(FORUM_LIMITS.queryItems),
    ),
    snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    onError,
  );
}

export function subscribeForumPosts({ db, threadId, onData, onError }) {
  return onSnapshot(
    query(
      collection(db, `${ROOT}/threads/${threadId}/posts`),
      orderBy('createdAt'),
      limit(FORUM_LIMITS.queryItems),
    ),
    snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    onError,
  );
}

async function publicIdentity({ db, currentUser, userData, selectedSchool, principal, platformAdmin }) {
  const schoolId = platformAdmin
    ? ''
    : selectedSchool || userData?.activeSchoolId || userData?.schoolId || userData?.schoolIds?.[0] || '';
  let schoolName = '';
  if (schoolId) {
    const schoolSnapshot = await getDoc(doc(db, 'schoolPublicDirectory', schoolId));
    schoolName = schoolSnapshot.exists() ? String(schoolSnapshot.data().name || '').slice(0, 120) : '';
  }
  return {
    userId: currentUser.uid,
    fullName: String(userData?.fullName || currentUser.displayName || 'משתמש').trim().slice(0, 120),
    publicRole: platformAdmin ? 'מנהל המערכת' : principal ? 'מנהל מוסד' : 'איש צוות',
    schoolId,
    schoolName,
    avatarUrl: '',
  };
}

export async function createForumFolderSpark({ db, currentUser, name }) {
  const folderRef = doc(collection(db, `${ROOT}/folders`));
  await setDoc(folderRef, {
    name: name.trim(),
    description: '',
    status: 'active',
    writeMode: 'spark-client',
    schemaVersion: 1,
    createdBy: currentUser.uid,
    updatedBy: currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { folderId: folderRef.id };
}

export async function createForumThreadSpark({
  db,
  currentUser,
  userData,
  selectedSchool,
  principal,
  platformAdmin,
  folderId,
  title,
  body,
}) {
  const identity = await publicIdentity({ db, currentUser, userData, selectedSchool, principal, platformAdmin });
  const threadRef = doc(collection(db, `${ROOT}/threads`));
  await setDoc(threadRef, {
    folderId,
    title: title.trim(),
    body: body.trim(),
    attachmentIds: [],
    authorId: currentUser.uid,
    author: identity,
    status: 'active',
    pinned: false,
    locked: false,
    replyCount: 0,
    followers: [],
    writeMode: 'spark-client',
    schemaVersion: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { threadId: threadRef.id };
}

export async function createForumPostSpark({
  db,
  currentUser,
  userData,
  selectedSchool,
  principal,
  platformAdmin,
  threadId,
  body,
}) {
  const identity = await publicIdentity({ db, currentUser, userData, selectedSchool, principal, platformAdmin });
  const postRef = doc(collection(db, `${ROOT}/threads/${threadId}/posts`));
  await setDoc(postRef, {
    threadId,
    body: body.trim(),
    attachmentIds: [],
    authorId: currentUser.uid,
    author: identity,
    status: 'active',
    writeMode: 'spark-client',
    schemaVersion: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { postId: postRef.id };
}

export async function forumContentActionSpark({ db, currentUser, payload }) {
  const threadRef = doc(db, `${ROOT}/threads`, payload.threadId);
  const targetRef = payload.targetType === 'post'
    ? doc(db, `${ROOT}/threads/${payload.threadId}/posts`, payload.postId)
    : threadRef;
  if (payload.action === 'delete') {
    await updateDoc(targetRef, {
      status: 'deleted',
      body: '',
      attachmentIds: [],
      deletedBy: currentUser.uid,
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }
  if (payload.action === 'follow') {
    const snapshot = await getDoc(threadRef);
    const following = (snapshot.data()?.followers || []).includes(currentUser.uid);
    await updateDoc(threadRef, {
      followers: following ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
      updatedAt: serverTimestamp(),
    });
    return;
  }
  if (payload.action === 'pin' || payload.action === 'lock') {
    const snapshot = await getDoc(threadRef);
    const field = payload.action === 'pin' ? 'pinned' : 'locked';
    await updateDoc(threadRef, { [field]: !snapshot.data()?.[field], updatedAt: serverTimestamp() });
    return;
  }
  if (payload.action === 'report') {
    const reportRef = doc(collection(db, `${ROOT}/reports`));
    await setDoc(reportRef, {
      targetType: payload.targetType,
      threadId: payload.threadId,
      postId: payload.postId || '',
      reason: String(payload.reason || '').trim(),
      reportedBy: currentUser.uid,
      status: 'open',
      writeMode: 'spark-client',
      schemaVersion: 1,
      createdAt: serverTimestamp(),
    });
  }
}
