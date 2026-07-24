#!/usr/bin/env node
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function safeId(value, label) {
  if (!value || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`Provide an explicit ${label}.`);
  return value;
}

const projectId = safeId(readArg('--project'), 'Firebase project ID with --project');
const schoolId = safeId(readArg('--school'), 'school ID with --school');
const mode = readArg('--mode') || 'legacy';
const execute = process.argv.includes('--execute');
const approvedProject = readArg('--approved-project');
const approvalReference = readArg('--approval-reference');
const backupComplete = process.argv.includes('--backup-complete');
const reportPath = resolve(readArg('--report') || 'migration-reports/personal-files.json');

if (!['legacy', 'nested'].includes(mode)) throw new Error('--mode must be legacy or nested.');
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Use GOOGLE_APPLICATION_CREDENTIALS outside the repository, or the Firestore emulator.');
}
if (execute && (approvedProject !== projectId || !backupComplete || !approvalReference || approvalReference.length > 120)) {
  throw new Error('Execution requires matching --approved-project, --backup-complete, and --approval-reference.');
}

if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const studentsPath = mode === 'legacy' ? `students_${schoolId}` : `schools/${schoolId}/students`;
const personalFilesPath = mode === 'legacy' ? `personal_files_${schoolId}` : `schools/${schoolId}/personalFiles`;
const report = {
  mode: execute ? 'execute' : 'dry-run',
  dataMode: mode,
  projectId,
  schoolId,
  startedAt: new Date().toISOString(),
  counts: { students: 0, existing: 0, planned: 0, written: 0, ambiguous: 0, failed: 0 },
  errors: [],
};

function addError(code) {
  report.errors.push({ code });
  report.counts.failed += 1;
}

try {
  const students = await db.collection(studentsPath).get();
  report.counts.students = students.size;
  const validStudents = students.docs.filter(document => {
    if (document.data().schoolId !== schoolId) {
      report.counts.ambiguous += 1;
      return false;
    }
    return true;
  });
  if (report.counts.ambiguous > 0) {
    addError('ambiguous-school-ownership');
    throw new Error('Backfill stopped because one or more student records have ambiguous school ownership.');
  }

  const refs = validStudents.map(document => db.collection(personalFilesPath).doc(document.id));
  const snapshots = refs.length > 0 ? await db.getAll(...refs) : [];
  const missing = validStudents.filter((document, index) => {
    if (snapshots[index].exists) {
      report.counts.existing += 1;
      return false;
    }
    return true;
  });
  report.counts.planned = missing.length;

  if (execute && missing.length > 0) {
    const writer = db.bulkWriter();
    await Promise.all(missing.map(document => writer.create(
      db.collection(personalFilesPath).doc(document.id),
      {
        studentId: document.id,
        schoolId,
        status: 'active',
        createdBy: 'approved-backfill',
        updatedBy: 'approved-backfill',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    ).then(() => { report.counts.written += 1; }).catch(() => addError('write-failed'))));
    await writer.close();
  }
} catch (error) {
  if (report.errors.length === 0) addError(error?.code || 'backfill-stopped');
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

process.stdout.write(`${JSON.stringify({ mode: report.mode, counts: report.counts, errors: report.errors.length })}\n`);
if (report.errors.length > 0) process.exitCode = 2;
