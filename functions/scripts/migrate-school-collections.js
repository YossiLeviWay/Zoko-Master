#!/usr/bin/env node
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const RESOURCES = Object.freeze([
  { legacy: 'tasks', nested: 'tasks', copyTaskChat: true },
  { legacy: 'students', nested: 'students' },
  { legacy: 'classes', nested: 'classes' },
  { legacy: 'files', nested: 'files' },
  { legacy: 'file_history', nested: 'fileHistory' },
  { legacy: 'folders', nested: 'folders' },
  { legacy: 'teams', nested: 'teams' },
  { legacy: 'events', nested: 'events' },
  { legacy: 'holidays', nested: 'holidays' },
  { legacy: 'categories', nested: 'categories' },
  { legacy: 'roles', nested: 'roles' },
  { legacy: 'tracks', nested: 'tracks' },
  { legacy: 'settings', nested: 'settings' },
  { legacy: 'sheets', nested: 'sheets' },
]);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const projectId = readArg('--project');
const approvedProject = readArg('--approved-project');
const approvalReference = readArg('--approval-reference');
const execute = process.argv.includes('--execute');
const backupAcknowledged = process.argv.includes('--backup-complete');
const reportPath = resolve(readArg('--report') || 'migration-reports/latest.json');

if (!projectId || !/^[a-z0-9-]{4,63}$/.test(projectId)) {
  throw new Error('Provide the exact Firebase project ID with --project.');
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Use GOOGLE_APPLICATION_CREDENTIALS outside the repository, or the Firestore emulator.');
}
if (execute && (
  approvedProject !== projectId
  || !backupAcknowledged
  || !approvalReference
  || approvalReference.length > 120
)) {
  throw new Error('Execution requires matching --approved-project, --backup-complete, and --approval-reference.');
}

if (getApps().length === 0) {
  initializeApp({ credential: applicationDefault(), projectId });
}

const db = getFirestore();
const report = {
  mode: execute ? 'execute' : 'dry-run',
  projectId,
  startedAt: new Date().toISOString(),
  resources: [],
  errors: [],
  totals: { source: 0, targetBefore: 0, copied: 0, skipped: 0, conflicts: 0 },
};

function recordError({ schoolId, resource, code }) {
  report.errors.push({ schoolId, resource, code });
}

async function assertNoAmbiguousLegacyCollections(schoolIds) {
  const collections = await db.listCollections();
  const expected = new Set();
  for (const schoolId of schoolIds) {
    for (const resource of RESOURCES) expected.add(`${resource.legacy}_${schoolId}`);
  }

  const prefixes = RESOURCES.map(resource => `${resource.legacy}_`);
  const ambiguous = collections
    .map(item => item.id)
    .filter(name => prefixes.some(prefix => name.startsWith(prefix)) && !expected.has(name));
  if (ambiguous.length > 0) {
    throw new Error(`Ambiguous legacy school collections detected (${ambiguous.length}); migration stopped.`);
  }
}

async function readPage(collectionRef, after) {
  let query = collectionRef.orderBy(FieldPath.documentId()).limit(400);
  if (after) query = query.startAfter(after);
  return query.get();
}

async function copySubcollection({ sourceParent, targetParent, schoolId, resourceName }) {
  const sourceRef = sourceParent.collection('chat');
  const targetRef = targetParent.collection('chat');
  let after = null;
  let source = 0;
  let copied = 0;
  let skipped = 0;
  let conflicts = 0;

  while (true) {
    const page = await readPage(sourceRef, after);
    if (page.empty) break;
    const targetSnapshots = await db.getAll(...page.docs.map(item => targetRef.doc(item.id)));
    const writer = execute ? db.bulkWriter() : null;
    const writes = [];

    page.docs.forEach((item, index) => {
      source += 1;
      const target = targetSnapshots[index];
      if (target.exists) {
        skipped += 1;
        if (!isDeepStrictEqual(item.data(), target.data())) conflicts += 1;
      } else if (execute) {
        writes.push(writer.create(target.ref, item.data()));
        copied += 1;
      } else {
        copied += 1;
      }
    });
    if (writer) {
      await writer.close();
      await Promise.all(writes);
    }
    after = page.docs.at(-1);
  }

  if (conflicts > 0) recordError({ schoolId, resource: resourceName, code: 'target-conflict' });
  return { source, copied, skipped, conflicts };
}

