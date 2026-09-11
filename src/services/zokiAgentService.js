import { schoolJobTitle, zokiStaffFields, canManageStaffMember } from '../utils/staffManagement.js';
import { privateSessionGuard, subscribePrivateSession } from '../utils/browserPrivacy.js';
import { doc, getDocFromServer, runTransaction, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../firebase.js';
import { schoolCollectionPath } from './firestore/paths.js';
import { mergeMemories, normalizeMemories, validSourcePath, zokiContextFields, isSafeMemoryText } from '../utils/zokiMemory.js';
import { createZokiProvider } from './zokiFirebaseProvider.js';
import { boundedZokiHistory, runSemanticZokiTurn, ZOKI_CONTEXT_LIMITS } from '../utils/zokiSemanticTurn.js';

export const isZokiAgentConfigured = isFirebaseConfigured;
export function zokiSourcePaths({ schoolId, uid, sources }) {
  // Interleave resource categories so a large task list does not hide classes
  // or roles. Language interpretation belongs to the model, not this adapter.
  const groups = ['tasks', 'teams', 'classes', 'students', 'events', 'roles', 'initiatives'].map(type => (sources[type] || []).map(item => ({ type, item })));
  const candidates = [];
  for (let index = 0; candidates.length < ZOKI_CONTEXT_LIMITS.candidates && groups.some(group => index < group.length); index++) {
    for (const group of groups) if (group[index]) candidates.push(group[index]);
  }
  const staffPaths = (sources.staff || []).filter(item => /^[\w-]{1,128}$/.test(item.id || item.uid || '')).slice(0, 160).map(item => `users/${item.id || item.uid}`);
  return [...staffPaths, ...candidates.slice(0, ZOKI_CONTEXT_LIMITS.candidates).flatMap(({ type, item }) => {
    if (!/^[\w-]{1,128}$/u.test(item.id || '')) return [];
    if (type === 'tasks' && item._storageMode === 'personal') return [`users/${uid}/personalTasks/${item.id}`];
    const mode = ['legacy', 'nested'].includes(item._storageMode) ? item._storageMode : undefined;
    return [`${schoolCollectionPath(schoolId, type, mode)}/${item.id}`];
  })].slice(0, ZOKI_CONTEXT_LIMITS.candidates);
}
const fail = (code, retryAfter = 0) => Object.assign(new Error(code), { code, retryAfter });
const safeId = value => typeof value === 'string' && /^[\w-]{1,128}$/u.test(value);
const localWindows = new Map();
subscribePrivateSession(() => localWindows.clear());

async function actorFor(schoolId) {
  const assertPrivateSession = privateSessionGuard();
  const uid = auth.currentUser?.uid;
  if (!uid) throw fail('unauthenticated');
  if (!safeId(schoolId)) throw fail('invalid-input');
  const data = (await getDocFromServer(doc(db, 'users', uid))).data();
  assertPrivateSession();
  if (auth.currentUser?.uid !== uid) throw fail('unauthenticated');
  if (!data || (data.accountStatus && data.accountStatus !== 'active') || ![data.schoolId, ...(data.schoolIds || [])].includes(schoolId)) throw fail('permission-denied');
  return { uid, data, role: data.rolesBySchool?.[schoolId] || data.role || 'viewer' };
}

// UX throttling only. Google's AI Logic quota is the authoritative shared limit.
export async function reserveZokiQuestion(schoolId, knownActor) {
  const assertPrivateSession = privateSessionGuard();
  const actor = knownActor || await actorFor(schoolId);
  const value = (await getDocFromServer(doc(db, 'schools', schoolId, 'settings', 'zoki_agent'))).data()?.questionsPerMinute;
  assertPrivateSession();
  const limit = Number.isInteger(value) && value >= 1 && value <= 20 ? value : 4;
  const key = `zoki-question-window:${actor.uid}:${schoolId}`;
  const reserve = () => {
    const now = Date.now();
    let times = localWindows.get(key) || [];
    times = times.filter(at => Number.isFinite(at) && at > now - 60000 && at <= now);
    if (times.length >= limit) throw fail('resource-exhausted', Math.max(1, Math.ceil((Math.min(...times) + 60000 - now) / 1000)));
    times.push(now); localWindows.set(key, times);
  };
  reserve();
}

export async function syncPersonalAgentConversation(input) {
  const assertPrivateSession = privateSessionGuard();
  const expectedUid = input.expectedUid || auth.currentUser?.uid;
  const actor = await actorFor(input.schoolId);
  const assertCurrent = () => {
    assertPrivateSession();
    if (input.isCurrent && !input.isCurrent()) throw fail('session-changed');
    if (actor.uid !== expectedUid || auth.currentUser?.uid !== expectedUid) throw fail('unauthenticated');
  };
  assertCurrent();
  const ref = doc(db, 'zokiAgents', actor.uid, 'conversations', input.schoolId);
  if (input.operation === 'load') {
    const snapshot = await getDocFromServer(ref);
    assertCurrent();
    return { state: snapshot.data()?.state || null };
  }
  const messages = input.state?.messages?.filter(item => !item.error && !item.localOnly).slice(-12).map(item => ({ id: item.id, role: item.role, text: item.text.slice(0, 1500) })) || [];
  assertCurrent();
  await setDoc(ref, { state: input.operation === 'end' ? null : { messages } });
  return { saved: true };
}

// Compatibility interface for the settings UI: these are Firebase SDK operations.
export async function zokiRequest(path, schoolId, body = {}, method = 'POST', offset = 0) {
  const assertPrivateSession = privateSessionGuard();
  const actor = await actorFor(schoolId);
  const rootRef = doc(db, 'zokiAgents', actor.uid);
  const scopeRef = doc(rootRef, 'scopes', schoolId);
  const assertSession = () => { assertPrivateSession(); if (auth.currentUser?.uid !== actor.uid) throw fail('unauthenticated'); };
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
      if (!data || (sourcePath.startsWith('users/') && sourcePath.split('/').length === 2
        ? !zokiStaffFields(data, schoolId)
        : data.schoolId && data.schoolId !== schoolId)) throw fail('permission-denied');
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
  const candidates = [...new Set([...assigned, ...(Array.isArray(body.sourcePaths) ? body.sourcePaths : [])])].filter(value => validSourcePath(value, schoolId, actor.uid));
  const paths = candidates.slice(0, ZOKI_CONTEXT_LIMITS.candidates);
  const sources = [];
  // Fresh rule-authorized reads, with bounded concurrency. Cached UI labels are
  // never sent to the model as evidence or used to authorize retrieval.
  for (let offset = 0; offset < paths.length; offset += 12) {
    sources.push(...(await Promise.all(paths.slice(offset, offset + 12).map(async sourcePath => {
    try {
      const raw = await readSource(sourcePath);
      const data = sourcePath.startsWith('users/') && sourcePath.split('/').length === 2 ? zokiStaffFields(raw, schoolId) : raw;
      const fields = Object.fromEntries(zokiContextFields.filter(key => data[key] !== undefined).map(key => [key, Array.isArray(data[key]) ? data[key].filter(value => typeof value === 'string').slice(0, 8).map(value => value.slice(0, 100)) : typeof data[key] === 'string' ? data[key].slice(0, 1500) : typeof data[key] === 'number' ? data[key] : null]));
      return { id: sourcePath, label: String(data.title || data.name || data.fullName || 'מידע מורשה').slice(0, 120), fields };
    } catch { return null; }
    }))).filter(Boolean));
    assertSession();
  }
  // Keep recent authorized memory available without lexical relevance filtering.
  const ranked = memories.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);
  const checks = await Promise.all(ranked.map(authorized));
  const selected = ranked.filter((_, index) => checks[index]);
  assertSession();
  const { result, selectedSources } = await runSemanticZokiTurn({ provider: createZokiProvider(), sources, assertSession, input: { question: body.question,
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date()),
    profile: { uid: actor.uid, name: actor.data.fullName || '', role: actor.role, preferences: profile.preferences },
    accessContext: { schoolId, role: actor.role, canManageStaff: ['principal','institution_manager'].includes(actor.role), explicitPermissions: actor.data.permissionsBySchool?.[schoolId] || actor.data.permissions || {}, privateRecordsExcluded: true, externalSystemsVerified: false },
    memories: selected, learningEnabled: profile.learningEnabled,
    coverage: { exhaustive: false, candidateCount: sources.length, limit: ZOKI_CONTEXT_LIMITS.candidates },
    history: boundedZokiHistory(Array.isArray(body.history) ? body.history : []),
  } });
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
        const merged = mergeMemories(latest, applicable, selectedSources, latestRoot.data()?.learningEnabled ?? true);
        if (!merged.changed.length) return 'unchanged';
        transaction.set(scopeRef, { memories: merged.memories });
        return 'saved';
      });
    } catch { memoryStatus = 'failed'; }
  }
  let staffRoleDraft = null;
  if (result.actionIntent === 'update_staff_role') {
    if (!['principal', 'institution_manager'].includes(actor.role) || !result.staffRoleDraft) throw fail('permission-denied');
    const target = await readSource(result.staffRoleDraft.sourceId);
    if (!canManageStaffMember({ ...actor.data, uid: actor.uid }, { ...target, uid: result.staffRoleDraft.sourceId.split('/')[1] }, schoolId)) throw fail('permission-denied');
    assertSession();
    staffRoleDraft = { userId: result.staffRoleDraft.sourceId.split('/')[1], fullName: target.fullName || 'איש צוות',
      expectedTitle: schoolJobTitle(target, schoolId), jobTitle: result.staffRoleDraft.jobTitle };
  }
  return {
    answer: result.answer,
    staffRoleDraft,
    actionIntent: result.actionIntent,
    taskDraft: result.taskDraft,
    actionRequest: result.actionRequest,
    actionTargetType: result.actionTargetType,
    actionTargetLabel: result.actionTargetLabel,
    agentId: actor.uid,
    memoryStatus,
    sources: selectedSources.filter(source => result.sourceIds.includes(source.id)).map(source => ({ id: source.id, label: source.label, route: '/zoki' })),
  };
}
