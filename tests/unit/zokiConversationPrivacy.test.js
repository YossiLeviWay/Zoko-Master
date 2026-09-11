import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { invalidatePrivateSession } from '../../src/utils/browserPrivacy.js';

const memory = { currentUser: { uid: 'a' }, reads: [], writes: [], state: null, delay: null };
globalThis.__zokiPrivacyTest = memory;
const mock = `
const state = globalThis.__zokiPrivacyTest;
export const auth = state;
export const db = {};
export const isFirebaseConfigured = true;
export const doc = (_, ...parts) => parts.join('/');
export async function getDocFromServer(path) {
  state.reads.push(path);
  if (path.startsWith('users/')) return { data: () => ({ schoolIds: ['school1','school2'], accountStatus:'active' }) };
  if (path.endsWith('zoki_agent')) return { data: () => ({ questionsPerMinute: 4 }) };
  if (state.delay) await state.delay;
  return { data: () => ({ state: state.state }) };
}
export async function setDoc(path, data) { state.writes.push({path,data}); }
export const runTransaction = () => { throw new Error('unexpected transaction'); };
export const createZokiProvider = () => { throw new Error('No AI request in privacy tests'); };
`;
// Async module loaders work on the project's minimum Node 20 as well as Node 24.
const mockUrl = `data:text/javascript,${encodeURIComponent(mock)}`;
const loader = `export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.endsWith('/src/services/zokiAgentService.js') && ['firebase/firestore', '../firebase.js', './zokiFirebaseProvider.js'].includes(specifier)) {
    return { url: ${JSON.stringify(mockUrl)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const { syncPersonalAgentConversation, reserveZokiQuestion } = await import('../../src/services/zokiAgentService.js');

test('refresh hydration reads only the authorized Firebase conversation; missing copy stays empty', async () => {
  memory.state = { messages: [{ role: 'user', text: 'שם תלמיד וציון' }] };
  const result = await syncPersonalAgentConversation({ schoolId: 'school1', expectedUid: 'a', operation: 'load' });
  assert.deepEqual(result.state, memory.state);
  assert.deepEqual(memory.reads.slice(-2), ['users/a', 'zokiAgents/a/conversations/school1']);
  memory.state = null;
  assert.equal((await syncPersonalAgentConversation({ schoolId: 'school1', operation: 'load' })).state, null);
});

test('conversation save writes only bounded transcript to Firebase, never browser storage', async () => {
  const forbidden = { getItem() { assert.fail('storage read'); }, setItem() { assert.fail('storage write'); } };
  globalThis.localStorage = forbidden;
  globalThis.sessionStorage = forbidden;
  globalThis.indexedDB = { open() { assert.fail('IndexedDB open'); } };
  await syncPersonalAgentConversation({ schoolId: 'school1', expectedUid: 'a', operation: 'save', state: {
    messages: [{ id: '1', role: 'user', text: 'שם תלמיד' }, { id: '2', role: 'zoki', text: 'פרטי ציון', localOnly: true }],
    pendingTask: { title: 'טיוטה' }, taskActionResult: { name: 'שם קובץ' },
  } });
  assert.deepEqual(memory.writes.at(-1), { path: 'zokiAgents/a/conversations/school1', data: { state: { messages: [{ id: '1', role: 'user', text: 'שם תלמיד' }] } } });
  await reserveZokiQuestion('school1');
  await syncPersonalAgentConversation({ schoolId: 'school1', operation: 'end' });
  assert.equal(memory.writes.at(-1).data.state, null);
});

test('late server reads are discarded on a school switch', async () => {
  let release;
  memory.delay = new Promise(resolve => { release = resolve; });
  const promise = syncPersonalAgentConversation({ schoolId: 'school1', expectedUid: 'a', operation: 'load' });
  await new Promise(resolve => setImmediate(resolve));
  invalidatePrivateSession();
  release();
  await assert.rejects(promise, { code: 'session-changed' });
  memory.delay = null;
});

test('an old account cannot save its transcript into a newly logged-in account', async () => {
  memory.currentUser = { uid: 'b' };
  const before = memory.writes.length;
  await assert.rejects(syncPersonalAgentConversation({ schoolId: 'school1', expectedUid: 'a', operation: 'save', state: { messages: [{ text: 'private' }] } }), { code: 'unauthenticated' });
  assert.equal(memory.writes.length, before);
  memory.currentUser = { uid: 'a' };
});
