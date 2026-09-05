import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

let environment;
before(async () => {
  environment = await initializeTestEnvironment({ projectId: 'demo-zoko-security', firestore: { rules: await readFile('firestore.rules', 'utf8') } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [uid, schoolId] of [['teacher', 'a'], ['other', 'a'], ['outsider', 'b']]) {
      await setDoc(doc(db, 'users', uid), { schoolId, schoolIds: [schoolId], accountStatus: 'active', role: 'viewer', permissions: {} });
    }
    await setDoc(doc(db, 'users', 'manager'), { schoolId: 'a', schoolIds: ['a'], accountStatus: 'active', role: 'principal', permissions: {} });
  });
});
after(async () => { await environment?.cleanup(); });

test('personal agent data is owner-only, including against school administrators', async () => {
  const owner = environment.authenticatedContext('teacher').firestore();
  await assertSucceeds(setDoc(doc(owner, 'zokiAgents/teacher'), { agentId: 'teacher', learningEnabled: true, preferences: [] }));
  for (const uid of ['other', 'outsider', 'manager']) await assertFails(getDoc(doc(environment.authenticatedContext(uid).firestore(), 'zokiAgents/teacher')));
  await assertFails(setDoc(doc(owner, 'zokiAgents/teacher'), { agentId: 'other', learningEnabled: true, preferences: [] }));
});

test('school memory and transcript require current school membership', async () => {
  const db = environment.authenticatedContext('teacher').firestore();
  await assertSucceeds(setDoc(doc(db, 'zokiAgents/teacher/scopes/a'), { memories: [] }));
  await assertFails(setDoc(doc(db, 'zokiAgents/teacher/scopes/b'), { memories: [] }));
  await assertSucceeds(setDoc(doc(db, 'zokiAgents/teacher/conversations/a'), { state: { messages: [] } }));
  await assertFails(setDoc(doc(db, 'zokiAgents/teacher/conversations/b'), { state: null }));
  await assertFails(setDoc(doc(db, 'zokiAgents/teacher/scopes/a'), { memories: Array(101).fill('bad') }));
});

test('only school managers can change the teacher question limit', async () => {
  const path = 'schools/a/settings/zoki_agent';
  await assertFails(setDoc(doc(environment.authenticatedContext('teacher').firestore(), path), { questionsPerMinute: 20 }));
  await assertSucceeds(setDoc(doc(environment.authenticatedContext('manager').firestore(), path), { questionsPerMinute: 4 }));
});
