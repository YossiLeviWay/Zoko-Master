import {
  createSchoolBrain,
  fingerprint,
  learningRecord,
  preserveApprovedPatterns,
  relevantBrainContext,
  sanitizeInstitutionalText,
  upsertApprovedPattern,
} from './brain.js';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
});

function cors(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean);
  return allowed.includes(origin) ? {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization,x-firebase-appcheck,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  } : {};
}

const base64Url = input => btoa(String.fromCharCode(...new Uint8Array(input))).replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_');

function pemBytes(value) {
  const body = String(value || '').replace(/\\n/gu, '\n').replace(/-----[^-]+-----/gu, '').replace(/\s+/gu, '');
  return Uint8Array.from(atob(body), char => char.charCodeAt(0));
}

async function signedJwt({ issuer, subject = '', audience = '', privateKey, lifetime = 540, claims = {} }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: issuer,
    ...(subject ? { sub: subject } : {}),
    ...(audience ? { aud: audience } : {}),
    iat: now - 30,
    exp: now + lifetime,
    ...claims,
  })));
  const key = await crypto.subtle.importKey('pkcs8', pemBytes(privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(signature)}`;
}

async function githubToken(env) {
  const jwt = await signedJwt({ issuer: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY });
  const response = await fetch(`https://api.github.com/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'zoko-task-agent' },
  });
  if (!response.ok) throw new Error('github-auth-failed');
  return (await response.json()).token;
}

function repositoryFor(env, schoolId) {
  const repositories = JSON.parse(env.SCHOOL_REPOSITORIES || '{}');
  const repository = repositories[schoolId];
  if (!repository || !/^[\w.-]+\/[\w.-]+$/u.test(repository)) throw new Error('school-repository-not-configured');
  return repository;
}

async function readBrain(env, schoolId) {
  const token = await githubToken(env);
  const repository = repositoryFor(env, schoolId);
  const response = await fetch(`https://api.github.com/repos/${repository}/contents/school-brain.md`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github.raw+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'zoko-task-agent' },
  });
  if (response.status === 404) return { markdown: createSchoolBrain({ school: { id: schoolId }, patterns: [] }), sha: '' };
  if (!response.ok) throw new Error('brain-read-failed');
  const sha = response.headers.get('etag')?.replaceAll('"', '') || '';
  return { markdown: await response.text(), sha };
}

async function githubFileMetadata(env, schoolId, token) {
  const repository = repositoryFor(env, schoolId);
  const response = await fetch(`https://api.github.com/repos/${repository}/contents/school-brain.md`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'zoko-task-agent' },
  });
  if (response.status === 404) return { repository, sha: '' };
  if (!response.ok) throw new Error('brain-metadata-failed');
  return { repository, sha: (await response.json()).sha || '' };
}

async function writeBrain(env, schoolId, markdown, message) {
  const token = await githubToken(env);
  const { repository, sha } = await githubFileMetadata(env, schoolId, token);
  const response = await fetch(`https://api.github.com/repos/${repository}/contents/school-brain.md`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28', 'user-agent': 'zoko-task-agent' },
    body: JSON.stringify({ message, content: btoa(unescape(encodeURIComponent(markdown))), ...(sha ? { sha } : {}) }),
  });
  if (!response.ok) throw new Error(response.status === 409 ? 'brain-conflict' : 'brain-write-failed');
  return response.json();
}

async function brainHistory(env, schoolId) {
  const token = await githubToken(env);
  const repository = repositoryFor(env, schoolId);
  const response = await fetch(`https://api.github.com/repos/${repository}/commits?path=school-brain.md&per_page=30`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'zoko-task-agent' },
  });
  if (!response.ok) throw new Error('brain-history-failed');
  return (await response.json()).map(item => ({ sha: item.sha, message: item.commit?.message || '', author: item.commit?.author?.name || '', date: item.commit?.author?.date || '' }));
}