async function migrateResource(schoolId, resource) {
  const sourceRef = db.collection(`${resource.legacy}_${schoolId}`);
  const targetRef = db.collection(`schools/${schoolId}/${resource.nested}`);
  const sourceCount = (await sourceRef.count().get()).data().count;
  const targetBefore = (await targetRef.count().get()).data().count;
  const stats = {
    schoolId,
    source: resource.legacy,
    target: resource.nested,
    sourceCount,
    targetBefore,
    copied: 0,
    skipped: 0,
    conflicts: 0,
    taskChat: { source: 0, copied: 0, skipped: 0, conflicts: 0 },
  };

  let after = null;
  while (true) {
    const page = await readPage(sourceRef, after);
    if (page.empty) break;
    const targetSnapshots = await db.getAll(...page.docs.map(item => targetRef.doc(item.id)));
    const writer = execute ? db.bulkWriter() : null;
    const writes = [];

    for (let index = 0; index < page.docs.length; index += 1) {
      const sourceDocument = page.docs[index];
      const targetDocument = targetSnapshots[index];
      if (targetDocument.exists) {
        stats.skipped += 1;
        if (!isDeepStrictEqual(sourceDocument.data(), targetDocument.data())) stats.conflicts += 1;
      } else if (execute) {
        writes.push(writer.create(targetDocument.ref, sourceDocument.data()));
        stats.copied += 1;
      } else {
        stats.copied += 1;
      }

      if (resource.copyTaskChat) {
        const chatStats = await copySubcollection({
          sourceParent: sourceDocument.ref,
          targetParent: targetDocument.ref,
          schoolId,
          resourceName: 'tasks.chat',
        });
        for (const key of Object.keys(stats.taskChat)) stats.taskChat[key] += chatStats[key];
      }
    }
    if (writer) {
      await writer.close();
      await Promise.all(writes);
    }
    after = page.docs.at(-1);
  }

  if (stats.conflicts > 0) {
    recordError({ schoolId, resource: resource.legacy, code: 'target-conflict' });
  }
  stats.targetAfter = execute
    ? (await targetRef.count().get()).data().count
    : targetBefore;
  stats.expectedAfter = targetBefore + stats.copied;
  stats.countsMatch = execute
    ? stats.targetAfter === stats.expectedAfter
    : true;
  if (!stats.countsMatch) {
    recordError({ schoolId, resource: resource.legacy, code: 'count-mismatch' });
  }
  return stats;
}

try {
  const schoolsSnapshot = await db.collection('schools').get();
  const schoolIds = schoolsSnapshot.docs.map(item => item.id);
  if (schoolIds.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) {
    throw new Error('A school document has an unsupported identifier; migration stopped.');
  }
  await assertNoAmbiguousLegacyCollections(schoolIds);

  for (const schoolId of schoolIds) {
    for (const resource of RESOURCES) {
      try {
        const stats = await migrateResource(schoolId, resource);
        report.resources.push(stats);
        report.totals.source += stats.sourceCount + stats.taskChat.source;
        report.totals.targetBefore += stats.targetBefore;
        report.totals.copied += stats.copied + stats.taskChat.copied;
        report.totals.skipped += stats.skipped + stats.taskChat.skipped;
        report.totals.conflicts += stats.conflicts + stats.taskChat.conflicts;
      } catch (error) {
        recordError({ schoolId, resource: resource.legacy, code: error?.code || 'migration-error' });
      }
    }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

process.stdout.write(`${JSON.stringify({ mode: report.mode, totals: report.totals, errors: report.errors.length })}\n`);
if (report.errors.length > 0) process.exitCode = 2;
