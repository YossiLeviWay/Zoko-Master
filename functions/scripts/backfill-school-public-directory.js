#!/usr/bin/env node
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const projectArgument = process.argv.find(argument => argument.startsWith('--project='));
const projectId = projectArgument?.slice('--project='.length);

if (!projectId) {
  console.error('Usage: npm run backfill:school-directory -- --project=<firebase-project-id> [--execute]');
  process.exitCode = 1;
} else if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS must point to a credential file outside this repository.');
  process.exitCode = 1;
} else {
  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  const schools = await db.collection('schools').get();
  let missing = 0;
  let updated = 0;
  for (const school of schools.docs) {
    const data = school.data();
    const target = db.collection('schoolPublicDirectory').doc(school.id);
    if (!(await target.get()).exists) missing += 1;
    if (execute) {
      await target.set({
        schoolId: school.id,
        name: String(data.name || '').trim(),
        code: String(data.code || school.id),
        status: data.status === 'disabled' ? 'disabled' : 'active',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      updated += 1;
    }
  }
  console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', schools: schools.size, missing, updated }));
}