async function restoreBrain(env, schoolId, sha) {
  const token = await githubToken(env);
  const repository = repositoryFor(env, schoolId);
  const response = await fetch(`https://api.github.com/repos/${repository}/contents/school-brain.md?ref=${encodeURIComponent(sha)}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github.raw+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'zoko-task-agent' },
  });
  if (!response.ok) throw new Error('brain-restore-source-failed');
  return writeBrain(env, schoolId, await response.text(), `Restore institutional brain from ${sha.slice(0, 12)}`);
}

async function actorFromToken(request, env) {
  const bearer = request.headers.get('authorization') || '';
  const idToken = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
  if (!idToken) throw new Error('unauthenticated');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }),
  });
  if (!response.ok) throw new Error('unauthenticated');
  const user = (await response.json()).users?.[0];
  if (!user?.localId) throw new Error('unauthenticated');
  return { uid: user.localId, idToken };
}

async function firebaseAdminToken(env) {
  const assertion = await signedJwt({
    issuer: env.FIREBASE_CLIENT_EMAIL,
    subject: env.FIREBASE_CLIENT_EMAIL,
    audience: 'https://oauth2.googleapis.com/token',
    privateKey: env.FIREBASE_PRIVATE_KEY,
    lifetime: 3300,
    claims: { scope: 'https://www.googleapis.com/auth/datastore' },
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error('firebase-admin-auth-failed');
  return (await response.json()).access_token;
}

function decodeJwtPart(value) {
  const normalized = String(value || '').replace(/-/gu, '+').replace(/_/gu, '/');
  const bytes = Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), char => char.charCodeAt(0));
  return { bytes, json: JSON.parse(new TextDecoder().decode(bytes)) };
}

let appCheckKeys = { expiresAt: 0, keys: [] };

async function verifyAppCheck(request, env) {
  if (!env.FIREBASE_PROJECT_NUMBER) return;
  const token = request.headers.get('x-firebase-appcheck') || '';
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('invalid-app-check');
  const header = decodeJwtPart(headerPart).json;
  const payload = decodeJwtPart(payloadPart).json;
  if (header.alg !== 'RS256' || header.typ !== 'JWT') throw new Error('invalid-app-check');
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== `https://firebaseappcheck.googleapis.com/${env.FIREBASE_PROJECT_NUMBER}`
    || !audience.includes(`projects/${env.FIREBASE_PROJECT_NUMBER}`)
    || Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) throw new Error('invalid-app-check');
  const allowedApps = String(env.FIREBASE_APP_IDS || '').split(',').map(item => item.trim()).filter(Boolean);
  if (allowedApps.length && !allowedApps.includes(payload.sub)) throw new Error('invalid-app-check');
  if (appCheckKeys.expiresAt <= Date.now()) {
    const response = await fetch('https://firebaseappcheck.googleapis.com/v1/jwks');
    if (!response.ok) throw new Error('app-check-unavailable');
    appCheckKeys = { keys: (await response.json()).keys || [], expiresAt: Date.now() + 6 * 3600000 };
  }
  const jwk = appCheckKeys.keys.find(item => item.kid === header.kid);
  if (!jwk) throw new Error('invalid-app-check');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeJwtPart(signaturePart).bytes,
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) throw new Error('invalid-app-check');
}

function brainDirectory(markdown) {
  const staffSection = String(markdown || '').split('## סגל ותפקידים')[1]?.split('\n## ')[0] || '';
  const unitsSection = String(markdown || '').split('## צוותים, כיתות ותכניות')[1]?.split('\n## ')[0] || '';
  const rows = section => section.split('\n').filter(line => /^\|.+\|$/u.test(line)).slice(2).map(line => line.split('|').slice(1, -1).map(value => value.trim().replace(/\\\|/gu, '|')));
  const staff = rows(staffSection);
  const units = rows(unitsSection);
  return {
    people: new Set(staff.flatMap(row => [row[0], row[1]]).filter(Boolean)),
    teams: new Set(units.filter(row => row[0] === 'צוות').map(row => row[1]).filter(Boolean)),
    entities: new Set(units.filter(row => ['כיתה', 'תכנית'].includes(row[0])).map(row => row[1]).filter(Boolean)),
  };
}

