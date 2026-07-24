#!/usr/bin/env node
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const projectId = process.argv.find(value => value.startsWith('--project='))?.slice('--project='.length);
const confirmedProject = process.argv.find(value => value.startsWith('--confirm-project='))?.slice('--confirm-project='.length);

if (!projectId) {
  console.error('Usage: npm run migrate:legacy-roles -- --project=<project-id> [--execute --confirm-project=<project-id>]');
  process.exitCode = 1;
} else if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS must point to a credential file outside this repository.');
  process.exitCode = 1;
} else if (execute && confirmedProject !== projectId) {
  console.error('Execution requires an exact --confirm-project value. Dry-run remains the default.');
  process.exitCode = 1;
} else {
  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  const users = await db.collection('users').get();
  const schools = new Set();
  const candidates = [];
  users.docs.forEach(snapshot => {
    const data = snapshot.data();
    const role = data.role;
    if (!['viewer', 'editor'].includes(role)) return;
    const schoolIds = [...new Set([data.schoolId, ...(data.schoolIds || [])].filter(Boolean))];
    schoolIds.forEach(schoolId => {
      schools.add(schoolId);
      candidates.push({ ref: snapshot.ref, userId: snapshot.id, schoolId, role, data });
    });
  });

  let roleDefinitions = 0;
  let assignments = 0;
  let userUpdates = 0;
  if (execute) {
    for (const schoolId of schools) {
      for (const legacyRole of ['viewer', 'editor']) {
        const roleId = `legacy_${legacyRole}`;
        const permissions = legacyRole === 'editor'
          ? { 'students.view': true, 'students.edit': true, 'files.view': true, 'files.create': true, 'tasks.viewOwn': true, 'tasks.create': true }
          : { 'students.view': true, 'files.view': true, 'tasks.viewOwn': true };
        await db.doc(`schools/${schoolId}/roleDefinitions/${roleId}`).set({
          schoolId,
          name: legacyRole === 'editor' ? 'עורך (מעבר)' : 'צופה (מעבר)',
          description: 'תפקיד תאימות זמני שנוצר מהמודל הישן. מומלץ להחליפו בתפקיד ארגוני ייעודי.',
          permissions,
          accessScope: { type: 'school', classIds: [] },
          scopes: { type: 'school', classIds: [] },
          protected: false,
          legacy: true,
          active: true,
          status: 'active',
          delegable: false,
          assignableBy: [],
          version: 1,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        roleDefinitions += 1;
      }
    }
    for (const candidate of candidates) {
      const roleId = `legacy_${candidate.role}`;
      const assignmentsBySchool = candidate.data.customRoleAssignments || {};
      const nextSchoolAssignments = [...new Set([...(assignmentsBySchool[candidate.schoolId] || []), roleId])];
      const nextAssignments = { ...assignmentsBySchool, [candidate.schoolId]: nextSchoolAssignments };
      await candidate.ref.update({
        customRoleAssignments: nextAssignments,
        customRoleIds: [...new Set(Object.values(nextAssignments).flat())],
        legacyRoleMigration: { status: 'assigned', migratedAt: FieldValue.serverTimestamp() },
      });
      await db.doc(`schools/${candidate.schoolId}/roleAssignments/${candidate.userId}_${roleId}`).set({
        schoolId: candidate.schoolId,
        userId: candidate.userId,
        roleId,
        scopeOverrides: {},
        assignedBy: 'migration',
        assignedAt: FieldValue.serverTimestamp(),
        active: true,
      }, { merge: true });
      assignments += 1;
      userUpdates += 1;
    }
  }
  console.log(JSON.stringify({
    mode: execute ? 'execute' : 'dry-run',
    usersScanned: users.size,
    candidateAssignments: candidates.length,
    schools: schools.size,
    roleDefinitions,
    assignments,
    userUpdates,
  }));
}
