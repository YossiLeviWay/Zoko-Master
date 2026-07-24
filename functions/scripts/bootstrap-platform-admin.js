#!/usr/bin/env node
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const uid = argument('--uid');
const projectId = argument('--project');
const execute = process.argv.includes('--execute');
const productionAcknowledged = process.argv.includes('--acknowledge-production-risk');

if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Provide one explicit Firebase UID with --uid.');
if (!projectId || !/^[a-z0-9-]{4,63}$/.test(projectId)) throw new Error('Provide the intended Firebase project ID with --project.');
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('GOOGLE_APPLICATION_CREDENTIALS must reference a credential file outside this repository.');

if (!execute) {
  process.stdout.write('DRY RUN: no platform_admin claim or Firestore document was changed.\n');
  process.exit(0);
}
if (!productionAcknowledged) throw new Error('Execution requires --acknowledge-production-risk after explicit approval.');

if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
const db = getFirestore();
const user = await auth.getUser(uid);
await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), platform_admin: true });
await db.collection('users').doc(uid).set({ uid, role: 'platform_admin', accountStatus: 'active', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
await db.collection('auditLogs').add({ actorUid: uid, targetUid: uid, action: 'platform_admin.bootstrap', schoolId: null, metadata: { source: 'approved-local-script' }, createdAt: FieldValue.serverTimestamp() });
process.stdout.write('Platform administrator claim assigned. Revoke existing sessions or refresh the ID token before use.\n');