export function validatedAgentProposal(proposal, markdown) {
  const directory = brainDirectory(markdown);
  const strings = (value, allowed) => [...new Set((Array.isArray(value) ? value : []).filter(item => typeof item === 'string' && allowed.has(item)))].slice(0, 12);
  return {
    ...(proposal && typeof proposal === 'object' ? proposal : {}),
    assigneeSuggestions: strings(proposal?.assigneeSuggestions, directory.people),
    teamSuggestions: strings(proposal?.teamSuggestions, directory.teams),
    linkedEntitySuggestions: strings(proposal?.linkedEntitySuggestions, directory.entities),
  };
}

async function cleanupExpiredInbox(env) {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return { deleted: 0 };
  const token = await firebaseAdminToken(env);
  const endpoint = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const response = await fetch(`${endpoint}:runQuery`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'taskLearningInbox', allDescendants: true }],
      where: { fieldFilter: { field: { fieldPath: 'expiresAt' }, op: 'LESS_THAN', value: { stringValue: new Date().toISOString() } } },
      limit: 200,
    } }),
  });
  if (!response.ok) throw new Error('inbox-cleanup-query-failed');
  const rows = await response.json();
  const names = rows.filter(row => row.document?.name).map(row => row.document.name);
  await Promise.all(names.map(name => fetch(`https://firestore.googleapis.com/v1/${name}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })));
  return { deleted: names.length };
}

async function adminDocuments(env, token, path) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}?pageSize=1000`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  return ((await response.json()).documents || []).map(document => ({
    id: document.name.split('/').pop(),
    ...Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, plainValue(value)])),
  }));
}

async function dailySchoolSnapshot(env, token, schoolId) {
  const [schoolRows, users, modernTeams, legacyTeams, modernClasses, legacyClasses, initiatives, modernEvents, legacyEvents, modernHolidays, legacyHolidays, files, modernTasks, legacyTasks, modernStudents, legacyStudents] = await Promise.all([
    adminDocuments(env, token, 'schools'),
    adminDocuments(env, token, 'users'),
    adminDocuments(env, token, `schools/${schoolId}/teams`),
    adminDocuments(env, token, `teams_${schoolId}`),
    adminDocuments(env, token, `schools/${schoolId}/classes`),
    adminDocuments(env, token, `classes_${schoolId}`),
    adminDocuments(env, token, `schools/${schoolId}/initiatives`),
    adminDocuments(env, token, `schools/${schoolId}/events`),
    adminDocuments(env, token, `events_${schoolId}`),
    adminDocuments(env, token, `schools/${schoolId}/holidays`),
    adminDocuments(env, token, `holidays_${schoolId}`),
    adminDocuments(env, token, `schools/${schoolId}/files`),
    adminDocuments(env, token, `schools/${schoolId}/tasks`),
    adminDocuments(env, token, `tasks_${schoolId}`),
    adminDocuments(env, token, `schools/${schoolId}/students`),
    adminDocuments(env, token, `students_${schoolId}`),
  ]);
  const merge = (...sets) => [...new Map(sets.flat().map(item => [item.id, item])).values()];
  const teams = merge(modernTeams, legacyTeams);
  const classes = merge(modernClasses, legacyClasses);
  const events = merge(modernEvents, legacyEvents);
  const holidays = merge(modernHolidays, legacyHolidays);
  const tasks = merge(modernTasks, legacyTasks);
  const students = merge(modernStudents, legacyStudents);
  const school = schoolRows.find(item => item.id === schoolId) || { id: schoolId, name: schoolId };
  const activeStaff = users.filter(item => (item.schoolId === schoolId || item.schoolIds?.includes(schoolId)) && !['disabled', 'pending', 'deleting'].includes(item.accountStatus));
  const staffName = id => activeStaff.find(item => item.id === id)?.fullName || '';
  return {
    school: { id: schoolId, name: school.name || schoolId },
    staff: activeStaff.map(item => ({
      id: item.id, name: item.fullName || item.displayName || '', jobTitle: item.jobTitle || item.roleName || '',
      teams: teams.filter(team => team.memberIds?.includes(item.id)).map(team => team.name),
      classes: classes.filter(entry => [entry.teacherId, entry.homeroomTeacherId, ...(entry.staffIds || [])].includes(item.id)).map(entry => entry.name || entry.title),
    })),
    units: [
      ...teams.map(item => ({ type: 'צוות', name: item.name, owners: (item.leaderIds || []).map(staffName).filter(Boolean), summary: item.description || '' })),
      ...classes.map(item => ({ type: 'כיתה', name: item.name || item.title, owners: [staffName(item.teacherId || item.homeroomTeacherId)].filter(Boolean), summary: item.grade || item.gradeLevel || '' })),
      ...initiatives.map(item => ({ type: 'תכנית', name: item.title, owners: [staffName(item.ownerId)].filter(Boolean), summary: item.description || item.summary || '' })),
      ...tasks.filter(item => item.status !== 'archived').map(item => ({
        type: 'משימה',
        name: item.title,
        owners: (item.assigneeIds || [item.assigneeId]).map(staffName).filter(Boolean),
        summary: [item.description, ...(item.steps || item.subtasks || []).map(step => step.title || step.name || step)].filter(Boolean).join(' · '),
      })),
    ],
    students: students.filter(item => item.status !== 'archived').map(item => ({
      name: item.fullName || [item.firstName, item.lastName].filter(Boolean).join(' '),
      className: item.className || classes.find(entry => entry.id === item.classId)?.name || '',
      grade: item.gradeLevel || item.grade || '',
      programs: item.programTypes || item.trackNames || [],
    })),
    calendar: [...events, ...holidays].map(item => ({ date: item.startDate || item.date, range: item.endDate ? `${item.startDate}–${item.endDate}` : '', title: item.name || item.title, summary: item.description || '' })),
    documents: files.map(item => ({ name: item.name, domain: item.type || item.category || '', summary: item.content || item.text || item.description || item.summary || '' })),
    patterns: [],
  };
}

