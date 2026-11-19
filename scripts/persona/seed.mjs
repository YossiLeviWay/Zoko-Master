// Seeds a LOCAL Firebase emulator with a demo school, a principal and a beginner
// teacher so the persona tester can sign in. Refuses to run against anything but
// emulators.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const admin = require('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('Refusing to seed: set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST (emulators only).');
  process.exit(2);
}
const projectId = process.env.GCLOUD_PROJECT || 'demo-zoko-persona';
admin.initializeApp({ projectId });
const db = admin.firestore();
const auth = admin.auth();
const SCHOOL = 'demo-school';
const PASSWORD = 'Persona-Test-1234';

const people = [
  { uid: 'principal-1', email: 'principal@persona.test', name: 'מנהל לדוגמה', role: 'principal' },
  { uid: 'teacher-1', email: 'teacher@persona.test', name: 'מורה מתחיל לדוגמה', role: 'viewer' },
];
for (const person of people) {
  await auth.createUser({ uid: person.uid, email: person.email, password: PASSWORD, emailVerified: true, displayName: person.name }).catch(async error => {
    if (error.code !== 'auth/uid-already-exists' && error.code !== 'auth/email-already-exists') throw error;
  });
  await db.doc(`users/${person.uid}`).set({
    uid: person.uid, email: person.email, name: person.name, displayName: person.name, fullName: person.name, role: person.role,
    rolesBySchool: { [SCHOOL]: person.role }, schoolId: SCHOOL, schoolIds: [SCHOOL], accountStatus: 'active', permissions: {},
  });
  await db.doc(`schools/${SCHOOL}/memberships/${person.uid}`).set({ status: 'active', role: person.role, userId: person.uid });
}
await db.doc(`schools/${SCHOOL}`).set({ name: 'בית ספר לדוגמה', code: 'DEMO', status: 'active' });
await db.doc(`schools/${SCHOOL}/classes/class-10`).set({ name: 'י׳1', grade: 'י', teacherId: 'teacher-1', status: 'active' });
await db.doc(`folders_${SCHOOL}/seed-folder`).set({ name: 'נוכחות', visibility: 'all', allowedUsers: [], allowCreate: [], createdBy: 'מנהל לדוגמה', createdAt: new Date().toISOString() });
console.log(`Seeded school "${SCHOOL}". Test logins (emulator only): teacher@persona.test / principal@persona.test, password ${PASSWORD}`);
