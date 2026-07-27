#!/usr/bin/env node
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { holidaysForAcademicYear, academicYearIdForHolidayDate } from '../../src/data/holidays.js';

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

const projectId = safeId(readArg('--project'), 'Firebase project ID with --project');
const schoolId = safeId(readArg('--school'), 'school ID with --school');
const academicYearId = safeId(readArg('--academic-year') || 'year_2026_2027', 'academic year ID');
const execute = process.argv.includes('--execute');
const approvedProject = readArg('--approved-project');
const approvalReference = readArg('--approval-reference');
const backupComplete = process.argv.includes('--backup-complete');
const reportPath = resolve(readArg('--report') || 'migration-reports/official-holidays.json');

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

const template = holidaysForAcademicYear(academicYearId);
if (template.length === 0) throw new Error('No reviewed official template exists for this academic year.');
if (template.some(item => item.academicYearId !== academicYearId)) {
  throw new Error('Template contains a mismatched academic year.');
}

if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const targetCollection = db.collection(`holidays_${schoolId}`);
const report = {
  mode: execute ? 'execute' : 'dry-run',
  projectId,
  schoolId,
  academicYearId,
  startedAt: new Date().toISOString(),
  counts: {
    template: template.length,
    existingInYear: 0,
    exactMatches: 0,
    legacyMatches: 0,
    plannedCreates: 0,
    written: 0,
    preservedOtherYears: 0,
    errors: 0,
  },
  errors: [],
};

try {
  const snapshot = await targetCollection.get();
  const existing = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  const inYear = existing.filter(item => (
    (item.academicYearId || academicYearIdForHolidayDate(item.startDate)) === academicYearId
  ));
  report.counts.existingInYear = inYear.length;
  report.counts.preservedOtherYears = existing.length - inYear.length;
  const planned = [];

  for (const holiday of template) {
    const exact = inYear.find(item => item.officialHolidayId === holiday.officialHolidayId);
    if (exact) {
      report.counts.exactMatches += 1;
      continue;
    }
    const legacy = inYear.find(item => item.name === holiday.name && item.startDate === holiday.startDate);
    if (legacy) {
      report.counts.legacyMatches += 1;
      continue;
    }
    planned.push(holiday);
  }

  report.counts.plannedCreates = planned.length;
  if (execute && planned.length > 0) {
    const writer = db.bulkWriter();
    await Promise.all(planned.map(holiday => writer.create(targetCollection.doc(holiday.id), {
      ...holiday,
      schoolId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      importedBy: 'approved-official-holiday-import',
    }).then(() => {
      report.counts.written += 1;
    }).catch(() => {
      report.counts.errors += 1;
      report.errors.push({ code: 'write-failed' });
    })));
    await writer.close();
  }
} catch (error) {
  report.counts.errors += 1;
  report.errors.push({ code: error?.code || 'import-stopped' });
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

process.stdout.write(`${JSON.stringify({ mode: report.mode, counts: report.counts, errors: report.errors.length })}\n`);
if (report.errors.length > 0) process.exitCode = 2;