async function syncConfiguredSchools(env) {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return { synced: 0 };
  const schoolIds = Object.keys(JSON.parse(env.SCHOOL_REPOSITORIES || '{}'));
  const token = await firebaseAdminToken(env);
  let synced = 0;
  for (const schoolId of schoolIds) {
    const snapshot = await dailySchoolSnapshot(env, token, schoolId);
    const current = await readBrain(env, schoolId);
    const generated = createSchoolBrain({ ...snapshot, generatedAt: new Date().toISOString() });
    const next = preserveApprovedPatterns(current.markdown, generated);
    const comparable = value => value.replace(/^updatedAt:.*$/gmu, 'updatedAt: <timestamp>').trim();
    if (comparable(next) !== comparable(current.markdown)) {
      await writeBrain(env, schoolId, next, 'Daily institutional knowledge sync');
      synced += 1;
    }
  }
  return { synced };
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])) } };
}

function plainValue(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(plainValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, plainValue(item)]));
  return null;
}

async function firestore(request, env, path, options = {}) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, {
    ...options,
    headers: { authorization: request.headers.get('authorization'), 'content-type': 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(response.status === 403 ? 'permission-denied' : 'firestore-failed');
  return response.status === 204 ? null : response.json();
}

async function actorContext(request, env, schoolId) {
  const actor = await actorFromToken(request, env);
  const document = await firestore(request, env, `users/${actor.uid}`);
  const data = Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, plainValue(value)]));
  const schools = new Set([...(data.schoolIds || []), data.schoolId].filter(Boolean));
  if (!schools.has(schoolId) || ['disabled', 'pending', 'deleting'].includes(data.accountStatus)) throw new Error('permission-denied');
  const schoolRole = data.rolesBySchool?.[schoolId] || data.role || 'viewer';
  return { ...actor, fullName: data.fullName || 'איש צוות', role: schoolRole, manager: ['principal', 'institution_manager'].includes(schoolRole) };
}

async function geminiJson(env, prompt) {
  if (!env.GEMINI_API_KEY) throw new Error('agent-not-configured');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || 'gemini-flash-latest'}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
  });
  if (!response.ok) throw new Error('agent-unavailable');
  const text = (await response.json()).candidates?.[0]?.content?.parts?.map(item => item.text || '').join('') || '';
  return JSON.parse(text.replace(/^```json\s*|```$/gu, '').trim());
}

