import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId:'demo-zoko-bridge-gate', firestore:{rules:await readFile('scripts/codex-pilot/privacy-gate.rules','utf8')} });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    for (const uid of ['owner','colleague']) await setDoc(doc(context.firestore(),'users',uid),{role:'principal',schoolId:'school',accountStatus:'active'});
  });
});
after(async()=>env?.cleanup());
const db = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
test('live compatibility gate isolates all bridge records to the institution owner', async () => {
  const paths=['users/owner/zokiPilot/school','users/owner/zokiPilot/school/state/bridge','users/owner/zokiPilot/school/state/relayRequest','users/owner/zokiPilot/school/transportChunks/example','users/owner/zokiPilot/school/proposals/example'];
  for(const path of paths) {
    await assertSucceeds(setDoc(doc(db('owner'),path),{synthetic:true}));
    for(const uid of ['colleague',null]) {
      await assertFails(getDoc(doc(db(uid),path)));
      await assertFails(setDoc(doc(db(uid),path),{synthetic:true}));
    }
  }
  await assertFails(getDocs(collection(db('colleague'),'users/owner/zokiPilot/school/transportChunks')));
  await assertFails(setDoc(doc(db('owner'),'users/owner/zokiPilot/another/state/bridge'),{}));
});
test('disabling the owner immediately blocks the private mailbox', async () => {
  await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'users/owner'),{role:'principal',schoolId:'school',accountStatus:'disabled'}));
  await assertFails(getDoc(doc(db('owner'),'users/owner/zokiPilot/school/state/bridge')));
});
test('the narrow gate preserves unrelated existing paths without granting anonymous access', async () => {
  for(const path of ['events_school/event','users/colleague','schools/school/tasks/task','users/owner/preferences/view']) {
    await assertSucceeds(setDoc(doc(db('colleague'),path),{synthetic:true}));
    await assertFails(getDoc(doc(db(null),path)));
  }
});
