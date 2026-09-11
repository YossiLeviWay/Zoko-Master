import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { cleanLegacyBrowserData, removeLegacyPrivateStorage, invalidatePrivateSession, privateSessionGuard, subscribePrivateSession } from '../../src/utils/browserPrivacy.js';
import { storeZokiTaskDraft, getZokiTaskDraft } from '../../src/utils/zokiTaskWorkflowBridge.js';

function storage(entries) {
  const data = new Map(entries);
  return { data, get length() { return data.size; }, key: index => [...data.keys()][index],
    getItem() { throw new Error('Private content must not be read'); },
    setItem() { throw new Error('Private content must not be written'); },
    removeItem: key => data.delete(key) };
}

test('startup removes all versions/users/schools of old conversations without reading bodies', () => {
  const local = storage([
    ['zoko-master:zoki-conversation:v1:a:school1', 'שם תלמיד, ציון 90'],
    ['zoko-master:zoki-conversation:v2:b:school2', JSON.stringify({ messages: ['שיחה'], pendingTask: 'משימה', taskActionResult: 'קובץ' })],
    ['zoki-question-window:a:school1', '[123]'], ['zoko-master-theme', 'dark'], ['holidayReligionFilters', '["jewish"]'],
  ]);
  const session = storage([['redirect', '/students?name=private'], ['zoko-master:zoki-conversation:old', 'שיחה']]);
  cleanLegacyBrowserData({ localStorage: local, sessionStorage: session });
  assert.deepEqual([...local.data.keys()], ['zoko-master-theme', 'holidayReligionFilters']);
  assert.equal(session.data.size, 0);
  cleanLegacyBrowserData({ localStorage: local, sessionStorage: session });
  assert.equal(local.data.get('zoko-master-theme'), 'dark');
});

test('privacy cleanup tolerates blocked storage and individual removal failures', () => {
  assert.doesNotThrow(() => cleanLegacyBrowserData({ get localStorage() { throw new Error('denied'); } }));
  const removed = [];
  removeLegacyPrivateStorage({ length: 2, key: index => `zoko-master:zoki-conversation:${index}`, removeItem(key) { if (key.endsWith('0')) throw new Error('denied'); removed.push(key); } });
  assert.equal(removed.length, 1);
});

test('logout/school boundary synchronously clears private drafts and rejects stale requests', () => {
  const id = storeZokiTaskDraft('school1', { messages: ['פרטי תלמיד'], proposal: { title: 'משימה' } });
  assert.equal(getZokiTaskDraft(id, 'school2'), null);
  assert.ok(getZokiTaskDraft(id, 'school1'));
  const guard = privateSessionGuard();
  let calls = 0;
  const unsubscribe = subscribePrivateSession(() => calls++);
  invalidatePrivateSession();
  assert.equal(calls, 1);
  assert.equal(getZokiTaskDraft(id, 'school1'), null);
  assert.throws(guard, { code: 'session-changed' });
  assert.doesNotThrow(privateSessionGuard());
  unsubscribe();
});

const source = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
function files(path) {
  return readdirSync(new URL(`../../${path}`, import.meta.url), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${path}/${entry.name}`) : /\.(js|jsx|html)$/.test(entry.name) ? [`${path}/${entry.name}`] : []);
}

test('browser storage writers remain limited to nonpersonal display preferences', () => {
  const writers = files('src').concat(files('public')).filter(file => /(?:localStorage|sessionStorage)\s*(?:\.setItem\s*\(|\.[\w]+\s*=|\[[^\]]+\]\s*=)/.test(source(file)));
  assert.deepEqual(writers.sort(), ['src/components/Holidays/HolidayManager.jsx', 'src/hooks/useThemeMode.js']);
  for (const file of files('src')) {
    assert.doesNotMatch(source(file), /indexedDB\.open|enableIndexedDbPersistence|persistentLocalCache|getAnalytics\(|logEvent\(|captureException\(/);
  }
  assert.match(source('src/firebase.js'), /setPersistence\(auth, inMemoryPersistence\)/);
  assert.match(source('src/firebase.js'), /localCache: memoryLocalCache\(\)/);
  assert.match(source('src/main.jsx'), /authPrivacyReady\.then/);
  assert.doesNotMatch(source('src/components/Zoki/ZokiPage.jsx'), /localStorage|sessionStorage/);
  assert.doesNotMatch(source('src/services/zokiAgentService.js'), /localStorage|sessionStorage/);
  assert.doesNotMatch(source('src/components/Zoki/ZokiPage.jsx'), /state:\s*\{\s*zokiTask(?:Workflow|Draft):/);
});

test('errors and AI diagnostics do not echo provider error bodies or task content', () => {
  assert.doesNotMatch(source('src/components/Tasks/TaskWorkspace.jsx'), /setError\(err(?:or)?\.message/);
  assert.doesNotMatch(source('src/components/Zoki/ZokiPage.jsx'), /actionError:\s*error\.message/);
  assert.doesNotMatch(source('src/services/zokiFirebaseProvider.js'), /console\.(?:warn|error)\([^;]*error\./);
  assert.doesNotMatch(source('functions/src/callables/taskPatterns.js'), /logger\.[^;]*error\?\.message/);
});