async function saveCandidate(request, env, schoolId, actor, body) {
  const summary = await geminiJson(env, `סכם את דפוס המשימה בעברית והחזר JSON בלבד עם canonicalIntent, summary, keywords, roles, people, steps, documents, timing. אין לכלול מידע רפואי, כתובות, מספרי זהות או מידע אישי. שמות אנשים מותרים.\n\nבקשה: ${sanitizeInstitutionalText(body.request, 5000)}\nמשימה שנשמרה: ${JSON.stringify(body.savedTask || {})}`).catch(() => ({}));
  const record = learningRecord({ actor, schoolId, request: body.request, proposal: body.proposal, savedTask: body.savedTask, canonicalIntent: summary.canonicalIntent, summary: summary.summary });
  record.groupId = await fingerprint(summary.canonicalIntent || record.canonicalIntent);
  record.keywords = summary.keywords || [];
  record.roles = summary.roles || [];
  record.people = summary.people || [];
  record.steps = summary.steps || [];
  record.documents = summary.documents || [];
  record.timing = summary.timing || '';
  record.createdAt = new Date().toISOString();
  record.expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  const id = `${record.groupId}_${actor.uid.slice(0, 18)}_${Date.now()}`;
  await firestore(request, env, `schools/${schoolId}/taskLearningInbox?documentId=${encodeURIComponent(id)}`, {
    method: 'POST', body: JSON.stringify({ fields: Object.fromEntries(Object.entries(record).map(([key, value]) => [key, firestoreValue(value)])) }),
  });
  return { id, groupId: record.groupId };
}

async function listCandidates(request, env, schoolId) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: { authorization: request.headers.get('authorization'), 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'taskLearningInbox' }], where: { fieldFilter: { field: { fieldPath: 'schoolId' }, op: 'EQUAL', value: { stringValue: schoolId } } }, limit: 100 } }),
  });
  if (!response.ok) throw new Error('firestore-failed');
  const rows = await response.json();
  const records = rows.filter(row => row.document).map(row => ({ id: row.document.name.split('/').pop(), ...Object.fromEntries(Object.entries(row.document.fields || {}).map(([key, value]) => [key, plainValue(value)])) }));
  const groups = new Map();
  records.filter(item => item.status === 'candidate').forEach(item => {
    const current = groups.get(item.groupId) || { id: item.groupId, name: item.summary, canonicalIntent: item.canonicalIntent, keywords: [], roles: [], people: [], steps: [], documents: [], timing: '', sources: [], contributors: [] };
    ['keywords', 'roles', 'people', 'steps', 'documents'].forEach(key => { current[key] = [...new Set([...current[key], ...(item[key] || [])])]; });
    current.timing ||= item.timing || '';
    current.sources.push({ id: item.id, actorId: item.actorId, actorName: item.actorName, originalText: item.originalText, taskId: item.taskId, createdAt: item.createdAt, proposal: item.proposal, savedTask: item.savedTask });
    current.contributors = [...new Set([...current.contributors, item.actorName])];
    groups.set(item.groupId, current);
  });
  return [...groups.values()].sort((a, b) => b.sources.length - a.sources.length);
}

