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
  if (!value || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`Provide an explicit ${label}.`);
  }
  return value;
}

function academicYearIdFromLegacy(value) {
  const match = String(value || '').match(/(20\d{2})\D+(20\d{2})/);
  return match ? `year_${match[1]}_${match[2]}` : '';
}

const projectId = safeId(readArg('--project'), 'Firebase project ID with --project');
const schoolId = safeId(readArg('--school'), 'school ID with --school');
const mode = readArg('--mode') || 'legacy';
const execute = process.argv.includes('--execute');
const approvedProject = readArg('--approved-project');
const approvalReference = readArg('--approval-reference');
const backupComplete = process.argv.includes('--backup-complete');
const reportPath = resolve(readArg('--report') || 'migration-reports/student-enrollments.json');

if (!['legacy', 'nested'].includes(mode)) throw new Error('--mode must be legacy or nested.');
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Use GOOGLE_APPLICATION_CREDENTIALS outside the repository, or the Firestore emulator.');
}
if (execute && (
  approvedProject !== projectId
  || !backupComplete
  || !approvalReference
  || approvalReference.length > 120
)) {
  throw new Error('Execution requires matching --approved-project, --backup-complete, and --approval-reference.');
}

if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });

const db = getFirestore();
const prefix = mode === 'legacy' ? '' : `schools/${schoolId}/`;
const studentsPath = mode === 'legacy' ? `students_${schoolId}` : `${prefix}students`;
const classesPath = mode === 'legacy' ? `classes_${schoolId}` : `${prefix}classes`;
const enrollmentsPath = mode === 'legacy'
  ? `student_enrollments_${schoolId}`
  : `${prefix}studentEnrollments`;
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
  const [studentsSnapshot, classesSnapshot] = await Promise.all([
    db.collection(studentsPath).get(),
    db.collection(classesPath).get(),
  ]);
  report.counts.students = studentsSnapshot.size;
  const classes = new Map(classesSnapshot.docs.map(item => [item.id, item.data()]));
  const planned = [];

  for (const studentDocument of studentsSnapshot.docs) {
    const student = studentDocument.data();
    const classItem = classes.get(student.classId);
    const academicYearId = classItem?.academicYearId
      || academicYearIdFromLegacy(classItem?.academicYear || student.academicYear);
    if (!student.classId || !classItem || !academicYearId) {
      report.counts.ambiguous += 1;
      continue;
    }
    const enrollmentId = `${studentDocument.id}__${academicYearId}`;
    planned.push({ studentDocument, student, classItem, academicYearId, enrollmentId });
  }

  if (report.counts.ambiguous > 0) {
    addError('ambiguous-school-year-or-class');
    throw new Error('Backfill stopped because one or more students have an ambiguous class or academic year.');
  }

  const targetRefs = planned.map(item => db.collection(enrollmentsPath).doc(item.enrollmentId));
  const targetSnapshots = targetRefs.length > 0 ? await db.getAll(...targetRefs) : [];
  const missing = planned.filter((item, index) => {
    if (targetSnapshots[index].exists) {
      report.counts.existing += 1;
      return false;
    }
    return true;
  });
  report.counts.planned = missing.length;

  if (execute && missing.length > 0) {
    const writer = db.bulkWriter();
    const writes = missing.map(item => writer.create(
      db.collection(enrollmentsPath).doc(item.enrollmentId),
      {
        studentId: item.studentDocument.id,
        schoolId,
        academicYearId: item.academicYearId,
        academicYearLabel: item.classItem.academicYear || item.student.academicYear || '',
        classId: item.student.classId,
        className: item.classItem.name || item.student.className || '',
        grade: item.classItem.gradeLevel || item.student.gradeLevel || '',
        majorIds: Array.isArray(item.student.trackIds) ? item.student.trackIds : [],
        studyProgramIds: Array.isArray(item.student.programTypes) ? item.student.programTypes : [],
        enrollmentStatus: item.student.status === 'graduated' ? 'graduated' : 'active',
        startDate: item.student.joinedAt || '',
        endDate: item.student.endDate || '',
        exitReason: '',
        displayName: item.student.fullName || '',
        createdBy: 'approved-backfill',
        updatedBy: 'approved-backfill',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    ).then(() => { report.counts.written += 1; }).catch(() => addError('write-failed')));
    await Promise.all(writes);
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
