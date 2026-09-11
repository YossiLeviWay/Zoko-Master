import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import assert from 'node:assert/strict';
import { sparkWorkspaceAction } from '../../src/services/firestore/sparkTaskWorkspaceRepository.js';
let env;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-zoko-security',firestore:{rules:await readFile('firestore.rules','utf8')}});await env.clearFirestore();await env.withSecurityRulesDisabled(async context=>{const db=context.firestore();for(const uid of ['alice','bob','manager'])await setDoc(doc(db,'users',uid),{schoolId:'a',schoolIds:['a'],accountStatus:'active',role:uid==='manager'?'principal':'viewer',permissions:{}});await setDoc(doc(db,'schools/a/taskLists/private'),{ownerId:'alice',memberIds:['alice'],kind:'personal'});await setDoc(doc(db,'schools/a/tasks/shared'),{schoolId:'a',createdBy:'alice',scope:'assigned',assigneeType:'individual',assigneeIds:['alice','bob'],participantIds:['alice','bob'],assignmentVersion:2,status:'todo'});});});
after(async()=>env?.cleanup());
test('personal list and preferences remain private against manager',async()=>{const alice=env.authenticatedContext('alice').firestore(),manager=env.authenticatedContext('manager').firestore();await assertSucceeds(getDoc(doc(alice,'schools/a/taskLists/private')));await assertFails(getDoc(doc(manager,'schools/a/taskLists/private')));await assertSucceeds(setDoc(doc(alice,'users/alice/taskBoardPreferences/a'),{pins:{x:true}}));await assertFails(getDoc(doc(manager,'users/alice/taskBoardPreferences/a')));});
test('v2 status and assignments are server-owned even for principal',async()=>{for(const uid of ['alice','bob','manager']){const db=env.authenticatedContext(uid).firestore();await assertSucceeds(getDoc(doc(db,'schools/a/tasks/shared')));await assertFails(updateDoc(doc(db,'schools/a/tasks/shared'),{status:'done'}));await assertFails(updateDoc(doc(db,'schools/a/tasks/shared'),{assigneeIds:['alice']}));}});
test('list membership cannot be self granted',async()=>{await assertFails(updateDoc(doc(env.authenticatedContext('bob').firestore(),'schools/a/taskLists/private'),{memberIds:['alice','bob']}));});

test('Spark creates private lists and tasks without Functions; retry does not duplicate', async () => {
  const db = env.authenticatedContext('alice').firestore();
  const context = { db, schoolId: 'a', user: { uid: 'alice', fullName: 'בדיקה' }, tasks: [] };
  const { listId } = await sparkWorkspaceAction({ ...context, input: { operation: 'list', requestId: 'list-once', name: 'רשימה פרטית' } });
  const input = { operation: 'create', requestId: 'private-once', listId, titles: ['משימה פרטית'] };
  const result = await sparkWorkspaceAction({ ...context, input });
  assert.deepEqual(await sparkWorkspaceAction({ ...context, input }), result);
  const preferences = (await getDoc(doc(db, 'users/alice/taskBoardPreferences/a'))).data();
  assert.equal(preferences.placements[`personal:${result.taskIds[0]}`], listId);
  const taskRef = doc(db, 'users/alice/personalTasks', result.taskIds[0]);
  assert.equal((await getDoc(taskRef)).data().title, 'משימה פרטית');
  await assertFails(getDoc(doc(env.authenticatedContext('manager').firestore(), 'users/alice/personalTasks', result.taskIds[0])));
  await assert.rejects(sparkWorkspaceAction({ ...context, input: { operation: 'create', requestId: 'no-team', titles: ['לא ליצור'], teamId: 'team' } }), /shared-action-paused/);
  await assert.rejects(sparkWorkspaceAction({ ...context, input: { operation: 'invite', listId } }), /shared-action-paused/);
});
