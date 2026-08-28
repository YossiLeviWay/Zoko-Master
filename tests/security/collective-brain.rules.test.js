import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-zoko-security';
const SCHOOL_A = 'school_a';
const SCHOOL_B = 'school_b';
const BOARD_PATH = `schools/${SCHOOL_A}/collectiveBrainBoards/board_a`;
let environment;

function context(uid) {
  return environment.authenticatedContext(uid);
}

function user(uid, schoolId, extra = {}) {
  return {
    uid,
    fullName: uid === 'member_a' ? 'חבר א' : uid,
    schoolId,
    schoolIds: [schoolId],
    role: 'viewer',
    permissions: {},
    accountStatus: 'active',
    ...extra,
  };
}

function board(status = 'open', extra = {}) {
  const now = Timestamp.fromDate(new Date('2026-08-28T08:00:00Z'));
  return {
    schoolId: SCHOOL_A,
    question: 'מה למדנו השבוע?',
    description: '',
    status,
    schemaVersion: 2,
    audienceMode: 'school',
    audienceUserIds: [],
    audienceTeamIds: [],
    visibility: 'private',
    publicShareId: '',
    maxResponsesPerUser: 1,
    responseSlots: ['1'],
    linkedTaskIds: [],
    createdBy: 'manager_a',
    createdAt: now,
    updatedBy: 'manager_a',
    updatedAt: now,
    archivedBy: status === 'archived' ? 'manager_a' : '',
    archivedAt: status === 'archived' ? now : null,
    deletedBy: status === 'deleted' ? 'manager_a' : '',
    deletedAt: status === 'deleted' ? now : null,
    ...extra,
  };
}

function response(authorId = 'member_a', responseIndex = 1) {
  const now = Timestamp.fromDate(new Date('2026-08-28T08:05:00Z'));
  return {
    schoolId: SCHOOL_A,
    boardId: 'board_a',
    authorId,
    authorName: authorId === 'member_a' ? 'חבר א' : authorId,
    responseSlot: String(responseIndex),
    body: 'תשובה מקורית',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    editedAt: null,
    moderatedBy: '',
    moderatedAt: null,
    deletedBy: '',
    deletedAt: null,
  };
}

async function seed(entries) {
  await environment.withSecurityRulesDisabled(async disabled => {
    await Promise.all(Object.entries(entries).map(([path, data]) => setDoc(doc(disabled.firestore(), path), data)));
  });
}

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await seed({
    'users/member_a': user('member_a', SCHOOL_A),
    'users/member_b': user('member_b', SCHOOL_A),
    'users/outsider_b': user('outsider_b', SCHOOL_B),
    'users/manager_a': user('manager_a', SCHOOL_A, { permissions: { 'collectiveBrain.manage': true } }),
    [BOARD_PATH]: board(),
  });
});

after(async () => environment?.cleanup());

test('active school members can read their board but another school cannot', async () => {
  await assertSucceeds(getDoc(doc(context('member_a').firestore(), BOARD_PATH)));
  await assertFails(getDoc(doc(context('outsider_b').firestore(), BOARD_PATH)));
});

test('a restricted board is readable only by its explicit audience and managers', async () => {
  await seed({ [BOARD_PATH]: board('open', { audienceMode: 'restricted', audienceUserIds: ['member_a'] }) });
  await assertSucceeds(getDoc(doc(context('member_a').firestore(), BOARD_PATH)));
  await assertFails(getDoc(doc(context('member_b').firestore(), BOARD_PATH)));
  await assertSucceeds(getDoc(doc(context('manager_a').firestore(), BOARD_PATH)));
});

test('restricted board queries must include the current member in the audience constraint', async () => {
  await seed({ [BOARD_PATH]: board('open', { audienceMode: 'restricted', audienceUserIds: ['member_a'] }) });
  const memberDb = context('member_a').firestore();
  await assertSucceeds(getDocs(query(
    collection(memberDb, `schools/${SCHOOL_A}/collectiveBrainBoards`),
    where('status', '==', 'open'),
    where('audienceUserIds', 'array-contains', 'member_a'),
  )));
});

test('member list queries are constrained to visible board and response statuses', async () => {
  const memberDb = context('member_a').firestore();
  await seed({ [`${BOARD_PATH}/responses/member_a`]: response('member_a') });
  await assertSucceeds(getDocs(query(
    collection(memberDb, `schools/${SCHOOL_A}/collectiveBrainBoards`),
    where('status', '==', 'open'),
  )));
  await assertSucceeds(getDocs(query(
    collection(memberDb, `${BOARD_PATH}/responses`),
    where('status', '==', 'active'),
  )));
  await assertFails(getDocs(collection(memberDb, `schools/${SCHOOL_A}/collectiveBrainBoards`)));
  await assertFails(getDocs(collection(memberDb, `${BOARD_PATH}/responses`)));
});

