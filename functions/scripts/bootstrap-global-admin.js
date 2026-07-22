#!/usr/bin/env node
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const uid = readArg('--uid');
const projectId = readArg('--project');
const execute = process.argv.includes('--execute');
const productionAcknowledged = process.argv.includes('--acknowledge-production-risk');

if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
  throw new Error('Provide one explicit Firebase UID with --uid.');
}
if (!projectId || !/^[a-z0-9-]{4,63}$/.test(projectId)) {
  throw new Error('Provide the intended Firebase project ID with --project.');
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error('GOOGLE_APPLICATION_CREDENTIALS must reference a credential file outside this repository.');
}

if (!execute) {
  process.stdout.write('DRY RUN: no claims or Firestore documents were changed. Add --execute only after approval.\n');
  process.exit(0);
}
if (!productionAcknowledged) {
  throw new Error('Execution requires --acknowledge-production-risk after confirming the project and approval.');
}

if (getApps().length === 0) {
  initializeApp({ credential: applicationDefault(), projectId });
}

const auth = getAuth();
const db = getFirestore();
const user = await auth.getUser(uid);
const claims = { ...(user.customClaims || {}), global_admin: true };

await auth.setCustomUserClaims(uid, claims);
await db.collection('users').doc(uid).set({
  uid,
  role: 'global_admin',
  accountStatus: 'active',
  updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });
await db.collection('auditLogs').add({
  actorUid: uid,
  targetUid: uid,
  action: 'global_admin.bootstrap',
  schoolId: null,
  metadata: { source: 'approved-local-script' },
  createdAt: FieldValue.serverTimestamp(),
});

process.stdout.write('Global administrator claim assigned. Revoke existing sessions or refresh the user token before use.\n');
