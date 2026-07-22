#!/usr/bin/env node
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const SENSITIVE_FIELDS = ['_authPassword', '_pendingPassword'];
const args = new Set(process.argv.slice(2));
const projectArgIndex = process.argv.indexOf('--project');
const projectId = projectArgIndex >= 0 ? process.argv[projectArgIndex + 1] : '';
const execute = args.has('--execute');

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!projectId || !/^[a-z0-9-]{6,30}$/.test(projectId)) {
  fail('Pass an explicit Firebase project with --project <project-id>.');
} else if (execute && !args.has('--confirm-production')) {
  fail('Writing requires both --execute and --confirm-production after an approved backup.');
} else if (execute && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  fail('GOOGLE_APPLICATION_CREDENTIALS must reference a credential file outside this repository.');
} else {
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId });
  }
  const db = getFirestore();
  const snapshot = await db.collection('users').get();
  let affectedDocuments = 0;
  let sensitiveFieldCount = 0;
  const affectedRefs = [];

  snapshot.docs.forEach(document => {
    const data = document.data();
    const present = SENSITIVE_FIELDS.filter(field => Object.hasOwn(data, field));
    if (present.length === 0) return;
    affectedDocuments += 1;
    sensitiveFieldCount += present.length;
    affectedRefs.push(document.ref);
  });

  console.info(JSON.stringify({
    mode: execute ? 'execute' : 'dry-run',
    scannedDocuments: snapshot.size,
    affectedDocuments,
    sensitiveFieldCount,
  }));

  if (execute) {
    for (let offset = 0; offset < affectedRefs.length; offset += 400) {
      const batch = db.batch();
      affectedRefs.slice(offset, offset + 400).forEach(ref => {
        batch.update(ref, Object.fromEntries(
          SENSITIVE_FIELDS.map(field => [field, FieldValue.delete()]),
        ));
      });
      await batch.commit();
    }
    console.info(JSON.stringify({ updatedDocuments: affectedDocuments }));
  }
}
