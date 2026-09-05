import { doc, getDocFromServer, runTransaction, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../firebase.js';
import { schoolCollectionPath } from './firestore/paths.js';
import { mergeMemories, normalizeMemories, selectRelevantMemories, validSourcePath, zokiContextFields, isSafeMemoryText } from '../utils/zokiMemory.js';
import { createZokiProvider } from './zokiFirebaseProvider.js';

export const isZokiAgentConfigured = isFirebaseConfigured;
export function zokiSourcePaths({ schoolId, uid, question, sources }) {
  const terms = question.split(/\s+/u).filter(word => word.length > 2);
  const intent = /משימ|דחופ|דחוף|השבוע|לעשות/u.test(question) ? 'tasks'
    : /תלמיד|לומד/u.test(question) ? 'students' : /צוות/u.test(question) ? 'teams' : /כיתה/u.test(question) ? 'classes' : /אירוע|מחר|היום/u.test(question) ? 'events' : '';
  return ['tasks', 'teams', 'classes', 'students', 'events', 'roles', 'initiatives'].flatMap(type => (sources[type] || []).map(item => ({ type, item,
    score: (type === intent ? 100 : 0) + terms.filter(word => `${item.title || ''} ${item.name || ''} ${item.fullName || ''}`.includes(word)).length * 10,
  }))).sort((a, b) => b.score - a.score || String(a.item.dueDate || '9999').localeCompare(String(b.item.dueDate || '9999'))).slice(0, 12).flatMap(({ type, item }) => {
    if (!/^[\w-]{1,128}$/u.test(item.id || '')) return [];
    if (type === 'tasks' && item._storageMode === 'personal') return [`users/${uid}/personalTasks/${item.id}`];
    const mode = ['legacy', 'nested'].includes(item._storageMode) ? item._storageMode : undefined;
    return [`${schoolCollectionPath(schoolId, type, mode)}/${item.id}`];
  });
}
const fail = (code, retryAfter = 0) => Object.assign(new Error(code), { code, retryAfter });
const safeId = value => typeof value === 'string' && /^[\w-]{1,128}$/u.test(value);
const localWindows = new Map();

async function actorFor(schoolId) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw fail('unauthenticated');
  if (!safeId(schoolId)) throw fail('invalid-input');
  const data = (await getDocFromServer(doc(db, 'users', uid))).data();
  if (!data || (data.accountStatus && data.accountStatus !== 'active') || ![data.schoolId, ...(data.schoolIds || [])].includes(schoolId)) throw fail('permission-denied');
  return { uid, data, role: data.rolesBySchool?.[schoolId] || data.role || 'viewer' };
}

// UX throttling only. Google's AI Logic quota is the authoritative shared limit.
export async function reserveZokiQuestion(schoolId, knownActor) {
  const actor = knownActor || await actorFor(schoolId);
  const value = (await getDocFromServer(doc(db, 'schools', schoolId, 'settings', 'zoki_agent'))).data()?.questionsPerMinute;
  const limit = Number.isInteger(value) && value >= 1 && value <= 20 ? value : 4;
  const key = `zoki-question-window:${actor.uid}:${schoolId}`;
  const reserve = () => {
    const now = Date.now();
    let times = localWindows.get(key) || [];
    try { const stored = JSON.parse(localStorage.getItem(key) || 'null'); if (Array.isArray(stored)) times = stored; } catch { /* Keep session limit. */ }
    times = times.filter(at => Number.isFinite(at) && at > now - 60000 && at <= now);
    if (times.length >= limit) throw fail('resource-exhausted', Math.max(1, Math.ceil((Math.min(...times) + 60000 - now) / 1000)));
    times.push(now); localWindows.set(key, times);
    try { localStorage.setItem(key, JSON.stringify(times)); } catch { /* Keep session limit. */ }
  };
  if (globalThis.navigator?.locks) await navigator.locks.request(key, reserve);
  else reserve();
}

export async function syncPersonalAgentConversation(input) {
  const actor = await actorFor(input.schoolId);
  const ref = doc(db, 'zokiAgents', actor.uid, 'conversations', input.schoolId);
  if (input.operation === 'load') return { state: (await getDocFromServer(ref)).data()?.state || null };
  const messages = input.state?.messages?.slice(-12).map(item => ({ id: item.id, role: item.role, text: item.text.slice(0, 1500) })) || [];
  await setDoc(ref, { state: input.operation === 'end' ? null : { messages } });
  return { saved: true };
}