async function deleteSources(request, env, schoolId, sourceIds) {
  await Promise.all((sourceIds || []).slice(0, 100).map(id => firestore(request, env, `schools/${schoolId}/taskLearningInbox/${encodeURIComponent(id)}`, { method: 'DELETE' })));
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) });
  if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const schoolId = sanitizeInstitutionalText(body.schoolId || url.searchParams.get('schoolId'), 128);
  if (!schoolId) throw new Error('school-required');
  await verifyAppCheck(request, env);
  const actor = await actorContext(request, env, schoolId);

  if (url.pathname === '/v1/task-agent/draft' && request.method === 'POST') {
    const { markdown } = await readBrain(env, schoolId);
    const context = relevantBrainContext(markdown, body.request);
    const generatedProposal = await geminiJson(env, `אתה סוכן משימות של מוסד חינוכי. החזר JSON בלבד עם title, description, taskType, priority, dueDate, assigneeSuggestions, teamSuggestions, linkedEntitySuggestions, subtasks, completionCriteria, followUpQuestion, reasoningSummary, domain, commonDocuments. אין לבצע פעולה בפועל. השתמש רק באנשי צוות שמופיעים במוח.\n\nמוח מוסדי:\n${context}\n\nבקשת המשתמש:\n${sanitizeInstitutionalText(body.request, 1800)}`);
    const proposal = validatedAgentProposal(generatedProposal, markdown);
    return json({ proposal, sessionId: `worker_${Date.now()}`, capabilities: { canAssign: actor.manager, collaborationMode: actor.manager ? 'assign' : 'invite' }, degraded: false }, 200, cors(request, env));
  }
  if (url.pathname === '/v1/task-agent/learning/capture' && request.method === 'POST') {
    const result = await saveCandidate(request, env, schoolId, actor, body);
    return json({ ok: true, ...result }, 200, cors(request, env));
  }
  if (!actor.manager) throw new Error('permission-denied');
  if (url.pathname === '/v1/task-agent/candidates' && request.method === 'GET') return json({ patterns: await listCandidates(request, env, schoolId) }, 200, cors(request, env));
  if (url.pathname === '/v1/task-agent/brain' && request.method === 'GET') return json(await readBrain(env, schoolId), 200, cors(request, env));
  if (url.pathname === '/v1/task-agent/brain/history' && request.method === 'GET') return json({ versions: await brainHistory(env, schoolId) }, 200, cors(request, env));
  if (url.pathname === '/v1/task-agent/brain/preview' && request.method === 'POST') {
    const { markdown } = await readBrain(env, schoolId);
    const next = upsertApprovedPattern(markdown, { ...body.pattern, id: body.pattern?.id || await fingerprint(body.pattern?.canonicalIntent || body.pattern?.name) });
    return json({ markdown: next, previousLength: markdown.length, nextLength: next.length }, 200, cors(request, env));
  }
  if (url.pathname === '/v1/task-agent/brain/publish' && request.method === 'POST') {
    const pattern = { ...body.pattern, id: body.pattern?.id || await fingerprint(body.pattern?.canonicalIntent || body.pattern?.name) };
    const { markdown } = await readBrain(env, schoolId);
    const next = upsertApprovedPattern(markdown, pattern);
    const result = await writeBrain(env, schoolId, next, `Approve task pattern: ${sanitizeInstitutionalText(pattern.name, 80) || pattern.id}`);
    await deleteSources(request, env, schoolId, body.sourceIds);
    return json({ ok: true, commitSha: result.commit?.sha || '' }, 200, cors(request, env));
  }
  if (url.pathname === '/v1/task-agent/candidates/reject' && request.method === 'POST') {
    await deleteSources(request, env, schoolId, body.sourceIds);
    return json({ ok: true }, 200, cors(request, env));
  }
  if (url.pathname === '/v1/task-agent/brain/sync' && request.method === 'POST') {
    const current = await readBrain(env, schoolId);
    const generated = createSchoolBrain({ ...(body.snapshot || {}), school: { ...(body.snapshot?.school || {}), id: schoolId }, generatedAt: new Date().toISOString() });
    const markdown = preserveApprovedPatterns(current.markdown, generated);
    const result = await writeBrain(env, schoolId, markdown, 'Sync institutional knowledge');
    return json({ ok: true, commitSha: result.commit?.sha || '' }, 200, cors(request, env));
  }
  if (url.pathname === '/v1/task-agent/brain/restore' && request.method === 'POST') {
    if (!/^[a-f0-9]{40}$/u.test(body.sha || '')) throw new Error('invalid-version');
    const result = await restoreBrain(env, schoolId, body.sha);
    return json({ ok: true, commitSha: result.commit?.sha || '' }, 200, cors(request, env));
  }
  throw new Error('not-found');
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (error) {
      const code = error?.message || 'internal-error';
      const status = ['unauthenticated', 'invalid-app-check'].includes(code) ? 401 : code === 'permission-denied' ? 403 : code === 'not-found' ? 404 : 400;
      return json({ error: code }, status, cors(request, env));
    }
  },
  async scheduled(_event, env, context) {
    context.waitUntil(Promise.all([cleanupExpiredInbox(env), syncConfiguredSchools(env)]));
  },
};