test('deleted boards are visible only to a brain manager', async () => {
  await seed({ [BOARD_PATH]: board('deleted') });
  await assertFails(getDoc(doc(context('member_a').firestore(), BOARD_PATH)));
  await assertSucceeds(getDoc(doc(context('manager_a').firestore(), BOARD_PATH)));
});

test('only a brain manager can create a board', async () => {
  const payload = {
    schoolId: SCHOOL_A,
    question: 'שאלה חדשה',
    description: '',
    status: 'open',
    schemaVersion: 2,
    audienceMode: 'school', audienceUserIds: [], audienceTeamIds: [],
    visibility: 'private', publicShareId: '', maxResponsesPerUser: 1, responseSlots: ['1'], linkedTaskIds: [],
    createdBy: 'manager_a',
    createdAt: serverTimestamp(),
    updatedBy: 'manager_a',
    updatedAt: serverTimestamp(),
    archivedBy: '', archivedAt: null, deletedBy: '', deletedAt: null,
  };
  await assertSucceeds(setDoc(doc(context('manager_a').firestore(), `schools/${SCHOOL_A}/collectiveBrainBoards/new_board`), payload));
  await assertFails(setDoc(doc(context('member_a').firestore(), `schools/${SCHOOL_A}/collectiveBrainBoards/member_board`), { ...payload, createdBy: 'member_a', updatedBy: 'member_a' }));
});

test('a member creates only the configured number of responses in deterministic slots', async () => {
  const ownPath = `${BOARD_PATH}/responses/member_a_1`;
  const payload = {
    ...response('member_a'),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(doc(context('member_a').firestore(), ownPath), payload));
  await assertFails(setDoc(doc(context('member_a').firestore(), `${BOARD_PATH}/responses/another_id`), payload));
  await assertFails(setDoc(doc(context('member_a').firestore(), ownPath), { ...payload, body: 'תשובה נוספת' }));
  await assertFails(setDoc(doc(context('member_a').firestore(), `${BOARD_PATH}/responses/member_a_2`), { ...payload, responseSlot: '2' }));
  await seed({ [BOARD_PATH]: board('open', { maxResponsesPerUser: 2, responseSlots: ['1', '2'] }) });
  await assertSucceeds(setDoc(doc(context('member_a').firestore(), `${BOARD_PATH}/responses/member_a_2`), { ...payload, responseSlot: '2' }));
});

test('a member edits only their body while a board is open', async () => {
  const ownPath = `${BOARD_PATH}/responses/member_a_1`;
  await seed({ [ownPath]: response('member_a') });
  await assertSucceeds(updateDoc(doc(context('member_a').firestore(), ownPath), {
    body: 'תשובה מעודכנת', updatedAt: serverTimestamp(), editedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(context('member_a').firestore(), ownPath), {
    authorName: 'שם אחר', updatedAt: serverTimestamp(), editedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(context('member_a').firestore(), ownPath), {
    status: 'deleted', deletedBy: 'member_a', deletedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('members cannot edit another response and cannot edit after closure', async () => {
  const otherPath = `${BOARD_PATH}/responses/member_b_1`;
  const ownPath = `${BOARD_PATH}/responses/member_a_1`;
  await seed({ [otherPath]: response('member_b'), [ownPath]: response('member_a') });
  await assertFails(updateDoc(doc(context('member_a').firestore(), otherPath), {
    body: 'שינוי אסור', updatedAt: serverTimestamp(), editedAt: serverTimestamp(),
  }));
  await seed({ [BOARD_PATH]: board('closed') });
  await assertFails(updateDoc(doc(context('member_a').firestore(), ownPath), {
    body: 'מאוחר מדי', updatedAt: serverTimestamp(), editedAt: serverTimestamp(),
  }));
});

test('a brain manager can moderate, soft-delete and restore a response', async () => {
  const ownPath = `${BOARD_PATH}/responses/member_a_1`;
  await seed({ [ownPath]: response('member_a') });
  const managerDb = context('manager_a').firestore();
  await assertSucceeds(updateDoc(doc(managerDb, ownPath), {
    body: 'נוסח מתוקן', updatedAt: serverTimestamp(), editedAt: serverTimestamp(),
    moderatedBy: 'manager_a', moderatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(managerDb, ownPath), {
    status: 'deleted', deletedBy: 'manager_a', deletedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(getDoc(doc(context('member_a').firestore(), ownPath)));
  await assertSucceeds(updateDoc(doc(managerDb, ownPath), {
    status: 'active', deletedBy: '', deletedAt: null, updatedAt: serverTimestamp(),
    moderatedBy: 'manager_a', moderatedAt: serverTimestamp(),
  }));
});