// Compatibility interface for the settings UI: these are Firebase SDK operations.
export async function zokiRequest(path, schoolId, body = {}, method = 'POST', offset = 0) {
  const actor = await actorFor(schoolId);
  const rootRef = doc(db, 'zokiAgents', actor.uid);
  const scopeRef = doc(rootRef, 'scopes', schoolId);
  const assertSession = () => { if (auth.currentUser?.uid !== actor.uid) throw fail('unauthenticated'); };
  if (path === 'admin/settings') {
    if (!['principal', 'institution_manager'].includes(actor.role)) throw fail('permission-denied');
    const ref = doc(db, 'schools', schoolId, 'settings', 'zoki_agent');
    if (method === 'GET') return { questionsPerMinute: (await getDocFromServer(ref)).data()?.questionsPerMinute || 4 };
    if (!Number.isInteger(body.questionsPerMinute) || body.questionsPerMinute < 1 || body.questionsPerMinute > 20) throw fail('invalid-input');
    assertSession();
    await setDoc(ref, { questionsPerMinute: body.questionsPerMinute, updatedAt: new Date().toISOString() });
    return { saved: true };
  }
  const [root, scope] = await Promise.all([getDocFromServer(rootRef), getDocFromServer(scopeRef)]);
  const profile = { agentId: actor.uid, learningEnabled: true, preferences: [], ...root.data() };
  const memories = normalizeMemories(scope.data()?.memories);
  const cache = new Map();
  const readSource = sourcePath => {
    if (!validSourcePath(sourcePath, schoolId, actor.uid)) return Promise.reject(fail('permission-denied'));
    if (!cache.has(sourcePath)) cache.set(sourcePath, getDocFromServer(doc(db, sourcePath)).then(snapshot => {
      const data = snapshot.data();
      if (!data || (data.schoolId && data.schoolId !== schoolId)) throw fail('permission-denied');
      return data;
    }));
    return cache.get(sourcePath);
  };
  const authorized = async memory => {
    if (memory.expiresAt && Date.parse(memory.expiresAt) <= Date.now()) return false;
    try { await Promise.all(memory.refs.map(readSource)); return true; } catch { return false; }
  };
  if (path === 'profile') {
    if (method === 'GET') {
      const page = memories.slice().reverse().slice(offset, offset + 8);
      const checks = await Promise.all(page.map(authorized));
      return { ...profile, memories: page.filter((_, index) => checks[index]), nextOffset: offset + 8 < memories.length ? offset + 8 : null };
    }
    if (body.operation === 'learning' || body.operation === 'preferences') {
      if (body.operation === 'learning' && typeof body.enabled !== 'boolean') throw fail('invalid-input');
      const content = typeof body.content === 'string' ? body.content.trim().slice(0, 600) : '';
      if (!isSafeMemoryText(content)) throw fail('invalid-input');
      assertSession();
      await runTransaction(db, async transaction => {
        const current = await transaction.get(rootRef);
        transaction.set(rootRef, { agentId: actor.uid, learningEnabled: true, preferences: [], ...current.data(),
          ...(body.operation === 'learning' ? { learningEnabled: body.enabled } : { preferences: content ? [content] : [] }),
        });
      });
    } else {
      if (!['edit', 'delete', 'clear'].includes(body.operation)) throw fail('invalid-input');
      const found = memories.find(item => item.id === body.id);
      if (body.operation !== 'clear' && (!found || !(await authorized(found)))) throw fail('permission-denied');
      const content = typeof body.content === 'string' ? body.content.trim().slice(0, 600) : '';
      if (body.operation === 'edit' && (!content || !isSafeMemoryText(content))) throw fail('invalid-input');
      assertSession();
      await runTransaction(db, async transaction => {
        const current = await transaction.get(scopeRef);
        const latest = normalizeMemories(current.data()?.memories);
        transaction.set(scopeRef, { memories: body.operation === 'clear' ? [] : latest.flatMap(item => item.id !== body.id ? [item] : body.operation === 'delete' ? [] : [{ ...item, content, updatedAt: new Date().toISOString() }]) });
      });
    }
    return { saved: true };
  }
  if (path !== 'turn' || typeof body.question !== 'string' || body.question.trim().length < 2 || body.question.length > 2000) throw fail('invalid-input');
  await reserveZokiQuestion(schoolId, actor);
  const singleSchool = new Set([actor.data.schoolId, ...(actor.data.schoolIds || [])].filter(Boolean)).size === 1;
  const ids = (key, legacy) => (actor.data[key]?.[schoolId] || (singleSchool ? actor.data[legacy] : []) || []).filter(safeId).slice(0, 2);
  const assigned = [
    ...ids('teamIdsBySchool', 'teamIds').map(id => `${schoolCollectionPath(schoolId, 'teams')}/${id}`),
    ...ids('classIdsBySchool', 'classIds').map(id => `${schoolCollectionPath(schoolId, 'classes')}/${id}`),
    ...ids('customRoleAssignments', 'customRoleIds').map(id => `${schoolCollectionPath(schoolId, 'roles')}/${id}`),
  ];
  const paths = [...new Set([...assigned, ...(Array.isArray(body.sourcePaths) ? body.sourcePaths : [])])].filter(value => validSourcePath(value, schoolId, actor.uid)).slice(0, 12);
  const sources = (await Promise.all(paths.map(async sourcePath => {
    try {
      const data = await readSource(sourcePath);
      const fields = Object.fromEntries(zokiContextFields.filter(key => data[key] !== undefined).map(key => [key, Array.isArray(data[key]) ? data[key].filter(value => typeof value === 'string').slice(0, 8).map(value => value.slice(0, 100)) : typeof data[key] === 'string' ? data[key].slice(0, 400) : typeof data[key] === 'number' ? data[key] : null]));
      return { id: sourcePath, label: String(data.title || data.name || data.fullName || 'מידע מורשה').slice(0, 120), fields };
    } catch { return null; }
  }))).filter(Boolean);
  const ranked = selectRelevantMemories(memories, body.question, 6);
  const checks = await Promise.all(ranked.map(authorized));
  const selected = ranked.filter((_, index) => checks[index]);
  assertSession();
  const result = await createZokiProvider().generateTurn({ question: body.question,
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date()),
    profile: { uid: actor.uid, name: actor.data.fullName || '', role: actor.role, preferences: profile.preferences },
    authorizedSources: sources, memories: selected, learningEnabled: profile.learningEnabled,
    history: (Array.isArray(body.history) ? body.history : []).slice(-6).filter(item => ['user', 'assistant'].includes(item.role)).map(item => ({ role: item.role, text: String(item.text || '').slice(0, 900) })),
  });
  assertSession();
  const mutations = result.memoryMutations.filter(item => item && (!item.id || selected.some(memory => memory.id === item.id)));
  let memoryStatus = 'unchanged';
  if (mutations.length) {
    try {
      memoryStatus = await runTransaction(db, async transaction => {
        const [latestRoot, latestScope] = await Promise.all([transaction.get(rootRef), transaction.get(scopeRef)]);
        const latest = normalizeMemories(latestScope.data()?.memories);
        const unchanged = JSON.stringify(latest) === JSON.stringify(memories);
        const applicable = mutations.filter(item => !item.id ? unchanged : latest.some(memory => memory.id === item.id && memory.updatedAt === selected.find(old => old.id === item.id)?.updatedAt));
        const merged = mergeMemories(latest, applicable, sources, latestRoot.data()?.learningEnabled ?? true);
        if (!merged.changed.length) return 'unchanged';
        transaction.set(scopeRef, { memories: merged.memories });
        return 'saved';
      });
    } catch { memoryStatus = 'failed'; }
  }
  return {
    answer: result.answer,
    actionIntent: result.actionIntent,
    actionRequest: result.actionRequest,
    actionTargetType: result.actionTargetType,
    actionTargetLabel: result.actionTargetLabel,
    agentId: actor.uid,
    memoryStatus,
    sources: sources.filter(source => result.sourceIds.includes(source.id)).map(source => ({ id: source.id, label: source.label, route: '/zoki' })),
  };
}
